"""Subgrupos de atividades e check-in de presença.

Um subgrupo (modalidade: Judô, Natação, Futsal...) pertence a uma turma e é
gerenciado pelo professor dela. O aluno faz check-in ("entra na aula") e
check-out ("sai da aula"); cada par grava uma sessão em `sessoes_presenca`
com entrada, saída e tempo de permanência calculado NO SERVIDOR (o relógio
do dispositivo do aluno não é fonte de verdade).

Realtime: a mesma infraestrutura de invalidações por seção. O check-in/out
publica a seção "subgrupos" para a turma inteira (professor incluso), então
os contadores do dashboard e o estado do botão do aluno se atualizam sem
refresh.

Teacher (professor aprovado, apenas turmas próprias):
  GET    /api/subgrupos/professor                     lista por turma(s)
  POST   /api/subgrupos/professor                     cria subgrupo
  PATCH  /api/subgrupos/professor/{id}                edita
  DELETE /api/subgrupos/professor/{id}                exclui
  GET    /api/subgrupos/professor/{id}/presencas      relatório de presença
  DELETE /api/subgrupos/professor/{id}/presencas/{aluno_id}  encerra sessão ativa do aluno

Student (o próprio aluno):
  GET    /api/subgrupos/aluno/{aluno_id}              subgrupos da turma + estado da sessão
  POST   /api/subgrupos/aluno/{id}/checkin            entra na aula
  POST   /api/subgrupos/aluno/{id}/checkout           sai da aula
"""

import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from lib.dates import now_utc
from lib.db import db
from lib.impersonation import get_current_user_with_impersonation
from lib.portal_access import get_authorized_aluno
from lib.realtime import publish_class_event, publish_user_event
from lib.roster import class_students
from lib.security import get_current_user
from models.models import User

router = APIRouter(prefix="/api/subgrupos", tags=["subgroups"])

SECTION = "subgroups"
LIST_LIMIT = 200


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _new_id() -> str:
    return uuid.uuid4().hex


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split())
    return cleaned or None


def _require_teacher(user: User) -> None:
    if user.tipo != "professor" or user.status != "ativo":
        raise HTTPException(status_code=403, detail="Acesso disponível somente para professores aprovados")


async def _owned_class(user: User, turma_id: str) -> dict[str, Any]:
    turma = await db.turmas.find_one({"id": turma_id}, {"_id": 0, "id": 1, "nome": 1, "professor_id": 1})
    if not turma:
        raise HTTPException(status_code=404, detail="Turma não encontrada")
    if turma.get("professor_id") != user.id:
        raise HTTPException(status_code=403, detail="A turma não está vinculada a este professor")
    return turma


async def _owned_subgroup(user: User, subgrupo_id: str) -> dict[str, Any]:
    _require_teacher(user)
    subgrupo = await db.subgrupos.find_one({"id": subgrupo_id}, {"_id": 0})
    if not subgrupo:
        raise HTTPException(status_code=404, detail="Subgrupo não encontrado")
    await _owned_class(user, subgrupo["turma_id"])
    return subgrupo


async def _student_class(aluno_id: str) -> str | None:
    student = await db.alunos.find_one({"id": aluno_id}, {"_id": 0, "turma_id": 1})
    return (student or {}).get("turma_id")


async def _require_student_account(user: User) -> str:
    if user.tipo != "aluno" or not user.aluno_id:
        raise HTTPException(status_code=403, detail="Só o próprio aluno pode registrar presença.")
    return user.aluno_id


async def _student_subgroup(aluno_id: str, subgrupo_id: str) -> dict[str, Any]:
    subgrupo = await db.subgrupos.find_one({"id": subgrupo_id}, {"_id": 0})
    if not subgrupo or subgrupo["turma_id"] != await _student_class(aluno_id):
        raise HTTPException(status_code=404, detail="Subgrupo não encontrado na sua turma.")
    return subgrupo


async def _notify(subgrupo: dict[str, Any], professor_id: str | None) -> None:
    # Fan-out explícito para deployments single-process; com change streams o hub
    # despacha as mesmas invalidações a partir dos eventos do banco.
    await publish_class_event(subgrupo["turma_id"], SECTION)
    if professor_id:
        await publish_user_event(professor_id, SECTION)


def _duration_text(seconds: int) -> str:
    minutes, sec = divmod(max(0, seconds), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}h {minutes:02d}min"
    if minutes:
        return f"{minutes}min {sec:02d}s"
    return f"{sec}s"


