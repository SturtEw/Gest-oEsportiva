"""Class enrollment between teachers and students: invite codes and join requests.

Student (tipo "aluno", no class yet):
  GET    /api/enrollment/classes?q=        search classes that have a teacher
  GET    /api/enrollment/requests/me       own class + request history (status)
  POST   /api/enrollment/requests          ask to join a class
  DELETE /api/enrollment/requests/{id}     cancel own pending request
  POST   /api/enrollment/join              enter a class with an invite code

Teacher (approved professor, own classes only):
  GET    /api/enrollment/teacher/invites                 active code per class
  POST   /api/enrollment/teacher/classes/{id}/invite     generate (rotates the old one)
  DELETE /api/enrollment/teacher/invites/{id}            deactivate a code
  GET    /api/enrollment/teacher/requests?escopo=        pending or decided requests
  PATCH  /api/enrollment/teacher/requests/{id}           approve / reject
"""

import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from lib.dates import now_utc
from lib.db import db
from lib.guards import require_teacher
from lib.impersonation import get_current_user_with_impersonation
from lib.realtime import publish_event, publish_user_event
from lib.security import get_current_user
from models.models import SolicitacaoTurma, TurmaConvite, User
from services.class_enrollment import (
    CLASS_SUMMARY_PROJECTION,
    INVITE_MAX_VALIDITY_DAYS,
    cancel_pending_requests,
    class_summary,
    generate_invite_code,
    invite_expiry,
    join_with_invite,
    link_student_to_class,
    public_invite,
    public_request,
    seats_left,
)


router = APIRouter(prefix="/api/enrollment", tags=["class enrollment"])

SEARCH_LIMIT = 50
HISTORY_LIMIT = 50
INVITE_CODE_ATTEMPTS = 5


def _optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split())
    return cleaned or None


class JoinRequestCreate(BaseModel):
    turma_id: str = Field(min_length=1, max_length=64)

    mensagem: str | None = Field(default=None, max_length=300)

    @field_validator("mensagem")
    @classmethod
    def clean_message(cls, value: str | None) -> str | None:
        return _optional_text(value)


class JoinWithCodeInput(BaseModel):
    codigo: str = Field(min_length=1, max_length=20)


class InviteCreate(BaseModel):
    # None = no expiry. Rotating the code is the way to cut off an old one.
    validade_dias: int | None = Field(default=None, ge=1, le=INVITE_MAX_VALIDITY_DAYS)


class JoinRequestDecision(BaseModel):
    aprovar: bool

    motivo: str | None = Field(default=None, max_length=300)

    @field_validator("motivo")
    @classmethod
    def clean_reason(cls, value: str | None) -> str | None:
        return _optional_text(value)


# ─── Guards ───────────────────────────────────────────────────────────────────
def _require_student(user: User) -> str:
    if user.tipo != "aluno" or not user.aluno_id:
        raise HTTPException(status_code=403, detail="Disponível apenas para contas de aluno")
    return user.aluno_id


# Alias local; a regra vive em lib/guards.py.
_require_teacher = require_teacher


async def _teacher_classes(user: User) -> list[dict[str, Any]]:
    return await db.turmas.find({"professor_id": user.id}, CLASS_SUMMARY_PROJECTION).sort("nome", 1).to_list(length=200)


async def _owned_class(user: User, turma_id: str) -> dict[str, Any]:
    turma = await db.turmas.find_one({"id": turma_id}, CLASS_SUMMARY_PROJECTION)
    if not turma:
        raise HTTPException(status_code=404, detail="Turma não encontrada")
    if turma.get("professor_id") != user.id:
        raise HTTPException(status_code=403, detail="A turma não está vinculada a este professor")
    return turma


async def _names_by_id(user_ids: set[str]) -> dict[str, str]:
    if not user_ids:
        return {}
    cursor = db.users.find({"id": {"$in": sorted(user_ids)}}, {"_id": 0, "id": 1, "nome": 1})
    return {item["id"]: item["nome"] async for item in cursor}


async def _notify(aluno_id: str, professor_id: str | None) -> None:
    # Explicit fan-out for single-process deployments; with change streams the
    # hub dispatches the same invalidations from the database events.
    await publish_event(aluno_id, "enrollment")
    if professor_id:
        await publish_user_event(professor_id, "enrollment")


# ─── Student ──────────────────────────────────────────────────────────────────
@router.get("/classes")
async def search_classes(
    q: str = Query(default="", max_length=60),
    user: User = Depends(get_current_user_with_impersonation),
):
    aluno_id = _require_student(user)

    # Only classes with a teacher: someone has to answer the request.
    query: dict[str, Any] = {"professor_id": {"$ne": None}}
    term = q.strip()
    if term:
        pattern = {"$regex": re.escape(term), "$options": "i"}
        query["$or"] = [{"nome": pattern}, {"modalidade": pattern}]

    classes = await db.turmas.find(query, CLASS_SUMMARY_PROJECTION).sort("nome", 1).limit(SEARCH_LIMIT).to_list(length=SEARCH_LIMIT)

    teachers = await _names_by_id({item["professor_id"] for item in classes if item.get("professor_id")})
    pending = await db.solicitacoes_turma.find_one({"aluno_id": aluno_id, "status": "pendente"}, {"_id": 0, "turma_id": 1})
    pending_class = pending.get("turma_id") if pending else None

    return {"classes": [
        {
            **class_summary(item),
            "professor_nome": teachers.get(item.get("professor_id", "")),
            "capacidade": int(item.get("capacidade") or 20),
            "vagas": seats_left(item),
            "lotada": seats_left(item) == 0,
            "solicitacao_pendente": item["id"] == pending_class,
        }
        for item in classes
    ]}


