"""Minimal teacher-area data and award actions remain role-checked server-side."""

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator

from lib.dates import ensure_aware, now_utc, today_in_app_tz, today_iso
from lib.db import db
from lib.realtime import publish_admin_event, publish_event, publish_user_event
from lib.security import get_current_user
from lib.impersonation import get_current_user_with_impersonation
from models.models import AulaAgendaCreate, AulaAgendaUpdate, User


async def publish_event_for_teacher(user_id: str) -> None:
    await publish_user_event(user_id, "agenda")


class ClassUpdate(BaseModel):
    """Teacher edits to their own class. At least one field must change."""

    nome: str | None = Field(default=None, min_length=3, max_length=80)

    modalidade: str | None = Field(default=None, min_length=2, max_length=40)

    capacidade: int | None = Field(default=None, ge=1, le=500)

    @field_validator("nome", "modalidade")

    @classmethod

    def collapse_spaces(cls, value: str | None) -> str | None:
        if value is None:
            return None

        cleaned = " ".join(value.split())

        if not cleaned:
            raise ValueError("O campo não pode ficar vazio")

        return cleaned


def _iso_sort_key(value) -> str:
    """ISO string for sorting values that may be aware datetimes or plain strings."""
    if isinstance(value, str):
        return value
    try:
        return ensure_aware(value).isoformat()
    except Exception:
        return ""


router = APIRouter(prefix="/api/professor", tags=["teacher portal"])


@router.get("/dashboard")

async def teacher_dashboard(user: User = Depends(get_current_user_with_impersonation)):
    if user.tipo != "professor" or user.status != "ativo":
        raise HTTPException(status_code=403, detail="Acesso disponível somente para professores aprovados")

    classes = await db.turmas.find(

        {"professor_id": user.id}, {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1, "capacidade": 1, "alunos_ids": 1}

    ).to_list(length=200)

    return {"classes": [{**item, "total_alunos": len(item.get("alunos_ids", []))} for item in classes]}


@router.patch("/classes/{turma_id}")

async def update_class(turma_id: str, payload: ClassUpdate, user: User = Depends(get_current_user)):
    """The assigned teacher edits their own class: name, modality or capacity."""
    if user.tipo != "professor" or user.status != "ativo":
        raise HTTPException(status_code=403, detail="Acesso disponível somente para professores aprovados")

    turma = await db.turmas.find_one({"id": turma_id}, {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "capacidade": 1, "alunos_ids": 1, "professor_id": 1})

    if not turma:
        raise HTTPException(status_code=404, detail="Turma não encontrada")

    if turma.get("professor_id") != user.id:
        raise HTTPException(status_code=403, detail="Apenas o professor atribuído a esta turma pode editá-la")

    changes: dict = {}

    if payload.nome is not None and payload.nome != turma.get("nome"):
        changes["nome"] = payload.nome

    if payload.modalidade is not None and payload.modalidade != turma.get("modalidade"):
        changes["modalidade"] = payload.modalidade

    if payload.capacidade is not None and payload.capacidade != turma.get("capacidade", 20):
        enrolled = len(turma.get("alunos_ids", []))

        if payload.capacidade < enrolled:
            raise HTTPException(status_code=409, detail=f"A turma já tem {enrolled} aluno(s); a capacidade não pode ser menor que isso")

        changes["capacidade"] = payload.capacidade

    if not changes:
        return {"id": turma_id, "changed": False}

    await db.turmas.update_one({"id": turma_id}, {"$set": changes})

    # Students and admins see the new name/modality without waiting for a poll.
    await publish_admin_event("classes")

    for student_id in turma.get("alunos_ids", []):
        await publish_event(student_id, "portal")

    return {"id": turma_id, "changed": True, **changes}



@router.get("/students")

async def teacher_students(user: User = Depends(get_current_user_with_impersonation)):
    if user.tipo != "professor" or user.status != "ativo":
        raise HTTPException(status_code=403, detail="Acesso disponível somente para professores aprovados")

    class_ids = [item["id"] async for item in db.turmas.find({"professor_id": user.id}, {"_id": 0, "id": 1})]

    cursor = db.alunos.find({"turma_id": {"$in": class_ids}}, {"_id": 0, "id": 1, "nome": 1, "turma_id": 1}).sort("nome", 1).limit(500)

    return {"students": await cursor.to_list(length=500)}