def _session_view(sessao: dict[str, Any]) -> dict[str, Any]:
    """Wire model de uma sessão. Registrar a sessão já é presença."""
    saida = sessao.get("saida")
    segundos = sessao.get("tempo_permanencia_segundos")
    return {
        "id": sessao["id"],
        "aluno_id": sessao["aluno_id"],
        "subgrupo_id": sessao["subgrupo_id"],
        "turma_id": sessao["turma_id"],
        "entrada": sessao.get("entrada"),
        "saida": saida,
        "ativa": saida is None,
        "tempo_permanencia_segundos": segundos,
        "tempo_permanencia": _duration_text(segundos) if segundos is not None else None,
        "presenca": True,
    }


def _summary(subgrupo: dict[str, Any], ativos: int = 0, alunos: dict[str, str] | None = None) -> dict[str, Any]:
    return {
        "id": subgrupo["id"],
        "turma_id": subgrupo["turma_id"],
        "nome": subgrupo["nome"],
        "descricao": subgrupo.get("descricao"),
        "status": subgrupo.get("status", "ativo"),
        "ativos": ativos,
        "alunos_ativos": [
            {"id": aluno_id, "nome": (alunos or {}).get(aluno_id, "Aluno")}
            for aluno_id in (subgrupo.get("_ativos_ids") or [])
        ],
        "criado_em": subgrupo.get("criado_em"),
        "atualizado_em": subgrupo.get("atualizado_em"),
    }


async def _active_sessions(subgrupo_ids: list[str]) -> tuple[dict[str, list[dict[str, Any]]], set[str]]:
    """Sessões abertas (saída inexistente) por subgrupo."""
    if not subgrupo_ids:
        return {}, set()
    cursor = db.sessoes_presenca.find(
        {"subgrupo_id": {"$in": subgrupo_ids}, "saida": None},
        {"_id": 0, "subgrupo_id": 1, "aluno_id": 1, "entrada": 1},
    ).sort("entrada", 1)
    active: dict[str, list[dict[str, Any]]] = {}
    alunos: set[str] = set()
    async for sessao in cursor:
        active.setdefault(sessao["subgrupo_id"], []).append(sessao)
        alunos.add(sessao["aluno_id"])
    return active, alunos


async def _names_for(ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    cursor = db.alunos.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "nome": 1})
    return {item["id"]: item.get("nome") or "Aluno" async for item in cursor}


# ─── Payloads ─────────────────────────────────────────────────────────────────
class SubgroupCreate(BaseModel):
    turma_id: str = Field(min_length=1, max_length=64)
    nome: str = Field(min_length=2, max_length=60)
    descricao: str | None = Field(default=None, max_length=500)
    status: str = Field(default="ativo", pattern="^(ativo|inativo)$")


class SubgroupUpdate(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=60)
    descricao: str | None = Field(default=None, max_length=500)
    status: str | None = Field(default=None, pattern="^(ativo|inativo)$")


# ─── Professor: gestão de subgrupos ──────────────────────────────────────────
@router.get("/professor")
async def teacher_subgroups(turma_id: str | None = None, user: User = Depends(get_current_user)):
    _require_teacher(user)
    turmas = {item["id"]: item async for item in db.turmas.find({"professor_id": user.id}, {"_id": 0, "id": 1})}
    owned = list(turmas)
    if not owned:
        return {"subgrupos": []}
    # Filtro opcional no servidor: o painel de uma turma não precisa baixar
    # (nem refetchar a cada check-in) os subgrupos das outras turmas.
    match_ids = [turma_id] if turma_id in turmas else owned
    query = {"turma_id": {"$in": match_ids}}
    items = await db.subgrupos.find(query, {"_id": 0}).sort("criado_em", 1).limit(LIST_LIMIT).to_list(length=LIST_LIMIT)
    active, alunos_ativos = await _active_sessions([item["id"] for item in items])
    names = await _names_for(alunos_ativos)
    for item in items:
        sessoes = active.get(item["id"], [])
        item["_ativos_ids"] = [s["aluno_id"] for s in sessoes]
    return {"subgrupos": [_summary(item, len(item["_ativos_ids"]), names) for item in items]}