@router.get("/requests/me")
async def my_requests(user: User = Depends(get_current_user_with_impersonation)):
    aluno_id = _require_student(user)

    student = await db.alunos.find_one({"id": aluno_id}, {"_id": 0, "turma_id": 1})
    requests = await db.solicitacoes_turma.find({"aluno_id": aluno_id}, {"_id": 0}).sort("dataSolicitacao", -1).limit(10).to_list(length=10)

    class_ids = sorted({item["turma_id"] for item in requests})
    classes = {item["id"]: item async for item in db.turmas.find({"id": {"$in": class_ids}}, CLASS_SUMMARY_PROJECTION)}
    teachers = await _names_by_id({item["professor_id"] for item in requests})

    return {
        "turma_id": (student or {}).get("turma_id"),
        "requests": [public_request(item, classes.get(item["turma_id"]), teachers.get(item["professor_id"])) for item in requests],
    }


@router.post("/requests", status_code=201)
async def create_request(payload: JoinRequestCreate, user: User = Depends(get_current_user)):
    aluno_id = _require_student(user)

    student = await db.alunos.find_one({"id": aluno_id}, {"_id": 0, "id": 1, "nome": 1, "turma_id": 1})
    if not student:
        raise HTTPException(status_code=404, detail="Cadastro de aluno não encontrado")
    if student.get("turma_id"):
        raise HTTPException(status_code=409, detail="Você já participa de uma turma.")

    turma = await db.turmas.find_one({"id": payload.turma_id}, CLASS_SUMMARY_PROJECTION)
    if not turma or not turma.get("professor_id"):
        raise HTTPException(status_code=404, detail="Turma não encontrada ou sem professor responsável")
    if seats_left(turma) == 0:
        raise HTTPException(status_code=409, detail="Esta turma está lotada no momento.")

    pending_message = "Você já tem uma solicitação pendente. Cancele-a para escolher outra turma."
    if await db.solicitacoes_turma.find_one({"aluno_id": aluno_id, "status": "pendente"}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=409, detail=pending_message)

    document = SolicitacaoTurma(
        aluno_id=aluno_id,
        aluno_nome=student.get("nome") or user.nome,
        turma_id=turma["id"],
        professor_id=turma["professor_id"],
        mensagem=payload.mensagem,
    ).model_dump()

    try:
        await db.solicitacoes_turma.insert_one(document)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail=pending_message) from exc

    await _notify(aluno_id, turma["professor_id"])

    teachers = await _names_by_id({turma["professor_id"]})
    return public_request(document, turma, teachers.get(turma["professor_id"]))


