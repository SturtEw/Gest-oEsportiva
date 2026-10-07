"""Individual training (1-on-1): a professor prescribes workout plans to a single
aluno; the aluno executes and marks each daily session as completed.

Data model (collections):
  individual_plan     one row per prescription: professor_id, aluno_id, titulo,
                      template, exercicios[], recorrencia rule, vigencia.
  individual_sessions one row per workout day, linked to the plan; each carries
                      its own completion status (is_completed, completed_at).

Teacher (assigned professor of the student's class only):
  GET    /api/treinos-individuais/templates            quick-start templates
  GET    /api/treinos-individuais/professor            plans of this professor
  POST   /api/treinos-individuais/professor            prescribe a plan
  GET    /api/treinos-individuais/professor/{id}       plan + sessions (tracking)
  PATCH  /api/treinos-individuais/professor/{id}       edit plan (regenerates sessions)
  DELETE /api/treinos-individuais/professor/{id}       delete plan + sessions
  GET    /api/treinos-individuais/professor/aluno/{aluno_id}   plans of one student

Student / guardian (read) and student (execution):
  GET    /api/treinos-individuais/aluno/{aluno_id}             my plans + sessions
  POST   /api/treinos-individuais/aluno/{aluno_id}/sessoes/{sessao_id}/concluir
  POST   /api/treinos-individuais/aluno/{aluno_id}/sessoes/{sessao_id}/reabrir
"""

import uuid
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from lib.dates import now_utc, today_iso
from lib.db import db
from lib.notifications import notify_student
from lib.portal_access import get_authorized_aluno, require_assigned_professor
from lib.realtime import publish_user_event
from lib.security import get_current_user
from models.models import User
from services.individual_workouts import TEMPLATES, expand_sessions, MAX_SESSIONS

router = APIRouter(prefix="/api/treinos-individuais", tags=["individual workouts"])