@router.post("/professor", status_code=201)
async def create_subgroup(payload: SubgroupCreate, user: User = Depends(get_current_user)):
    _require_teacher(user)
    await _owned_class(user, payload.turma_id)
    nome = _clean(payload.nome) or ""
    if len(nome) < 2:
        raise HTTPException(status_code=422, detail="O nome precisa ter pelo menos 2 caracteres")
    existing = await db.subgrupos.find_one({"turma_id": payload.turma_id, "nome": {"$regex": f"^{nome.replace(' ', '\\s+')}$", "$options": "i"}})
    if existing:
        raise HTTPException(status_code=409, detail="Já existe um subgrupo com este nome nesta turma.")
    agora = now_utc()
    doc = {
        "id": _new_id(),
        "turma_id": payload.turma_id,
        "nome": nome,
        "descricao": _clean(payload.descricao),
        "status": payload.status,
        "criado_em": agora,
        "atualizado_em": agora,
    }
    await db.subgrupos.insert_one(dict(doc))
    doc.pop("_id", None)
    await publish_class_event(payload.turma_id, SECTION)
    await publish_user_event(user.id, SECTION)
    return _summary(doc, 0)


@router.patch("/professor/{subgrupo_id}")
async def update_subgroup(subgrupo_id: str, payload: SubgroupUpdate, user: User = Depends(get_current_user)):
    subgrupo = await _owned_subgroup(user, subgrupo_id)
    changes: dict[str, Any] = {"atualizado_em": now_utc()}
    if payload.nome is not None:
        changes["nome"] = _clean(payload.nome) or subgrupo["nome"]
    if payload.descricao is not None:
        changes["descricao"] = _clean(payload.descricao)
    if payload.status is not None:
        changes["status"] = payload.status
        if payload.status == "inativo":
            # Encerra sessões abertas: não faz sentido manter alunos "em aula".
            await _close_open_sessions(subgrupo)
    await db.subgrupos.update_one({"id": subgrupo_id}, {"$set": changes})
    await _notify(subgrupo, user.id)
    return await _teacher_summary(subgrupo_id)


async def _close_open_sessions(subgrupo: dict[str, Any]) -> None:
    """Encerra todas as sessões abertas do subgrupo em UMA operação atômica
    (pipeline de aggregation: saída = agora, permanência calculada no banco)."""
    await db.sessoes_presenca.update_many(
        {"subgrupo_id": subgrupo["id"], "saida": None},
        [
            {"$set": {
                "saida": "$$NOW",
                "tempo_permanencia_segundos": {
                    "$max": [0, {"$dateDiff": {"startDate": "$entrada", "endDate": "$$NOW", "unit": "second"}}]
                },
            }},
        ],
    )


async def _teacher_summary(subgrupo_id: str) -> dict[str, Any]:
    subgrupo = await db.subgrupos.find_one({"id": subgrupo_id}, {"_id": 0})
    active, alunos_ativos = await _active_sessions([subgrupo_id])
    names = await _names_for(alunos_ativos)
    sessoes = active.get(subgrupo_id, [])
    subgrupo["_ativos_ids"] = [s["aluno_id"] for s in sessoes]
    return _summary(subgrupo, len(sessoes), names)


@router.delete("/professor/{subgrupo_id}", status_code=204)
async def delete_subgroup(subgrupo_id: str, user: User = Depends(get_current_user)):
    subgrupo = await _owned_subgroup(user, subgrupo_id)
    await db.sessoes_presenca.delete_many({"subgrupo_id": subgrupo_id})
    await db.subgrupos.delete_one({"id": subgrupo_id})
    await _notify(subgrupo, user.id)


# ─── Professor: relatório de presença ────────────────────────────────────────
@router.get("/professor/{subgrupo_id}/presencas")
async def attendance_report(subgrupo_id: str, before: datetime | None = None, user: User = Depends(get_current_user)):
    """Relatório de presença paginado por cursor (`before` = entrada ISO).

    Retorna `total` para o front exibir "mostrando N de M" — sem isso, o corte
    em LIST_LIMIT seria um bug silencioso de "presenças que somem".
    """
    subgrupo = await _owned_subgroup(user, subgrupo_id)
    nomes = await class_students(db, subgrupo["turma_id"])
    query: dict[str, Any] = {"subgrupo_id": subgrupo_id}
    if before:
        query["entrada"] = {"$lt": before}
    cursor = db.sessoes_presenca.find(query, {"_id": 0}).sort("entrada", -1).limit(LIST_LIMIT)
    items = []
    async for sessao in cursor:
        view = _session_view(sessao)
        view["aluno_nome"] = nomes.get(sessao["aluno_id"], "Aluno")
        items.append(view)
    total = await db.sessoes_presenca.count_documents({"subgrupo_id": subgrupo_id})
    return {"subgrupo": {"id": subgrupo["id"], "nome": subgrupo["nome"]}, "sessoes": items, "total": total}


