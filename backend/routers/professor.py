"""Teacher-only replies and manually scored student achievements."""


import uuid
from typing import Any


from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator


from lib.dates import now_utc
from lib.db import db
from lib.portal_access import require_assigned_professor
from lib.realtime import publish_event, publish_user_event
from lib.impersonation import get_current_user_with_impersonation
from lib.security import get_current_user
from models.models import ConquistaCreate, QuestionMessage, StudentMessagePublic, User


router = APIRouter(prefix="/api/professor", tags=["teacher portal"])

class ProfessorReplyCreate(BaseModel):
    texto: str = Field(min_length=1, max_length=2000)


    @field_validator("texto")

    @classmethod

    def mensagem_nao_vazia(cls, value: str) -> str:
        stripped = value.strip()

        if not stripped:
            raise ValueError("Escreva a resposta antes de enviar")

        return stripped


async def _public_message(document: dict[str, Any]) -> StudentMessagePublic:
    sender = await db.users.find_one({"id": document["autor_id"]}, {"_id": 0, "nome": 1})

    return StudentMessagePublic(
        id=document["id"],
        autor_nome=sender.get("nome") if sender else "Professor",
        autor_tipo="professor",
        texto=document["texto"],
        dataEnvio=document["dataEnvio"],
    )


@router.get("/students/{aluno_id}/questions", response_model=list[StudentMessagePublic])

async def get_questions_for_teacher(aluno_id: str, user: User = Depends(get_current_user_with_impersonation)):
    await require_assigned_professor(user, aluno_id)

    cursor = db.duvidas.find({"aluno_id": aluno_id, "professor_id": user.id}, {"_id": 0}).sort("dataEnvio", -1).limit(100)

    documents = await cursor.to_list(length=100)

    autor_ids = list({doc["autor_id"] for doc in documents})
    users_cursor = db.users.find({"id": {"$in": autor_ids}}, {"_id": 0, "id": 1, "nome": 1})
    users = await users_cursor.to_list(length=len(autor_ids))
    user_lookup = {u["id"]: u.get("nome") for u in users}

    messages = []

    for document in reversed(documents):
        messages.append(
            StudentMessagePublic(
                id=document["id"],
                autor_nome=user_lookup.get(document["autor_id"], "Usuário vinculado"),
                autor_tipo=document["autor_tipo"],
                texto=document["texto"],
                dataEnvio=document["dataEnvio"],
            )
        )

    return messages


@router.post("/students/{aluno_id}/questions", response_model=StudentMessagePublic, status_code=201)

async def reply_to_student(aluno_id: str, payload: ProfessorReplyCreate, user: User = Depends(get_current_user)):
    student, class_doc = await require_assigned_professor(user, aluno_id)

    document = QuestionMessage(
        id=str(uuid.uuid4()),
        aluno_id=student.id,
        turma_id=student.turma_id or "",
        professor_id=user.id,
        autor_id=user.id,
        autor_tipo="professor",
        texto=payload.texto,
        dataEnvio=now_utc(),
    ).model_dump()

    await db.duvidas.insert_one(document)

    await publish_event(student.id, "questions")

    await publish_user_event(user.id, "questions")

    return await _public_message(document)


@router.post("/students/{aluno_id}/achievements", status_code=201)

async def award_achievement(aluno_id: str, payload: ConquistaCreate, user: User = Depends(get_current_user)):
    student, _class_doc = await require_assigned_professor(user, aluno_id)

    document = {
        "id": str(uuid.uuid4()),
        "aluno_id": student.id,
        "turma_id": student.turma_id,
        "professor_id": user.id,
        "badge_id": payload.badge_id,
        "nome": payload.nome.strip(),
        "pontos": payload.pontos,
        "dataObtencao": now_utc(),
    }

    await db.conquistas.insert_one(document)

    await publish_event(student.id, "achievements")

    await publish_user_event(user.id, "achievements")

    return {key: value for key, value in document.items() if key not in {"professor_id", "turma_id"}}
