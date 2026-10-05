"""Class activities: teachers create as many as they want; students join them.

An activity belongs to a class (turma). The class's current teacher manages it;
its students see it in their portal and can mark "Tenho interesse", which puts
them on the participant list. The teacher can add or remove any student of the
class. A competition activity can get a bracket (knockout or round robin) whose
teams are drawn from the participants — see services/brackets.py.

Teacher (approved professor, own classes only):
  GET    /api/atividades/professor                       list (all classes)
  POST   /api/atividades/professor                       create
  GET    /api/atividades/professor/{id}                  detail: participants, roster, bracket
  PATCH  /api/atividades/professor/{id}                  edit
  DELETE /api/atividades/professor/{id}                  delete
  POST   /api/atividades/professor/{id}/participantes    add students of the class
  DELETE /api/atividades/professor/{id}/participantes/{aluno_id}
  POST   /api/atividades/professor/{id}/chaveamento      create teams + matches
  DELETE /api/atividades/professor/{id}/chaveamento      discard the bracket
  PUT    /api/atividades/professor/{id}/chaveamento/times    rename / move students
  POST   /api/atividades/professor/{id}/chaveamento/sortear  redraw the students
  PATCH  /api/atividades/professor/{id}/chaveamento/partidas/{partida_id}  result

Student / guardian (read) and student (interest):
  GET    /api/atividades/aluno/{aluno_id}                activities of the student's class
  POST   /api/atividades/aluno/{id}/interesse            join
  DELETE /api/atividades/aluno/{id}/interesse            leave (before the bracket exists)
"""

import re
import uuid
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from lib.dates import now_utc
from lib.db import db
from lib.impersonation import get_current_user_with_impersonation
from lib.portal_access import get_authorized_aluno
from lib.realtime import publish_class_event, publish_user_event
from lib.security import get_current_user
from models.models import User
from services import brackets
from services.brackets import BracketError

router = APIRouter(prefix="/api/atividades", tags=["class activities"])

SECTION = "activities"
LIST_LIMIT = 200
VERSION_RETRIES = 3
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


# ─── Payloads ─────────────────────────────────────────────────────────────────
def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split())
    return cleaned or None


class _ActivityFields(BaseModel):
    descricao: str | None = Field(default=None, max_length=500)
    data: str | None = None
    horario: str | None = None
    local: str | None = Field(default=None, max_length=80)
    vagas: int | None = Field(default=None, ge=2, le=200)
    inscricoes_abertas: bool = True

    @field_validator("descricao")
    @classmethod
    def clean_description(cls, value: str | None) -> str | None:
        # Keep line breaks in the description; only trim the ends.
        return (value or "").strip() or None

    @field_validator("local")
    @classmethod
    def clean_place(cls, value: str | None) -> str | None:
        return _clean(value)

    @field_validator("data")
    @classmethod
    def valid_date(cls, value: str | None) -> str | None:
        if not value:
            return None
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError as exc:
            raise ValueError("Use uma data válida (AAAA-MM-DD)") from exc

    @field_validator("horario")
    @classmethod
    def valid_time(cls, value: str | None) -> str | None:
        if not value:
            return None
        if not _TIME.match(value):
            raise ValueError("Use um horário válido (HH:MM)")
        return value


class ActivityCreate(_ActivityFields):
    turma_id: str = Field(min_length=1, max_length=64)
    titulo: str = Field(min_length=3, max_length=80)

    @field_validator("titulo")
    @classmethod
    def clean_title(cls, value: str) -> str:
        cleaned = _clean(value) or ""
        if len(cleaned) < 3:
            raise ValueError("O título precisa ter pelo menos 3 caracteres")
        return cleaned


class ActivityUpdate(_ActivityFields):
    titulo: str | None = Field(default=None, min_length=3, max_length=80)
    inscricoes_abertas: bool | None = None  # type: ignore[assignment]

    @field_validator("titulo")
    @classmethod
    def clean_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = _clean(value) or ""
        if len(cleaned) < 3:
            raise ValueError("O título precisa ter pelo menos 3 caracteres")
        return cleaned


class ParticipantsAdd(BaseModel):
    alunos_ids: list[str] = Field(min_length=1, max_length=200)


class BracketCreate(BaseModel):
    formato: Literal["mata_mata", "pontos_corridos"]
    quantidade_times: int = Field(ge=brackets.MIN_TEAMS, le=max(brackets.MAX_TEAMS.values()))
    nomes_times: list[str] | None = Field(default=None, max_length=32)


