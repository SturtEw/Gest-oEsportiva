"""Student-safe records, opt-in ranking and two-way questions."""


import uuid
from typing import Any


from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator


from lib.dates import now_utc, today_in_app_tz
from lib.db import db
from lib.portal_access import get_authorized_aluno
from lib.realtime import publish_event
from lib.impersonation import get_current_user_with_impersonation
from models.models import RankingPreferenceUpdate, RankingResponse, StudentMessagePublic, User
from services.student_portal import build_student_payload


router = APIRouter(prefix="/api/student", tags=["student portal"])

class QuestionMessageCreate(BaseModel):
    texto: str = Field(min_length=1, max_length=2000)


    @field_validator("texto")

    @classmethod

    def mensagem_nao_vazia(cls, value: str) -> str:
        stripped = value.strip()

        if not stripped:
            raise ValueError("Escreva sua dúvida antes de enviar")

        return stripped


def _display_name(name: str) -> str:
    pieces = name.strip().split()

    return pieces[0] + (f" {pieces[-1][0]}." if len(pieces) > 1 else "")


async def _public_message(document: dict[str, Any]) -> StudentMessagePublic:
    sender = await db.users.find_one({"id": document["autor_id"]}, {"_id": 0, "nome": 1})

    name = sender.get("nome") if sender else {"professor": "Professor", "responsavel": "Responsável", "aluno": "Aluno"}[document["autor_tipo"]]

    return StudentMessagePublic(

        id=document["id"],

        autor_nome=name,

        autor_tipo=document["autor_tipo"],

        texto=document["texto"],

        dataEnvio=document["dataEnvio"],

    )


@router.get("/portal")

async def student_portal(aluno_id: str | None = None, user: User = Depends(get_current_user_with_impersonation)):
    if user.tipo == "aluno":
        requested_id = user.aluno_id

        if not requested_id:
            raise HTTPException(status_code=403, detail="Esta conta não está vinculada a um cadastro de aluno")

    elif user.tipo == "responsavel":
        if not aluno_id:
            raise HTTPException(status_code=422, detail="Escolha um aluno vinculado")

        requested_id = aluno_id

    else:
        raise HTTPException(status_code=403, detail="Acesso restrito à área do aluno")

    student = await get_authorized_aluno(user, requested_id)

    return await build_student_payload(student)


@router.get("/me/classes")

async def my_classes(user: User = Depends(get_current_user_with_impersonation)):
    """Multi-enrollment: todas as turmas do aluno (ou do filho selecionado via ?aluno_id)."""
    if user.tipo == "aluno":
        aluno_id = user.aluno_id

        if not aluno_id:
            raise HTTPException(status_code=403, detail="Esta conta não está vinculada a um cadastro de aluno")

    elif user.tipo == "responsavel":
        raise HTTPException(status_code=422, detail="Escolha um aluno vinculado")

    else:
        raise HTTPException(status_code=403, detail="Acesso restrito à área do aluno")

    student = await get_authorized_aluno(user, aluno_id)

    ids = list(student.turmas_ids or [])

    if student.turma_id and student.turma_id not in ids:
        ids.insert(0, student.turma_id)  # legado

    cursor = db.turmas.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1, "professor_id": 1},
    ).sort("nome", 1)

    documents = [item async for item in cursor]

    professor_ids = {item["professor_id"] for item in documents if item.get("professor_id")}

    professors = {
        item["id"]: item.get("nome")
        async for item in db.users.find({"id": {"$in": sorted(professor_ids)}}, {"_id": 0, "id": 1, "nome": 1})
    }

    turmas = [
        {
            **item,
            "professor_nome": professors.get(item.get("professor_id")),
        }
        for item in documents
    ]

    return {"turmas": turmas, "turma_id": student.turma_id}


@router.patch("/me/ranking-preference")

async def update_ranking_preference(payload: RankingPreferenceUpdate, user: User = Depends(get_current_user_with_impersonation)):
    if user.tipo != "aluno" or not user.aluno_id:
        raise HTTPException(status_code=403, detail="Somente o próprio aluno pode alterar esta preferência")

    timestamp = now_utc()

    result = await db.alunos.update_one(

        {"id": user.aluno_id},

        {"$set": {"participa_ranking": payload.participa_ranking, "consentimentoRankingAtualizadoEm": timestamp}},

    )

    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Aluno não encontrado")

    await publish_event(user.aluno_id, "ranking")

    return {"participa_ranking": payload.participa_ranking, "atualizado_em": timestamp}