@router.delete("/requests/{request_id}", status_code=204)
async def cancel_request(request_id: str, user: User = Depends(get_current_user)):
    aluno_id = _require_student(user)

    document = await db.solicitacoes_turma.find_one({"id": request_id, "aluno_id": aluno_id}, {"_id": 0})
    if not document:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada")

    result = await db.solicitacoes_turma.update_one(
        {"id": request_id, "aluno_id": aluno_id, "status": "pendente"},
        {"$set": {"status": "cancelada", "dataDecisao": now_utc()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Esta solicitação já foi respondida pelo professor.")

    await _notify(aluno_id, document.get("professor_id"))
    return Response(status_code=204)


@router.post("/join")
async def join_class_with_code(payload: JoinWithCodeInput, user: User = Depends(get_current_user)):
    aluno_id = _require_student(user)

    result = await join_with_invite(aluno_id, payload.codigo)

    await publish_event(aluno_id, "portal")
    await _notify(aluno_id, result["professor_id"])
    return {"turma": result["turma"]}


# ─── Teacher ──────────────────────────────────────────────────────────────────
@router.get("/teacher/invites")
async def teacher_invites(user: User = Depends(get_current_user_with_impersonation)):
    _require_teacher(user)

    classes = await _teacher_classes(user)
    class_ids = [item["id"] for item in classes]
    invites = {
        item["turma_id"]: item
        async for item in db.turma_convites.find({"turma_id": {"$in": class_ids}, "professor_id": user.id, "ativo": True}, {"_id": 0})
    }

    return {"classes": [
        {
            "turma_id": item["id"],
            "turma_nome": item["nome"],
            "modalidade": item.get("modalidade", ""),
            "ano": item.get("ano"),
            "capacidade": int(item.get("capacidade") or 20),
            "total_alunos": len(item.get("alunos_ids") or []),
            "convite": public_invite(invites.get(item["id"])),
        }
        for item in classes
    ]}


@router.post("/teacher/classes/{turma_id}/invite", status_code=201)
async def create_invite(turma_id: str, payload: InviteCreate, user: User = Depends(get_current_user)):
    _require_teacher(user)
    turma = await _owned_class(user, turma_id)
    now = now_utc()

    # One active code per class: generating a new one retires the previous.
    await db.turma_convites.update_many(
        {"turma_id": turma["id"], "ativo": True},
        {"$set": {"ativo": False, "revogado_em": now}},
    )

    for _ in range(INVITE_CODE_ATTEMPTS):
        document = TurmaConvite(
            codigo=generate_invite_code(),
            turma_id=turma["id"],
            professor_id=user.id,
            expira_em=invite_expiry(payload.validade_dias),
            dataCriacao=now,
        ).model_dump()
        try:
            await db.turma_convites.insert_one(document)
        except DuplicateKeyError:
            continue  # 32^8 codes; a collision is rare, a second one rarer still
        await publish_user_event(user.id, "enrollment")
        return public_invite(document)

    raise HTTPException(status_code=503, detail="Não foi possível gerar um código agora. Tente novamente.")


@router.delete("/teacher/invites/{invite_id}", status_code=204)
async def revoke_invite(invite_id: str, user: User = Depends(get_current_user)):
    _require_teacher(user)

    result = await db.turma_convites.update_one(
        {"id": invite_id, "professor_id": user.id, "ativo": True},
        {"$set": {"ativo": False, "revogado_em": now_utc()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Convite não encontrado ou já desativado")

    await publish_user_event(user.id, "enrollment")
    return Response(status_code=204)


@router.get("/teacher/requests")
async def teacher_requests(
    escopo: Literal["pendentes", "historico"] = "pendentes",
    user: User = Depends(get_current_user_with_impersonation),
):
    _require_teacher(user)

    classes = {item["id"]: item for item in await _teacher_classes(user)}
    base = {"turma_id": {"$in": sorted(classes)}}
    status_filter = {"status": "pendente"} if escopo == "pendentes" else {"status": {"$in": ["aprovada", "rejeitada"]}}

    cursor = db.solicitacoes_turma.find({**base, **status_filter}, {"_id": 0})
    if escopo == "pendentes":
        cursor = cursor.sort("dataSolicitacao", 1).limit(200)  # oldest first: first come, first served
    else:
        cursor = cursor.sort("dataDecisao", -1).limit(HISTORY_LIMIT)
    requests = await cursor.to_list(length=200)

    pending_total = await db.solicitacoes_turma.count_documents({**base, "status": "pendente"})

    return {
        "requests": [public_request(item, classes.get(item["turma_id"])) for item in requests],
        "pendentes": pending_total,
    }


@router.patch("/teacher/requests/{request_id}")
async def decide_request(request_id: str, payload: JoinRequestDecision, user: User = Depends(get_current_user)):
    _require_teacher(user)

    document = await db.solicitacoes_turma.find_one({"id": request_id}, {"_id": 0})
    if not document:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada")

    turma = await _owned_class(user, document["turma_id"])
    now = now_utc()
    decision = {"decidido_por": user.id, "dataDecisao": now}

    if not payload.aprovar:
        result = await db.solicitacoes_turma.update_one(
            {"id": request_id, "status": "pendente"},
            {"$set": {**decision, "status": "rejeitada", "motivo_rejeicao": payload.motivo}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=409, detail="Esta solicitação já foi respondida ou cancelada.")
        await _notify(document["aluno_id"], user.id)
        return public_request({**document, **decision, "status": "rejeitada", "motivo_rejeicao": payload.motivo}, turma)

    # Approve: take the request first so a double click or a second tab cannot
    # approve twice, then place the student; undo the request state on failure.
    result = await db.solicitacoes_turma.update_one(
        {"id": request_id, "status": "pendente"},
        {"$set": {**decision, "status": "aprovada", "motivo_rejeicao": None}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Esta solicitação já foi respondida ou cancelada.")

    try:
        await link_student_to_class(document["aluno_id"], turma)
    except HTTPException as exc:
        student = await db.alunos.find_one({"id": document["aluno_id"]}, {"_id": 0, "turma_id": 1})
        if student and student.get("turma_id"):
            # The student meanwhile joined another class (e.g. by invite code).
            await db.solicitacoes_turma.update_one({"id": request_id}, {"$set": {"status": "cancelada", "motivo_rejeicao": "O aluno já entrou em outra turma"}})
            await _notify(document["aluno_id"], user.id)
            raise HTTPException(status_code=409, detail="O aluno já entrou em outra turma.") from exc
        await db.solicitacoes_turma.update_one({"id": request_id}, {"$set": {"status": "pendente", "decidido_por": None, "dataDecisao": None}})
        raise

    await cancel_pending_requests(document["aluno_id"], "Solicitação aprovada em outra turma")
    await publish_event(document["aluno_id"], "portal")
    await _notify(document["aluno_id"], user.id)
    await publish_user_event(user.id, "class_roster")

    return public_request({**document, **decision, "status": "aprovada", "motivo_rejeicao": None}, turma)