class TeamEdit(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    nome: str = Field(min_length=1, max_length=brackets.TEAM_NAME_MAX)
    alunos_ids: list[str] = Field(default_factory=list, max_length=200)


class TeamsUpdate(BaseModel):
    times: list[TeamEdit] = Field(min_length=brackets.MIN_TEAMS, max_length=32)


class MatchResult(BaseModel):
    placar_a: int | None = Field(default=None, ge=0, le=brackets.MAX_SCORE)
    placar_b: int | None = Field(default=None, ge=0, le=brackets.MAX_SCORE)
    vencedor_id: str | None = Field(default=None, max_length=64)


# ─── Guards and loaders ───────────────────────────────────────────────────────
def _require_teacher(user: User) -> None:
    if user.tipo != "professor" or user.status != "ativo":
        raise HTTPException(status_code=403, detail="Acesso disponível somente para professores aprovados")


async def _teacher_classes(user: User) -> dict[str, dict[str, Any]]:
    cursor = db.turmas.find({"professor_id": user.id}, {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1})
    return {item["id"]: item async for item in cursor}


async def _owned_class(user: User, turma_id: str) -> dict[str, Any]:
    turma = await db.turmas.find_one({"id": turma_id}, {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1, "professor_id": 1})
    if not turma:
        raise HTTPException(status_code=404, detail="Turma não encontrada")
    if turma.get("professor_id") != user.id:
        raise HTTPException(status_code=403, detail="A turma não está vinculada a este professor")
    return turma


async def _owned_activity(user: User, atividade_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """The activity and its class. Ownership follows the class: its current teacher manages it."""
    _require_teacher(user)
    atividade = await db.atividades.find_one({"id": atividade_id}, {"_id": 0})
    if not atividade:
        raise HTTPException(status_code=404, detail="Atividade não encontrada")
    turma = await _owned_class(user, atividade["turma_id"])
    return atividade, turma


async def _class_students(turma_id: str) -> dict[str, str]:
    cursor = db.alunos.find({"turma_id": turma_id}, {"_id": 0, "id": 1, "nome": 1}).sort("nome", 1)
    return {item["id"]: item.get("nome") or "Aluno" async for item in cursor}


async def _notify(atividade: dict[str, Any], professor_id: str | None) -> None:
    # Explicit fan-out for single-process deployments; with change streams the hub
    # dispatches the same invalidations from the database events.
    await publish_class_event(atividade["turma_id"], SECTION)
    if professor_id:
        await publish_user_event(professor_id, SECTION)


def _bracket_error(exc: BracketError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail=str(exc))


# ─── Read models ──────────────────────────────────────────────────────────────
def short_name(nome: str) -> str:
    """'Carla Convite' -> 'Carla C.': classmates see who is on their team, not full names."""
    parts = (nome or "").split()
    if not parts:
        return "Aluno"
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0]}."


def _summary(atividade: dict[str, Any], turma: dict[str, Any] | None) -> dict[str, Any]:
    chave = atividade.get("chaveamento")
    participantes = atividade.get("participantes_ids") or []
    vagas = atividade.get("vagas")
    return {
        "id": atividade["id"],
        "turma_id": atividade["turma_id"],
        "turma_nome": (turma or {}).get("nome"),
        "modalidade": (turma or {}).get("modalidade"),
        "titulo": atividade["titulo"],
        "descricao": atividade.get("descricao"),
        "data": atividade.get("data"),
        "horario": atividade.get("horario"),
        "local": atividade.get("local"),
        "vagas": vagas,
        "vagas_restantes": max(0, vagas - len(participantes)) if vagas else None,
        "inscricoes_abertas": bool(atividade.get("inscricoes_abertas", True)),
        "total_participantes": len(participantes),
        "tem_chaveamento": bool(chave),
        "formato": chave.get("formato") if chave else None,
        "criado_em": atividade.get("criado_em"),
        "atualizado_em": atividade.get("atualizado_em"),
    }