# (shared roster helper lives in lib/roster.py)


@router.delete("/professor/{subgrupo_id}/presencas/{aluno_id}", status_code=204)
async def force_checkout(subgrupo_id: str, aluno_id: str, user: User = Depends(get_current_user)):
    subgrupo = await _owned_subgroup(user, subgrupo_id)
    await _close_one(subgrupo, aluno_id)
    await _notify(subgrupo, user.id)


async def _close_one(subgrupo: dict[str, Any], aluno_id: str) -> None:
    sessao = await db.sessoes_presenca.find_one({"subgrupo_id": subgrupo["id"], "aluno_id": aluno_id, "saida": None}, {"_id": 0})
    if not sessao:
        raise HTTPException(status_code=404, detail="Nenhuma sessão ativa para este aluno neste subgrupo.")
    agora = now_utc()
    segundos = int((agora - sessao["entrada"]).total_seconds()) if sessao.get("entrada") else 0
    await db.sessoes_presenca.update_one(
        {"id": sessao["id"]},
        {"$set": {"saida": agora, "tempo_permanencia_segundos": max(0, segundos)}},
    )


# ─── Aluno: visualização e check-in/out ──────────────────────────────────────
@router.get("/aluno/{aluno_id}")
async def student_subgroups(aluno_id: str, user: User = Depends(get_current_user_with_impersonation)):
    await get_authorized_aluno(user, aluno_id)
    turma_id = await _student_class(aluno_id)
    if not turma_id:
        return {"subgrupos": []}
    items = await db.subgrupos.find({"turma_id": turma_id, "status": "ativo"}, {"_id": 0}).sort("nome", 1).limit(LIST_LIMIT).to_list(length=LIST_LIMIT)
    ids = [item["id"] for item in items]
    active, alunos_ativos = await _active_sessions(ids)
    names = await _names_for(alunos_ativos)
    minhas = {
        s["subgrupo_id"]: s
        for s in (await db.sessoes_presenca.find({"aluno_id": aluno_id, "subgrupo_id": {"$in": ids}, "saida": None}, {"_id": 0}).to_list(length=LIST_LIMIT))
    }
    result = []
    for item in items:
        sessoes = active.get(item["id"], [])
        ativos_ids = [s["aluno_id"] for s in sessoes]
        summary = _summary(item, len(ativos_ids), names)
        minha = minhas.get(item["id"])
        summary["minha_sessao"] = _session_view(minha) if minha else None
        result.append(summary)
    return {"subgrupos": result}


@router.post("/aluno/{subgrupo_id}/checkin", status_code=201)
async def checkin(subgrupo_id: str, user: User = Depends(get_current_user)):
    aluno_id = await _require_student_account(user)
    subgrupo = await _student_subgroup(aluno_id, subgrupo_id)
    if subgrupo.get("status") != "ativo":
        raise HTTPException(status_code=409, detail="Este subgrupo está inativo.")
    # Regra de negócio: um aluno só pode estar em um subgrupo por vez. A garantia
    # real é o índice parcial único (uma_sessao_aberta_por_aluno) — os find_one
    # abaixo são só para devolver mensagens amigáveis antes de tentar inserir.
    existente = await db.sessoes_presenca.find_one({"subgrupo_id": subgrupo_id, "aluno_id": aluno_id, "saida": None})
    if existente:
        raise HTTPException(status_code=409, detail="Você já está em aula neste subgrupo.")
    outra = await db.sessoes_presenca.find_one({"aluno_id": aluno_id, "saida": None, "subgrupo_id": {"$ne": subgrupo_id}})
    if outra:
        raise HTTPException(status_code=409, detail="Você já está em outra aula. Saia dela antes de entrar nesta.")
    agora = now_utc()
    sessao = {
        "id": _new_id(),
        "aluno_id": aluno_id,
        "subgrupo_id": subgrupo_id,
        "turma_id": subgrupo["turma_id"],
        "entrada": agora,
        "saida": None,
        "tempo_permanencia_segundos": None,
    }
    try:
        await db.sessoes_presenca.insert_one(dict(sessao))
    except DuplicateKeyError as exc:
        # Corrida: outro request do mesmo aluno inseriu a sessão aberta primeiro.
        raise HTTPException(status_code=409, detail="Você já está em aula.") from exc
    sessao.pop("_id", None)
    await _notify(subgrupo, None)
    return {"sessao": _session_view(sessao), "subgrupo": await _student_view(subgrupo_id, aluno_id)}