# ─── Agenda de aulas ───────────────────────────────────────────────────────────
# The teacher dashboard is built on three real sources of truth:
#   - turmas        → the classes this teacher owns
#   - agenda_aulas  → the schedule (one entry per class per day)
#   - chamadas      → the attendance record (who actually showed up)
# Frequencies are derived from chamadas, never stored, so they cannot drift.
# Every calendar value is anchored in APP_TZ: the pod clock is UTC.


async def _require_active_teacher(user: User) -> None:
    if user.tipo != "professor" or user.status != "ativo":
        raise HTTPException(status_code=403, detail="Acesso disponível somente para professores aprovados")


@router.get("/agenda")

async def teacher_agenda(
    user: User = Depends(get_current_user_with_impersonation),
    dias: int = Query(default=7, ge=1, le=60),
):
    """Upcoming scheduled sessions, soonest first.

    A session is considered "scheduled" up until the end of its own day, so a class
    happening later today still appears — which is the whole point of a "próximas
    aulas" list for a teacher standing on the court.
    """
    await _require_active_teacher(user)

    class_ids = [item["id"] async for item in db.turmas.find({"professor_id": user.id}, {"_id": 0, "id": 1})]

    if not class_ids:
        return {"aulas": [], "hoje": today_iso()}

    class_map = {
        item["id"]: item
        async for item in db.turmas.find(
            {"id": {"$in": class_ids}}, {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1}
        )
    }

    start = today_in_app_tz()
    end = start + timedelta(days=dias)

    entries = [
        item
        async for item in db.agenda_aulas.find(
            {"turma_id": {"$in": list(class_map)}, "ativo": True, "data_aula": {"$gte": start.isoformat(), "$lte": end.isoformat()}},
            {"_id": 0},
        ).sort([("data_aula", 1), ("hora_inicio", 1)])
    ]

    # Attendance is recorded in chamadas. One lookup tells us which scheduled
    # sessions already have a record, so a session shows as "concluida".
    registros = [
        {"turma_id": item.get("turma_id"), "data_aula": item.get("data_aula")}
        async for item in db.chamadas.find(
            {"turma_id": {"$in": [a["turma_id"] for a in entries]}, "data_aula": {"$in": [a["data_aula"] for a in entries]}},
            {"_id": 0, "turma_id": 1, "data_aula": 1},
        )
    ]
    concluidas = {(r.get("turma_id"), r.get("data_aula")) for r in registros}

    hoje = today_iso()
    aulas = []
    for entry in entries:
        turma = class_map.get(entry.get("turma_id"), {})
        data = entry.get("data_aula")
        aulas.append({
            "id": entry.get("id"),
            "turma_id": entry.get("turma_id"),
            "turma_nome": turma.get("nome", "Turma"),
            "modalidade": turma.get("modalidade"),
            "ano": turma.get("ano"),
            "data_aula": data,
            "hora_inicio": entry.get("hora_inicio"),
            "duracao_minutos": entry.get("duracao_minutos", 60),
            "local": entry.get("local"),
            "observacoes": entry.get("observacoes", ""),
            "concluida": (entry.get("turma_id"), data) in concluidas,
            "hoje": data == hoje,
        })

    return {"aulas": aulas, "hoje": hoje}



@router.post("/agenda", status_code=201)

async def create_aula(payload: AulaAgendaCreate, user: User = Depends(get_current_user)):
    await _require_active_teacher(user)

    turma = await db.turmas.find_one({"id": payload.turma_id, "professor_id": user.id}, {"_id": 0, "id": 1})

    if not turma:
        raise HTTPException(status_code=404, detail="Turma não encontrada ou não vinculada a você.")

    # One session per class per day: a second class on the same day would double-count
    # "aulas de hoje" and confuse attendance.
    existing = await db.agenda_aulas.find_one(
        {"turma_id": payload.turma_id, "data_aula": payload.data_aula}, {"_id": 0, "id": 1}
    )

    if existing:
        raise HTTPException(status_code=409, detail="Já existe uma aula agendada para esta turma nesta data.")

    document = payload.model_dump()
    document["id"] = str(uuid.uuid4())
    document["ativo"] = True
    document["dataCriacao"] = now_utc()

    await db.agenda_aulas.insert_one(document)

    await publish_event_for_teacher(user.id)

    return {k: v for k, v in document.items() if k != "_id"}



@router.patch("/agenda/{aula_id}")