@router.get("/{aluno_id}/ranking", response_model=RankingResponse)

async def get_class_ranking(aluno_id: str, user: User = Depends(get_current_user_with_impersonation)):
    student = await get_authorized_aluno(user, aluno_id)

    if not student.participa_ranking or not student.turma_id:
        return RankingResponse(enabled=False, entries=[])

    pipeline = [

        {"$match": {"turma_id": student.turma_id, "participa_ranking": True}},

        {

            "$lookup": {

                "from": "conquistas",

                "localField": "id",

                "foreignField": "aluno_id",

                "as": "awards",

            }

        },

        {

            "$addFields": {

                "pontosAtuais": {

                    "$sum": {

                        "$map": {

                            "input": "$awards",

                            "as": "award",

                            "in": {"$ifNull": ["$$award.pontos", 0]},

                        }

                    }

                }

            }

        },

        {"$project": {"_id": 0, "id": 1, "nome": 1, "pontosAtuais": 1}},

        {"$sort": {"pontosAtuais": -1, "nome": 1}},

    ]

    participants = await (await db.alunos.aggregate(pipeline)).to_list(length=200)

    entries = []

    last_points: int | None = None

    last_position = 0

    for index, participant in enumerate(participants, start=1):
        points = int(participant.get("pontosAtuais") or 0)

        if last_points is None or points != last_points:
            last_position = index

            last_points = points

        entries.append({"posicao": last_position, "nome": _display_name(participant.get("nome", "Aluno")), "pontos": points})

    return RankingResponse(enabled=True, entries=entries)


@router.get("/{aluno_id}/questions", response_model=list[StudentMessagePublic])

async def get_student_questions(aluno_id: str, user: User = Depends(get_current_user_with_impersonation)):
    student = await get_authorized_aluno(user, aluno_id)

    cursor = db.duvidas.find({"aluno_id": student.id}, {"_id": 0}).sort("dataEnvio", -1).limit(100)

    documents = await cursor.to_list(length=100)

    messages = [await _public_message(document) for document in reversed(documents)]

    return messages


@router.post("/{aluno_id}/questions", response_model=StudentMessagePublic, status_code=201)

async def create_student_question(aluno_id: str, payload: QuestionMessageCreate, user: User = Depends(get_current_user_with_impersonation)):
    student = await get_authorized_aluno(user, aluno_id)

    if not student.turma_id:
        raise HTTPException(status_code=409, detail="Este aluno ainda não está vinculado a uma turma")

    class_doc = await db.turmas.find_one({"id": student.turma_id}, {"_id": 0, "id": 1, "professor_id": 1})

    if not class_doc or not class_doc.get("professor_id"):
        raise HTTPException(status_code=409, detail="Sua turma ainda não tem um professor vinculado para receber dúvidas")

    document = {

        "id": str(uuid.uuid4()),

        "aluno_id": student.id,

        "turma_id": student.turma_id,

        "professor_id": class_doc["professor_id"],

        "autor_id": user.id,

        "autor_tipo": user.tipo,

        "texto": payload.texto,

        "dataEnvio": now_utc(),

    }

    await db.duvidas.insert_one(document)

    await publish_event(student.id, "questions")

    return await _public_message(document)


@router.get("/{aluno_id}/schedule")

async def unavailable_schedule(aluno_id: str, user: User = Depends(get_current_user_with_impersonation)):
    student = await get_authorized_aluno(user, aluno_id)

    if not student.turma_id:
        raise HTTPException(status_code=409, detail="Este aluno ainda não está vinculado a uma turma")

    turma = await db.turmas.find_one({"id": student.turma_id}, {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1})

    if not turma:
        raise HTTPException(status_code=404, detail="Turma não encontrada")

    hoje = today_in_app_tz().isoformat()

    cursor = db.agenda_aulas.find(
        {"turma_id": student.turma_id, "ativo": True, "data_aula": {"$gte": hoje}},
        {"_id": 0},
    ).sort([("data_aula", 1), ("horaInicio", 1)])

    items = [
        {
            "id": item.get("id"),
            "turma_id": item.get("turma_id"),
            "turma_nome": turma.get("nome", "Turma"),
            "modalidade": turma.get("modalidade"),
            "ano": turma.get("ano"),
            "data_aula": item.get("data_aula"),
            "horaInicio": item.get("horaInicio"),
            "duracao_minutos": item.get("duracao_minutos", 60),
            "local": item.get("local"),
            "observacoes": item.get("observacoes", ""),
        }
        async for item in cursor
    ]

    return {"items": items}