SECTION = "individual_workouts"
SESSIONS_LIMIT = 400
WEEKDAY_LABELS = {1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb", 7: "Dom"}


# ─── Payloads ─────────────────────────────────────────────────────────────────
class ExercicioInput(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    series: int = Field(default=3, ge=1, le=20)
    repeticoes: str = Field(default="10", max_length=20)
    carga: str | None = Field(default=None, max_length=20)
    descanso_s: int = Field(default=60, ge=0, le=1800)

    @field_validator("nome")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) < 2:
            raise ValueError("O nome do exercício precisa ter ao menos 2 caracteres")
        return cleaned


class RecorrenciaInput(BaseModel):
    type: Literal["daily", "weekly", "custom"]
    weekdays: list[int] = Field(default_factory=list)
    dates: list[str] = Field(default_factory=list, max_length=MAX_SESSIONS)


class PlanCreate(BaseModel):
    aluno_id: str = Field(min_length=1, max_length=64)
    titulo: str = Field(min_length=3, max_length=100)
    template: Literal["custom", *TEMPLATES.keys()] = "custom"
    observacoes: str | None = Field(default=None, max_length=500)
    exercicios: list[ExercicioInput] = Field(min_length=1, max_length=20)
    recorrencia: RecorrenciaInput
    data_inicio: str
    data_fim: str

    @field_validator("titulo")
    @classmethod
    def clean_title(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) < 3:
            raise ValueError("O título precisa ter pelo menos 3 caracteres")
        return cleaned

    @field_validator("data_inicio", "data_fim")
    @classmethod
    def valid_date(cls, value: str) -> str:
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError as exc:
            raise ValueError("Use uma data válida (AAAA-MM-DD)") from exc


class PlanUpdate(BaseModel):
    titulo: str | None = Field(default=None, min_length=3, max_length=100)
    observacoes: str | None = Field(default=None, max_length=500)
    exercicios: list[ExercicioInput] | None = Field(default=None, min_length=1, max_length=20)
    recorrencia: RecorrenciaInput | None = None
    data_inicio: str | None = None
    data_fim: str | None = None

    @field_validator("data_inicio", "data_fim")
    @classmethod
    def valid_date(cls, value: str | None) -> str | None:
        if not value:
            return None
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError as exc:
            raise ValueError("Use uma data válida (AAAA-MM-DD)") from exc


# ─── Helpers ──────────────────────────────────────────────────────────────────
async def _plan_of_teacher(plan_id: str, user: User) -> dict[str, Any]:
    plan = await db.individual_plan.find_one({"id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Plano de treino não encontrado")
    # Ownership: the professor who prescribed it (root admin previews via impersonation).
    if plan.get("professor_id") != user.id:
        raise HTTPException(status_code=403, detail="Este plano pertence a outro professor")
    return plan


def _validate_window(data_inicio: str, data_fim: str) -> tuple[str, str]:
    if data_fim < data_inicio:
        raise HTTPException(status_code=422, detail="A data final deve ser posterior à inicial")
    return data_inicio, data_fim


def _session_documents(plan_id: str, payload: PlanCreate) -> list[dict[str, Any]]:
    _validate_window(payload.data_inicio, payload.data_fim)
    try:
        dates = expand_sessions(
            payload.recorrencia.model_dump(),
            date.fromisoformat(payload.data_inicio),
            date.fromisoformat(payload.data_fim),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    now = now_utc().isoformat()
    return [{
        "id": str(uuid.uuid4()),
        "plan_id": plan_id,
        "data": item.isoformat(),
        "is_completed": False,
        "completed_at": None,
        "criado_em": now,
    } for item in dates]


def _serialize_plan(plan: dict[str, Any]) -> dict[str, Any]:
    data = {key: value for key, value in plan.items() if key != "_id"}
    # Teacher-facing convenience labels for the recurrence rule.
    rule = data.get("recorrencia") or {}
    if rule.get("type") == "weekly":
        data["recorrencia_label"] = " · ".join(WEEKDAY_LABELS.get(day, "?") for day in rule.get("weekdays", []))
    elif rule.get("type") == "daily":
        data["recorrencia_label"] = "Diário"
    else:
        data["recorrencia_label"] = "Cronograma fechado"
    return data


# ─── Templates ────────────────────────────────────────────────────────────────
@router.get("/templates")
async def list_templates(user: User = Depends(get_current_user)):
    return {"templates": [
        {"id": key, "nome": item["nome"], "descricao": item["descricao"], "exercicios": item["exercicios"]}
        for key, item in TEMPLATES.items()
    ]}


# ─── Teacher ──────────────────────────────────────────────────────────────────
@router.get("/professor")
async def teacher_plans(user: User = Depends(get_current_user)):
    if user.tipo != "professor" or user.status != "ativo":
        raise HTTPException(status_code=403, detail="Acesso disponível somente para professores aprovados")

    plans = [item async for item in db.individual_plan.find({"professor_id": user.id}, {"_id": 0}).sort("criado_em", -1).limit(200)]

    result = []
    for plan in plans:
        plan_id = plan["id"]
        total = await db.individual_sessions.count_documents({"plan_id": plan_id})
        done = await db.individual_sessions.count_documents({"plan_id": plan_id, "is_completed": True})
        student = await db.alunos.find_one({"id": plan.get("aluno_id")}, {"_id": 0, "id": 1, "nome": 1})
        result.append({
            **_serialize_plan(plan),
            "aluno_nome": (student or {}).get("nome", "Aluno não informado"),
            "sessoes_total": total,
            "sessoes_concluidas": done,
        })

    return {"plans": result}


@router.get("/professor/aluno/{aluno_id}")
async def teacher_student_plans(aluno_id: str, user: User = Depends(get_current_user)):
    student, _class_doc = await require_assigned_professor(user, aluno_id)

    plans = [item async for item in db.individual_plan.find({"professor_id": user.id, "aluno_id": student.id}, {"_id": 0}).sort("criado_em", -1).limit(100)]

    result = []
    for plan in plans:
        sessions = [
            item
            async for item in db.individual_sessions.find({"plan_id": plan["id"]}, {"_id": 0}).sort("data", 1).limit(SESSIONS_LIMIT)
        ]
        result.append({
            **_serialize_plan(plan),
            "sessoes": sessions,
            "sessoes_total": len(sessions),
            "sessoes_concluidas": sum(1 for item in sessions if item.get("is_completed")),
        })

    return {"aluno": {"id": student.id, "nome": student.nome}, "plans": result}


@router.post("/professor", status_code=201)
async def create_plan(payload: PlanCreate, user: User = Depends(get_current_user)):
    student, _class_doc = await require_assigned_professor(user, payload.aluno_id)

    document = {
        "id": str(uuid.uuid4()),
        "professor_id": user.id,
        "aluno_id": student.id,
        "titulo": payload.titulo,
        "template": payload.template,
        "observacoes": payload.observacoes,
        "exercicios": [item.model_dump() for item in payload.exercicios],
        "recorrencia": payload.recorrencia.model_dump(),
        "data_inicio": payload.data_inicio,
        "data_fim": payload.data_fim,
        "ativo": True,
        "criado_em": now_utc(),
        "atualizado_em": now_utc(),
    }

    sessions = _session_documents(document["id"], payload)
    if not sessions:
        raise HTTPException(status_code=422, detail="A frequência escolhida não gerou nenhuma sessão")

    await db.individual_plan.insert_one(document)
    for session in sessions:
        await db.individual_sessions.insert_one(session)

    # Notificação in-app: "O Professor [Nome] prescreveu um novo treino individual para você."
    await notify_student(
        student.id,
        titulo="Novo treino individual",
        mensagem=f"O Professor {user.nome} prescreveu um novo treino individual para você: {payload.titulo}.",
        link="meu-treino",
    )

    await publish_user_event(student.id, SECTION)

    return {"plan": _serialize_plan(document), "sessoes": len(sessions)}


@router.get("/professor/{plan_id}")
async def plan_detail(plan_id: str, user: User = Depends(get_current_user)):
    plan = await _plan_of_teacher(plan_id, user)
    sessions = [
        item
        async for item in db.individual_sessions.find({"plan_id": plan_id}, {"_id": 0}).sort("data", 1).limit(SESSIONS_LIMIT)
    ]
    student = await db.alunos.find_one({"id": plan.get("aluno_id")}, {"_id": 0, "id": 1, "nome": 1, "turma_id": 1})
    return {
        "plan": _serialize_plan(plan),
        "aluno": student,
        "sessoes": sessions,
        "hoje": today_iso(),
    }


@router.patch("/professor/{plan_id}")
async def update_plan(plan_id: str, payload: PlanUpdate, user: User = Depends(get_current_user)):
    plan = await _plan_of_teacher(plan_id, user)

    changes: dict[str, Any] = {"atualizado_em": now_utc()}
    if payload.titulo is not None:
        changes["titulo"] = payload.titulo
    if payload.observacoes is not None:
        changes["observacoes"] = payload.observacoes
    if payload.exercicios is not None:
        changes["exercicios"] = [item.model_dump() for item in payload.exercicios]

    # If the schedule itself changes, sessions are regenerated from scratch:
    # the student's completion history belongs to the previous calendar.
    regenerate = payload.recorrencia is not None or payload.data_inicio or payload.data_fim
    if regenerate:
        merged_rule = payload.recorrencia.model_dump() if payload.recorrencia else plan["recorrencia"]
        merged_start = payload.data_inicio or plan["data_inicio"]
        merged_end = payload.data_fim or plan["data_fim"]
        _validate_window(merged_start, merged_end)
        probe = PlanCreate(
            aluno_id=plan["aluno_id"],
            titulo=plan["titulo"],
            exercicios=payload.exercicios or [ExercicioInput(**item) for item in plan["exercicios"]],
            recorrencia=RecorrenciaInput(**merged_rule),
            data_inicio=merged_start,
            data_fim=merged_end,
        )
        fresh = _session_documents(plan_id, probe)

        await db.individual_sessions.delete_many({"plan_id": plan_id})
        for session in fresh:
            await db.individual_sessions.insert_one(session)

    await db.individual_plan.update_one({"id": plan_id}, {"$set": changes})

    await publish_user_event(plan["aluno_id"], SECTION)

    updated = await db.individual_plan.find_one({"id": plan_id}, {"_id": 0})
    sessions_count = await db.individual_sessions.count_documents({"plan_id": plan_id})
    return {"plan": _serialize_plan(updated or {}), "sessoes": sessions_count}


@router.delete("/professor/{plan_id}", status_code=200)
async def delete_plan(plan_id: str, user: User = Depends(get_current_user)):
    plan = await _plan_of_teacher(plan_id, user)

    await db.individual_sessions.delete_many({"plan_id": plan_id})
    await db.individual_plan.delete_one({"id": plan_id})

    await publish_user_event(plan["aluno_id"], SECTION)

    return {"id": plan_id, "status": "excluido"}


# ─── Student / guardian ───────────────────────────────────────────────────────
@router.get("/aluno/{aluno_id}")
async def student_plans(aluno_id: str, user: User = Depends(get_current_user)):
    student = await get_authorized_aluno(user, aluno_id)

    plans = [item async for item in db.individual_plan.find({"aluno_id": student.id, "ativo": True}, {"_id": 0}).sort("criado_em", -1).limit(50)]

    result = []
    for plan in plans:
        sessions = [
            item
            async for item in db.individual_sessions.find({"plan_id": plan["id"]}, {"_id": 0}).sort("data", 1).limit(SESSIONS_LIMIT)
        ]
        result.append({
            **_serialize_plan(plan),
            "sessoes": sessions,
            "sessoes_total": len(sessions),
            "sessoes_concluidas": sum(1 for item in sessions if item.get("is_completed")),
        })

    return {"hoje": today_iso(), "plans": result}


async def _session_of_student(aluno_id: str, session_id: str, user: User) -> dict[str, Any]:
    """Guardians read; only the student account itself toggles completion."""
    student = await get_authorized_aluno(user, aluno_id)
    if user.tipo != "aluno":
        raise HTTPException(status_code=403, detail="Somente o aluno pode alterar a execução do treino")

    session = await db.individual_sessions.find_one({"id": session_id, "plan_id": {"$exists": True}}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Sessão de treino não encontrada")

    plan = await db.individual_plan.find_one({"id": session.get("plan_id")}, {"_id": 0, "aluno_id": 1})
    if not plan or plan.get("aluno_id") != student.id:
        raise HTTPException(status_code=403, detail="Esta sessão não pertence a este aluno")

    return session


@router.post("/aluno/{aluno_id}/sessoes/{session_id}/concluir")
async def complete_session(aluno_id: str, session_id: str, user: User = Depends(get_current_user)):
    await _session_of_student(aluno_id, session_id, user)

    timestamp = now_utc()
    updated = await db.individual_sessions.find_one_and_update(
        {"id": session_id},
        {"$set": {"is_completed": True, "completed_at": timestamp}},
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Sessão de treino não encontrada")

    session = await db.individual_sessions.find_one({"id": session_id}, {"_id": 0})
    plan = await db.individual_plan.find_one({"id": session.get("plan_id")}, {"_id": 0, "professor_id": 1})
    if plan and plan.get("professor_id"):
        await publish_user_event(plan["professor_id"], SECTION)

    return {"id": session_id, "is_completed": True, "completed_at": timestamp.isoformat()}


@router.post("/aluno/{aluno_id}/sessoes/{session_id}/reabrir")
async def reopen_session(aluno_id: str, session_id: str, user: User = Depends(get_current_user)):
    await _session_of_student(aluno_id, session_id, user)

    updated = await db.individual_sessions.find_one_and_update(
        {"id": session_id},
        {"$set": {"is_completed": False, "completed_at": None}},
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Sessão de treino não encontrada")

    session = await db.individual_sessions.find_one({"id": session_id}, {"_id": 0})
    plan = await db.individual_plan.find_one({"id": session.get("plan_id")}, {"_id": 0, "professor_id": 1})
    if plan and plan.get("professor_id"):
        await publish_user_event(plan["professor_id"], SECTION)

    return {"id": session_id, "is_completed": False, "completed_at": None}