def _bracket_view(chave: dict[str, Any], names: dict[str, str], *, viewer_id: str | None = None, teacher: bool = False) -> dict[str, Any]:
    """Bracket for the wire. Teachers see every member; a student only their own team's."""
    times = []
    for team in chave.get("times", []):
        members = [aluno_id for aluno_id in team.get("alunos_ids", []) if aluno_id in names]
        mine = viewer_id is not None and viewer_id in members
        entry: dict[str, Any] = {"id": team["id"], "nome": team["nome"], "total_membros": len(members), "meu_time": mine}
        if teacher:
            entry["membros"] = [{"id": aluno_id, "nome": names[aluno_id]} for aluno_id in members]
        elif mine:
            entry["membros"] = [{"id": aluno_id, "nome": short_name(names[aluno_id])} for aluno_id in members]
        times.append(entry)
    return {
        "formato": chave["formato"],
        "versao": chave.get("versao", 1),
        "times": times,
        "partidas": chave.get("partidas", []),
        "classificacao": brackets.standings(chave),
        "campeao_id": brackets.champion(chave),
        "total_rodadas": brackets.total_rounds(chave),
    }


async def _teacher_detail(atividade: dict[str, Any], turma: dict[str, Any]) -> dict[str, Any]:
    roster = await _class_students(turma["id"])
    interested = set(atividade.get("interessados_ids") or [])
    participantes = [
        {"id": aluno_id, "nome": roster[aluno_id], "origem": "interesse" if aluno_id in interested else "professor"}
        for aluno_id in atividade.get("participantes_ids") or []
        if aluno_id in roster  # a student who left the class drops out of the list
    ]
    participantes.sort(key=lambda item: item["nome"].lower())
    chave = atividade.get("chaveamento")
    return {
        **_summary(atividade, turma),
        "participantes": participantes,
        "alunos_turma": [{"id": aluno_id, "nome": nome} for aluno_id, nome in roster.items()],
        "chaveamento": _bracket_view(chave, roster, teacher=True) if chave else None,
    }


# ─── Bracket persistence (optimistic concurrency on chaveamento.versao) ───────
async def _save_bracket(atividade: dict[str, Any], new_bracket: dict[str, Any] | None) -> None:
    current = atividade.get("chaveamento")
    query: dict[str, Any] = {"id": atividade["id"]}
    query["chaveamento.versao" if current else "chaveamento"] = current.get("versao", 1) if current else None
    if new_bracket is not None:
        new_bracket["versao"] = (current.get("versao", 1) if current else 0) + 1
    result = await db.atividades.update_one(query, {"$set": {"chaveamento": new_bracket, "atualizado_em": now_utc()}})
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Outra alteração do chaveamento foi salva ao mesmo tempo. Recarregue e tente de novo.")


def _require_bracket(atividade: dict[str, Any]) -> dict[str, Any]:
    chave = atividade.get("chaveamento")
    if not chave:
        raise HTTPException(status_code=404, detail="Esta atividade ainda não tem chaveamento.")
    return chave


async def _drop_from_teams(atividade_id: str, aluno_id: str) -> None:
    """Take a removed participant out of their team; retried if the bracket changed meanwhile."""
    for _ in range(VERSION_RETRIES):
        atividade = await db.atividades.find_one({"id": atividade_id}, {"_id": 0})
        chave = (atividade or {}).get("chaveamento")
        if not chave or not any(aluno_id in team.get("alunos_ids", []) for team in chave["times"]):
            return
        updated = {**chave, "times": [{**team, "alunos_ids": [item for item in team["alunos_ids"] if item != aluno_id]} for team in chave["times"]]}
        try:
            await _save_bracket(atividade, updated)
            return
        except HTTPException:
            continue


# ─── Teacher ──────────────────────────────────────────────────────────────────
@router.get("/professor")
async def teacher_activities(user: User = Depends(get_current_user_with_impersonation)):
    _require_teacher(user)
    classes = await _teacher_classes(user)
    items = await db.atividades.find({"turma_id": {"$in": sorted(classes)}}, {"_id": 0}).sort("criado_em", -1).limit(LIST_LIMIT).to_list(length=LIST_LIMIT)
    return {
        "turmas": sorted(({"id": item["id"], "nome": item.get("nome"), "modalidade": item.get("modalidade")} for item in classes.values()), key=lambda item: (item["nome"] or "").lower()),
        "atividades": [_summary(item, classes.get(item["turma_id"])) for item in items],
    }


@router.post("/professor", status_code=201)
async def create_activity(payload: ActivityCreate, user: User = Depends(get_current_user)):
    _require_teacher(user)
    turma = await _owned_class(user, payload.turma_id)
    now = now_utc()
    document = {
        "id": str(uuid.uuid4()),
        **payload.model_dump(),
        "professor_id": user.id,
        "participantes_ids": [],
        "interessados_ids": [],
        "chaveamento": None,
        "criado_em": now,
        "atualizado_em": now,
    }
    await db.atividades.insert_one(document)
    await _notify(document, user.id)
    return await _teacher_detail(document, turma)