# Sessão sem saída após este limite é considerada abandonada (navegador fechado
# sem checkout). Encerrada automaticamente com a flag auto_encerrada, para o
# relatório distinguir presença real de sessão órfã.
SESSION_STALE_SECONDS = 6 * 60 * 60


async def close_stale_sessions(max_age_seconds: int = SESSION_STALE_SECONDS) -> int:
    """Encerra em UMA operação atômica todas as sessões abertas antigas.

    Usada pelo sync do aluno (ao abrir o portal) e pelo worker periódico do
    lifespan. O tempo de permanência é calculado no banco via aggregation
    pipeline ($dateDiff), no servidor — nunca no cliente.
    """
    limite = now_utc() - timedelta(seconds=max_age_seconds)
    result = await db.sessoes_presenca.update_many(
        {"saida": None, "entrada": {"$lt": limite}},
        [
            {"$set": {
                "saida": "$$NOW",
                "auto_encerrada": True,
                "tempo_permanencia_segundos": {
                    "$max": [0, {"$dateDiff": {"startDate": "$entrada", "endDate": "$$NOW", "unit": "second"}}]
                },
            }},
        ],
    )
    return result.modified_count


@router.post("/aluno/sync")
async def student_sessions_sync(user: User = Depends(get_current_user)):
    """Chamado ao abrir o portal: encerra sessões abandonadas do próprio aluno
    (fecha o navegador sem 'Sair') e devolve o estado atual."""
    aluno_id = await _require_student_account(user)
    fechadas = await db.sessoes_presenca.update_many(
        {"aluno_id": aluno_id, "saida": None, "entrada": {"$lt": now_utc() - timedelta(seconds=SESSION_STALE_SECONDS)}},
        [
            {"$set": {
                "saida": "$$NOW",
                "auto_encerrada": True,
                "tempo_permanencia_segundos": {
                    "$max": [0, {"$dateDiff": {"startDate": "$entrada", "endDate": "$$NOW", "unit": "second"}}]
                },
            }},
        ],
    )
    ativa = await db.sessoes_presenca.find_one({"aluno_id": aluno_id, "saida": None}, {"_id": 0})
    return {"sessao_ativa": ativa, "encerradas_automaticamente": fechadas.modified_count}


@router.post("/aluno/{subgrupo_id}/checkout")
async def checkout(subgrupo_id: str, user: User = Depends(get_current_user)):
    aluno_id = await _require_student_account(user)
    subgrupo = await _student_subgroup(aluno_id, subgrupo_id)
    sessao = await db.sessoes_presenca.find_one({"subgrupo_id": subgrupo_id, "aluno_id": aluno_id, "saida": None}, {"_id": 0})
    if not sessao:
        raise HTTPException(status_code=409, detail="Você não está em aula neste subgrupo.")
    # Cálculo de tempo_permanencia NO SERVIDOR: diferença entre agora (UTC,
    # relógio do servidor) e a entrada gravada. O relógio do dispositivo do
    # aluno nunca é usado.
    agora = now_utc()
    segundos = int((agora - sessao["entrada"]).total_seconds()) if sessao.get("entrada") else 0
    segundos = max(0, segundos)
    await db.sessoes_presenca.update_one(
        {"id": sessao["id"]},
        {"$set": {"saida": agora, "tempo_permanencia_segundos": segundos}},
    )
    sessao["saida"] = agora
    sessao["tempo_permanencia_segundos"] = segundos
    await _notify(subgrupo, None)
    return {"sessao": _session_view(sessao), "subgrupo": await _student_view(subgrupo_id, aluno_id)}


async def _student_view(subgrupo_id: str, aluno_id: str) -> dict[str, Any]:
    subgrupo = await db.subgrupos.find_one({"id": subgrupo_id}, {"_id": 0})
    active, alunos_ativos = await _active_sessions([subgrupo_id])
    names = await _names_for(alunos_ativos)
    sessoes = active.get(subgrupo_id, [])
    summary = _summary(subgrupo, len(sessoes), names)
    minha = await db.sessoes_presenca.find_one({"subgrupo_id": subgrupo_id, "aluno_id": aluno_id, "saida": None}, {"_id": 0})
    summary["minha_sessao"] = _session_view(minha) if minha else None
    return summary