async def update_aula(aula_id: str, payload: AulaAgendaUpdate, user: User = Depends(get_current_user)):
    await _require_active_teacher(user)

    class_ids = [item["id"] async for item in db.turmas.find({"professor_id": user.id}, {"_id": 0, "id": 1})]

    if not class_ids:
        raise HTTPException(status_code=404, detail="Aula não encontrada.")

    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}

    if not updates:
        return {"ok": True, "message": "Nada a atualizar."}

    result = await db.agenda_aulas.update_one({"id": aula_id, "turma_id": {"$in": class_ids}}, {"$set": updates})

    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Aula não encontrada.")

    await publish_event_for_teacher(user.id)

    return {"ok": True}



@router.delete("/agenda/{aula_id}", status_code=204)

async def delete_aula(aula_id: str, user: User = Depends(get_current_user)):
    await _require_active_teacher(user)

    class_ids = [item["id"] async for item in db.turmas.find({"professor_id": user.id}, {"_id": 0, "id": 1})]

    if not class_ids:
        raise HTTPException(status_code=404, detail="Aula não encontrada.")

    result = await db.agenda_aulas.delete_one({"id": aula_id, "turma_id": {"$in": class_ids}})

    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Aula não encontrada.")

    await publish_event_for_teacher(user.id)

    return Response(status_code=204)



# ─── Visão consolidada (KPIs) ──────────────────────────────────────────────────
@router.get("/visao-geral")