@router.get("/professor/{atividade_id}")
async def teacher_activity(atividade_id: str, user: User = Depends(get_current_user_with_impersonation)):
    atividade, turma = await _owned_activity(user, atividade_id)
    return await _teacher_detail(atividade, turma)


@router.patch("/professor/{atividade_id}")
async def update_activity(atividade_id: str, payload: ActivityUpdate, user: User = Depends(get_current_user)):
    atividade, turma = await _owned_activity(user, atividade_id)
    changes = payload.model_dump(exclude_unset=True)
    if "titulo" in changes and changes["titulo"] is None:
        changes.pop("titulo")
    if "inscricoes_abertas" in changes and changes["inscricoes_abertas"] is None:
        changes.pop("inscricoes_abertas")
    vagas = changes.get("vagas")
    if vagas and vagas < len(atividade.get("participantes_ids") or []):
        raise HTTPException(status_code=409, detail="Já há mais participantes do que essas vagas. Remova alguém antes de reduzir.")
    if changes:
        changes["atualizado_em"] = now_utc()
        await db.atividades.update_one({"id": atividade_id}, {"$set": changes})
        atividade.update(changes)
        await _notify(atividade, user.id)
    return await _teacher_detail(atividade, turma)


@router.delete("/professor/{atividade_id}", status_code=204)
async def delete_activity(atividade_id: str, user: User = Depends(get_current_user)):
    atividade, _turma = await _owned_activity(user, atividade_id)
    await db.atividades.delete_one({"id": atividade_id})
    await _notify(atividade, user.id)
    return Response(status_code=204)