async def teacher_overview(user: User = Depends(get_current_user_with_impersonation), semanas: int = Query(default=8, ge=1, le=52)):
    """Aggregated metrics for the teacher dashboard.

    Every number is derived from collections at read time — nothing is precomputed,
    so a KPI can never disagree with the roster or the attendance record it summarises.
    Weeks without data are reported as null rather than 0: "no classes held" and
    "zero per cent attendance" are different facts, and a dashboard should not
    conflate them.
    """
    await _require_active_teacher(user)

    turmas = [
        item
        async for item in db.turmas.find({"professor_id": user.id}, {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1, "capacidade": 1, "alunos_ids": 1})
    ]

    class_ids = [item["id"] for item in turmas]
    today = today_in_app_tz()
    week_start = today - timedelta(days=6)

    if not class_ids:
        return {
            "kpis": {
                "total_alunos": 0, "total_turmas": 0, "aulas_hoje": 0, "aulas_semana": 0,
                "frequencia_media": None, "alunos_sem_turma": 0, "ocupacao_percentual": None,
            },
            "turmas": [], "aulas_hoje": [], "proximas_aulas": [], "alunos": [], "semana": [],
        }

    # ---- turmas + occupancy -------------------------------------------------
    turmas_payload = []
    for turma in turmas:
        enrolled = len(turma.get("alunos_ids", []) or [])
        capacity = turma.get("capacidade") or 0
        turmas_payload.append({
            "id": turma["id"], "nome": turma.get("nome", "Turma"),
            "modalidade": turma.get("modalidade"), "ano": turma.get("ano"),
            "capacidade": capacity, "total_alunos": enrolled,
            "vagas": max(0, capacity - enrolled),
            "ocupacao_percentual": round((enrolled / capacity) * 100) if capacity else None,
        })

    # ---- schedule -----------------------------------------------------------
    agenda = [
        item
        async for item in db.agenda_aulas.find(
            {"turma_id": {"$in": class_ids}, "ativo": True, "data_aula": {"$gte": week_start.isoformat()}},
            {"_id": 0},
        )
    ]

    aulas_hoje_items = [a for a in agenda if a.get("data_aula") == today.isoformat()]
    aulas_semana_items = [a for a in agenda if a.get("data_aula") <= today.isoformat()]
    proximas = sorted(
        [a for a in agenda if a.get("data_aula") >= today.isoformat()],
        key=lambda a: (a.get("data_aula", ""), a.get("hora_inicio", "")),
    )[:8]

    class_map = {t["id"]: t for t in turmas_payload}

    def _decorate(entry: dict) -> dict:
        turma = class_map.get(entry.get("turma_id"), {})
        return {
            "id": entry.get("id"),
            "turma_id": entry.get("turma_id"),
            "turma_nome": turma.get("nome", "Turma"),
            "modalidade": turma.get("modalidade"),
            "data_aula": entry.get("data_aula"),
            "hora_inicio": entry.get("hora_inicio"),
            "duracao_minutos": entry.get("duracao_minutos", 60),
            "local": entry.get("local"),
            "hoje": entry.get("data_aula") == today.isoformat(),
        }

    # ---- attendance (frequency) --------------------------------------------
    chamadas = [
        item
        async for item in db.chamadas.find(
            {"turma_id": {"$in": class_ids}}, {"_id": 0, "turma_id": 1, "data_aula": 1, "presencas": 1, "concluida": 1}
        )
    ]

    presencas_totais = 0
    faltas_totais = 0
    registros_por_aluno: dict[str, dict[str, int]] = {}

    for chamada in chamadas:
        for aluno_id, presenca in (chamada.get("presencas") or {}).items():
            status = presenca.get("status") if isinstance(presenca, dict) else None
            bucket = registros_por_aluno.setdefault(aluno_id, {"presente": 0, "ausente": 0, "justificada": 0})
            if status in bucket:
                bucket[status] += 1
            if status == "presente":
                presencas_totais += 1
            elif status == "ausente":
                faltas_totais += 1

    computaveis = presencas_totais + faltas_totais
    frequencia = round((presencas_totais / computaveis) * 100) if computaveis else None

    # ---- roster with per-student metrics -----------------------------------
    alunos = [
        item
        async for item in db.alunos.find({"turma_id": {"$in": class_ids}}, {"_id": 0, "id": 1, "nome": 1, "turma_id": 1, "data_nascimento": 1}).sort("nome", 1)
    ]

    avaliacoes = [
        item
        async for item in db.avaliacoes.find({"turma_id": {"$in": class_ids}}, {"_id": 0, "aluno_id": 1, "media": 1, "dataAvaliacao": 1})
    ]
    media_por_aluno: dict[str, float] = {}
    for avaliacao in sorted(avaliacoes, key=lambda a: _iso_sort_key(a.get("dataAvaliacao"))):
        media_por_aluno[avaliacao.get("aluno_id", "")] = avaliacao.get("media") or 0.0

    pendencias_por_aluno: dict[str, int] = {}
    async for duvida in db.duvidas.find(
        {"professor_id": user.id, "status": "pendente"}, {"_id": 0, "aluno_id": 1}
    ):
        alvo = duvida.get("aluno_id", "")
        pendencias_por_aluno[alvo] = pendencias_por_aluno.get(alvo, 0) + 1

    alunos_payload = []
    for aluno in alunos:
        registros = registros_por_aluno.get(aluno["id"], {"presente": 0, "ausente": 0, "justificada": 0})
        base = registros["presente"] + registros["ausente"]
        turma = class_map.get(aluno.get("turma_id"), {})
        alunos_payload.append({
            "id": aluno["id"],
            "nome": aluno.get("nome", "Aluno"),
            "turma_id": aluno.get("turma_id"),
            "turma_nome": turma.get("nome", "—"),
            "turma_modalidade": turma.get("modalidade"),
            "presencas": registros["presente"],
            "faltas": registros["ausente"],
            "justificadas": registros["justificada"],
            "frequencia_percentual": round((registros["presente"] / base) * 100) if base else None,
            "media": media_por_aluno.get(aluno["id"]),
            "duvidas_pendentes": pendencias_por_aluno.get(aluno["id"], 0),
        })

    # ---- weekly trend (last N weeks) ---------------------------------------
    semana: list[dict] = []
    for offset in range(semanas - 1, -1, -1):
        inicio = today - timedelta(weeks=offset, days=6)
        fim = inicio + timedelta(days=6)
        dias = sum(1 for a in agenda if inicio.isoformat() <= a.get("data_aula", "") <= fim.isoformat())
        semana.append({
            "rotulo": inicio.strftime("%d/%m"),
            "aulas": dias,
        })

    capacidade_total = sum(t.get("capacidade") or 0 for t in turmas)
    matriculados_total = sum(t.get("total_alunos") or 0 for t in turmas_payload)

    return {
        "kpis": {
            "total_alunos": matriculados_total,
            "total_turmas": len(turmas_payload),
            "aulas_hoje": len(aulas_hoje_items),
            "aulas_semana": len(aulas_semana_items),
            "frequencia_media": frequencia,
            "alunos_sem_turma": await db.alunos.count_documents({"turma_id": None}),
            "ocupacao_percentual": round((matriculados_total / capacidade_total) * 100) if capacidade_total else None,
            "duvidas_pendentes": sum(pendencias_por_aluno.values()),
        },
        "turmas": turmas_payload,
        "aulas_hoje": [_decorate(a) for a in aulas_hoje_items],
        "proximas_aulas": [_decorate(a) for a in proximas],
        "alunos": alunos_payload,
        "semana": semana,
        "hoje": today.isoformat(),
    }