@router.post("/professor/{atividade_id}/participantes")
async def add_participants(atividade_id: str, payload: ParticipantsAdd, user: User = Depends(get_current_user)):
    atividade, turma = await _owned_activity(user, atividade_id)
    roster = await _class_students(turma["id"])
    unknown = [aluno_id for aluno_id in payload.alunos_ids if aluno_id not in roster]
    if unknown:
        raise HTTPException(status_code=422, detail="Só é possível adicionar alunos desta turma.")

    current = list(atividade.get("participantes_ids") or [])
    updated = current + [aluno_id for aluno_id in dict.fromkeys(payload.alunos_ids) if aluno_id not in current]
    vagas = atividade.get("vagas")
    if vagas and len(updated) > vagas:
        raise HTTPException(status_code=409, detail=f"A atividade tem {vagas} vagas; restam {max(0, vagas - len(current))}.")
    if updated != current:
        # Compare-and-set on the list: a student joining at the same moment is not lost.
        result = await db.atividades.update_one(
            {"id": atividade_id, "participantes_ids": current},
            {"$set": {"participantes_ids": updated, "atualizado_em": now_utc()}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=409, detail="A lista de participantes mudou agora há pouco. Recarregue e tente de novo.")
        atividade["participantes_ids"] = updated
        await _notify(atividade, user.id)
    return await _teacher_detail(atividade, turma)


@router.delete("/professor/{atividade_id}/participantes/{aluno_id}")
async def remove_participant(atividade_id: str, aluno_id: str, user: User = Depends(get_current_user)):
    atividade, turma = await _owned_activity(user, atividade_id)
    if aluno_id not in (atividade.get("participantes_ids") or []):
        raise HTTPException(status_code=404, detail="Este aluno não participa da atividade.")
    await db.atividades.update_one(
        {"id": atividade_id},
        {"$pull": {"participantes_ids": aluno_id, "interessados_ids": aluno_id}, "$set": {"atualizado_em": now_utc()}},
    )
    await _drop_from_teams(atividade_id, aluno_id)
    await _notify(atividade, user.id)
    refreshed = await db.atividades.find_one({"id": atividade_id}, {"_id": 0})
    return await _teacher_detail(refreshed, turma)


@router.post("/professor/{atividade_id}/chaveamento", status_code=201)
async def create_bracket(atividade_id: str, payload: BracketCreate, user: User = Depends(get_current_user)):
    atividade, turma = await _owned_activity(user, atividade_id)
    if atividade.get("chaveamento"):
        raise HTTPException(status_code=409, detail="Esta atividade já tem chaveamento. Exclua o atual para gerar outro.")
    try:
        brackets.validate_team_count(payload.formato, payload.quantidade_times)
    except BracketError as exc:
        raise _bracket_error(exc) from exc

    roster = await _class_students(turma["id"])
    participants = [aluno_id for aluno_id in atividade.get("participantes_ids") or [] if aluno_id in roster]
    teams = brackets.build_teams(payload.quantidade_times, participants, payload.nomes_times)
    chave = brackets.create_bracket(payload.formato, teams, now_utc())
    await _save_bracket(atividade, chave)
    atividade["chaveamento"] = chave
    await _notify(atividade, user.id)
    return await _teacher_detail(atividade, turma)


@router.delete("/professor/{atividade_id}/chaveamento")
async def delete_bracket(atividade_id: str, user: User = Depends(get_current_user)):
    atividade, turma = await _owned_activity(user, atividade_id)
    _require_bracket(atividade)
    await _save_bracket(atividade, None)
    atividade["chaveamento"] = None
    await _notify(atividade, user.id)
    return await _teacher_detail(atividade, turma)


@router.put("/professor/{atividade_id}/chaveamento/times")
async def update_teams(atividade_id: str, payload: TeamsUpdate, user: User = Depends(get_current_user)):
    atividade, turma = await _owned_activity(user, atividade_id)
    chave = _require_bracket(atividade)

    existing = {team["id"] for team in chave["times"]}
    if {team.id for team in payload.times} != existing or len(payload.times) != len(existing):
        raise HTTPException(status_code=422, detail="Envie todos os times do chaveamento (para mudar a quantidade, gere um novo chaveamento).")
    participants = set(atividade.get("participantes_ids") or [])
    seen: set[str] = set()
    times = []
    for team in payload.times:
        nome = brackets.clean_team_name(team.nome)
        if not nome:
            raise HTTPException(status_code=422, detail="Todo time precisa de um nome.")
        members = list(dict.fromkeys(team.alunos_ids))
        if any(aluno_id not in participants for aluno_id in members):
            raise HTTPException(status_code=422, detail="Só participantes da atividade podem entrar em um time.")
        if seen & set(members):
            raise HTTPException(status_code=422, detail="Um aluno não pode estar em dois times.")
        seen.update(members)
        times.append({"id": team.id, "nome": nome, "alunos_ids": members})

    updated = {**chave, "times": times}
    await _save_bracket(atividade, updated)
    atividade["chaveamento"] = updated
    await _notify(atividade, user.id)
    return await _teacher_detail(atividade, turma)


@router.post("/professor/{atividade_id}/chaveamento/sortear")
async def redraw_teams(atividade_id: str, user: User = Depends(get_current_user)):
    """Deal the participants among the existing teams again. Names and matches stay."""
    atividade, turma = await _owned_activity(user, atividade_id)
    chave = _require_bracket(atividade)
    roster = await _class_students(turma["id"])
    participants = [aluno_id for aluno_id in atividade.get("participantes_ids") or [] if aluno_id in roster]
    members = brackets.distribute(participants, len(chave["times"]))
    updated = {**chave, "times": [{**team, "alunos_ids": members[index]} for index, team in enumerate(chave["times"])]}
    await _save_bracket(atividade, updated)
    atividade["chaveamento"] = updated
    await _notify(atividade, user.id)
    return await _teacher_detail(atividade, turma)


@router.patch("/professor/{atividade_id}/chaveamento/partidas/{partida_id}")
async def record_match(atividade_id: str, partida_id: str, payload: MatchResult, user: User = Depends(get_current_user)):
    atividade, turma = await _owned_activity(user, atividade_id)
    chave = _require_bracket(atividade)
    updated = {**chave, "partidas": [dict(match) for match in chave["partidas"]]}
    try:
        brackets.record_result(updated, partida_id, payload.placar_a, payload.placar_b, payload.vencedor_id)
    except BracketError as exc:
        raise _bracket_error(exc) from exc
    await _save_bracket(atividade, updated)
    atividade["chaveamento"] = updated
    await _notify(atividade, user.id)
    return await _teacher_detail(atividade, turma)


# ─── Student / guardian ───────────────────────────────────────────────────────
def _student_view(atividade: dict[str, Any], aluno_id: str, names: dict[str, str]) -> dict[str, Any]:
    participantes = atividade.get("participantes_ids") or []
    inscrito = aluno_id in participantes
    chave = atividade.get("chaveamento")
    summary = _summary(atividade, None)
    summary.pop("turma_nome")
    summary.pop("modalidade")
    return {
        **summary,
        "inscrito": inscrito,
        "origem": ("interesse" if aluno_id in (atividade.get("interessados_ids") or []) else "professor") if inscrito else None,
        # Leaving after the draw would leave a hole in a team: the teacher decides then.
        "pode_sair": inscrito and not chave,
        "chaveamento": _bracket_view(chave, names, viewer_id=aluno_id) if chave else None,
    }


async def _student_class(aluno_id: str) -> str | None:
    student = await db.alunos.find_one({"id": aluno_id}, {"_id": 0, "turma_id": 1})
    return (student or {}).get("turma_id")


@router.get("/aluno/{aluno_id}")
async def student_activities(aluno_id: str, user: User = Depends(get_current_user_with_impersonation)):
    await get_authorized_aluno(user, aluno_id)
    turma_id = await _student_class(aluno_id)
    if not turma_id:
        return {"atividades": []}
    items = await db.atividades.find({"turma_id": turma_id}, {"_id": 0}).sort("criado_em", -1).limit(LIST_LIMIT).to_list(length=LIST_LIMIT)
    names = await _class_students(turma_id) if any(item.get("chaveamento") for item in items) else {}
    return {"atividades": [_student_view(item, aluno_id, names) for item in items]}


def _require_student_account(user: User) -> str:
    # Guardians follow along; joining is the student's own choice.
    if user.tipo != "aluno" or not user.aluno_id:
        raise HTTPException(status_code=403, detail="Só o próprio aluno pode demonstrar interesse em uma atividade.")
    return user.aluno_id


async def _student_activity(aluno_id: str, atividade_id: str) -> dict[str, Any]:
    atividade = await db.atividades.find_one({"id": atividade_id}, {"_id": 0})
    if not atividade or atividade["turma_id"] != await _student_class(aluno_id):
        raise HTTPException(status_code=404, detail="Atividade não encontrada na sua turma.")
    return atividade


async def _student_response(atividade_id: str, aluno_id: str) -> dict[str, Any]:
    atividade = await db.atividades.find_one({"id": atividade_id}, {"_id": 0})
    names = await _class_students(atividade["turma_id"]) if atividade.get("chaveamento") else {}
    return _student_view(atividade, aluno_id, names)


@router.post("/aluno/{atividade_id}/interesse")
async def join_activity(atividade_id: str, user: User = Depends(get_current_user)):
    aluno_id = _require_student_account(user)
    atividade = await _student_activity(aluno_id, atividade_id)
    if aluno_id in (atividade.get("participantes_ids") or []):
        return await _student_response(atividade_id, aluno_id)
    if not atividade.get("inscricoes_abertas", True):
        raise HTTPException(status_code=409, detail="As inscrições desta atividade estão encerradas.")

    query: dict[str, Any] = {"id": atividade_id, "inscricoes_abertas": True, "participantes_ids": {"$ne": aluno_id}}
    vagas = atividade.get("vagas")
    if vagas:
        # Atomic seat check: the list cannot already have `vagas` entries.
        query[f"participantes_ids.{vagas - 1}"] = {"$exists": False}
    result = await db.atividades.update_one(
        query,
        {"$addToSet": {"participantes_ids": aluno_id, "interessados_ids": aluno_id}, "$set": {"atualizado_em": now_utc()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="As vagas desta atividade acabaram.")
    await _notify(atividade, atividade.get("professor_id"))
    return await _student_response(atividade_id, aluno_id)


@router.delete("/aluno/{atividade_id}/interesse")
async def leave_activity(atividade_id: str, user: User = Depends(get_current_user)):
    aluno_id = _require_student_account(user)
    atividade = await _student_activity(aluno_id, atividade_id)
    if aluno_id not in (atividade.get("participantes_ids") or []):
        return await _student_response(atividade_id, aluno_id)
    result = await db.atividades.update_one(
        {"id": atividade_id, "chaveamento": None},
        {"$pull": {"participantes_ids": aluno_id, "interessados_ids": aluno_id}, "$set": {"atualizado_em": now_utc()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Os times já foram sorteados. Fale com o professor para sair da atividade.")
    await _notify(atividade, atividade.get("professor_id"))
    return await _student_response(atividade_id, aluno_id)
