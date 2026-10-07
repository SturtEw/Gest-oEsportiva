"""Root-admin account review, class provisioning and read-only student inspection."""


import uuid
from typing import Any


from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field


from lib.dates import now_utc
from lib.db import client, db
from lib.realtime import publish_admin_event, publish_event, publish_user_event
from lib.security import get_current_user, revoke_user_tokens
from models.models import Aluno, TurmaCreate, User
from services.student_portal import build_student_payload


router = APIRouter(prefix="/api/admin", tags=["root administration"])

def _require_root(user: User) -> None:
    if user.tipo != "admin" or not user.is_root_admin:
        raise HTTPException(status_code=403, detail="Apenas o administrador raiz pode gerenciar esta área")


async def _audit(user: User, action: str, subject_id: str, metadata: dict[str, Any] | None = None) -> None:
    await db.admin_audit.insert_one({

        "id": str(uuid.uuid4()),

        "actor_id": user.id,

        "action": action,

        "subject_id": subject_id,

        "metadata": metadata or {},

        "created_at": now_utc(),

    })


class ReviewDecision(BaseModel):
    aprovado: bool

    motivo: str | None = Field(default=None, min_length=5, max_length=1000)


    @classmethod

    def validate_reason(cls, values):
        return values


class AssignClassInput(BaseModel):
    turma_id: str


@router.get("/summary")

async def admin_summary(user: User = Depends(get_current_user)):
    _require_root(user)

    return {

        "professores_pendentes": await db.users.count_documents({"tipo": "professor", "status": "pendente"}),

        "notificacoes_pendentes": await db.admin_notifications.count_documents({"status": "unread"}),

        "alunos_sem_turma": await db.alunos.count_documents({"turma_id": None}),

        "turmas": await db.turmas.count_documents({}),

    }


@router.get("/notifications")

async def list_notifications(

    unread_only: bool = Query(default=True, description="Retorna somente notificações não lidas"),

    user: User = Depends(get_current_user),


):
    _require_root(user)

    filters = {"status": "unread"} if unread_only else {}

    cursor = db.admin_notifications.find(

        filters,

        {"_id": 0, "id": 1, "tipo": 1, "user_id": 1, "nome": 1, "email": 1, "status": 1, "dataCriacao": 1, "dataLeitura": 1},

    ).sort("dataCriacao", -1).limit(100)

    return {"notifications": await cursor.to_list(length=100)}


@router.patch("/notifications/{notification_id}")

async def mark_notification_read(notification_id: str, user: User = Depends(get_current_user)):
    _require_root(user)

    now = now_utc()

    result = await db.admin_notifications.update_one(

        {"id": notification_id, "status": "unread"},

        {"$set": {"status": "read", "dataLeitura": now}},

    )

    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Notificação não encontrada")

    await _audit(user, "admin_notification_read", notification_id)

    return {"id": notification_id, "status": "read", "dataLeitura": now}


@router.post("/notifications/read-all")

async def mark_all_notifications_read(user: User = Depends(get_current_user)):
    _require_root(user)

    now = now_utc()

    result = await db.admin_notifications.update_many(

        {"status": "unread"},

        {"$set": {"status": "read", "dataLeitura": now}},

    )

    if result.modified_count:
        await _audit(user, "admin_notifications_read_all", "all", {"count": result.modified_count})

    return {"modified_count": result.modified_count, "dataLeitura": now}


@router.get("/teacher-applications")

async def teacher_applications(user: User = Depends(get_current_user)):
    _require_root(user)

    cursor = db.users.find(

        {"tipo": "professor", "status": "pendente"},

        {"_id": 0, "id": 1, "nome": 1, "email": 1, "formacao_academica": 1, "area_atuacao": 1, "documento_tipo": 1, "documento_final": 1, "dataCriacao": 1},

    ).sort("dataCriacao", 1).limit(200)

    return {"applications": await cursor.to_list(length=200)}


@router.patch("/teacher-applications/{teacher_id}")

async def review_teacher_application(teacher_id: str, decision: ReviewDecision, user: User = Depends(get_current_user)):
    _require_root(user)

    if not decision.aprovado and not decision.motivo:
        raise HTTPException(status_code=422, detail="Informe o motivo da reprovação")

    status = "ativo" if decision.aprovado else "reprovado"

    now = now_utc()

    result = await db.users.update_one(

        {"id": teacher_id, "tipo": "professor", "status": "pendente"},

        {"$set": {

            "status": status,

            "motivo_reprovacao": None if decision.aprovado else decision.motivo,

            "revisado_por": user.id,

            "data_revisao": now,

        }},

    )

    if not result.modified_count:
        raise HTTPException(status_code=404, detail="Cadastro pendente não encontrado")

    if not decision.aprovado:
        await revoke_user_tokens(teacher_id)

    await db.admin_notifications.update_many({"user_id": teacher_id, "status": "unread"}, {"$set": {"status": "read", "dataLeitura": now}})

    await _audit(user, "teacher_application_approved" if decision.aprovado else "teacher_application_rejected", teacher_id, {"reason": decision.motivo if not decision.aprovado else None})

    await publish_user_event(teacher_id, "account_status")

    await publish_admin_event("teacher_applications")

    return {"id": teacher_id, "status": status, "revisado_em": now}


@router.get("/students")

async def list_students(

    q: str = Query(default="", max_length=100),

    unassigned: bool = True,

    limit: int = Query(default=50, ge=1, le=100),

    user: User = Depends(get_current_user),


):
    _require_root(user)

    filters: dict[str, Any] = {"turma_id": None} if unassigned else {}

    if q.strip():
        filters["nome"] = {"$regex": q.strip(), "$options": "i"}

    cursor = db.alunos.find(filters, {"_id": 0, "id": 1, "nome": 1, "turma_id": 1, "data_nascimento": 1}).sort("nome", 1).limit(limit)

    return {"students": await cursor.to_list(length=limit)}


@router.get("/teachers")

async def list_approved_teachers(user: User = Depends(get_current_user)):
    _require_root(user)

    cursor = db.users.find({"tipo": "professor", "status": "ativo"}, {"_id": 0, "id": 1, "nome": 1, "email": 1}).sort("nome", 1).limit(200)

    return {"teachers": await cursor.to_list(length=200)}

@router.get("/view-as-targets")
async def view_as_targets(user: User = Depends(get_current_user)):
    _require_root(user)
    professores = await db.users.find(
        {"tipo": "professor", "status": "ativo"}, {"_id": 0, "id": 1, "nome": 1}
    ).sort("nome", 1).limit(200).to_list(length=200)
    alunos = await db.users.find(
        {"tipo": "aluno", "status": "ativo", "aluno_id": {"$nin": [None, ""]}},
        {"_id": 0, "id": 1, "nome": 1, "aluno_id": 1},
    ).sort("nome", 1).limit(200).to_list(length=200)
    return {"professores": professores, "alunos": alunos}

@router.get("/classes")

async def list_classes(user: User = Depends(get_current_user)):
    _require_root(user)

    classes = []

    # "professor_id" DEVE estar na projeção: sem ele o admin vê a turma sempre
    # como "Sem professor vinculado", mesmo depois de atribuir (o PATCH persiste,
    # mas o read descartava o campo).
    async for record in db.turmas.find({}, {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1, "capacidade": 1, "alunos_ids": 1, "professor_id": 1}).sort("nome", 1).limit(200):
        classes.append({

            "id": record["id"],

            "nome": record["nome"],

            "modalidade": record["modalidade"],

            "ano": record["ano"],

            "capacidade": record.get("capacidade", 20),

            "alunos_count": len(record.get("alunos_ids", [])),

            "professor_id": record.get("professor_id"),

        })

    return {"classes": classes}


@router.post("/classes", status_code=201)

async def create_class(payload: TurmaCreate, user: User = Depends(get_current_user)):
    _require_root(user)

    if payload.professor_id:
        teacher = await db.users.find_one({"id": payload.professor_id, "tipo": "professor", "status": "ativo"}, {"_id": 1})

        if not teacher:
            raise HTTPException(status_code=422, detail="Escolha um professor aprovado")

    document = payload.model_dump()

    document.update({"id": str(uuid.uuid4()), "alunos_ids": [], "dataCriacao": now_utc()})

    await db.turmas.insert_one(document)

    await _audit(user, "class_created", document["id"], {"nome": document["nome"]})

    await publish_admin_event("classes")

    return {key: value for key, value in document.items() if key != "alunos_ids"}


@router.patch("/classes/{turma_id}/teacher")

async def assign_teacher_to_class(turma_id: str, teacher_id: str | None = None, user: User = Depends(get_current_user)):
    _require_root(user)

    turma = await db.turmas.find_one({"id": turma_id}, {"_id": 0, "id": 1, "nome": 1})

    if not turma:
        raise HTTPException(status_code=404, detail="Turma não encontrada")

    if teacher_id:
        teacher = await db.users.find_one({"id": teacher_id, "tipo": "professor", "status": "ativo"}, {"_id": 0, "id": 1})

        if not teacher:
            raise HTTPException(status_code=422, detail="Escolha um professor aprovado")

        await db.turmas.update_one({"id": turma_id}, {"$set": {"professor_id": teacher_id}})

    else:
        await db.turmas.update_one({"id": turma_id}, {"$unset": {"professor_id": ""}})

    await _audit(user, "class_teacher_assigned", turma_id, {"teacher_id": teacher_id})

    await publish_admin_event("classes")

    if teacher_id:
        await publish_user_event(teacher_id, "classes")

    return {"turma_id": turma_id, "professor_id": teacher_id}


@router.patch("/students/{aluno_id}/class")

async def assign_student_to_class(aluno_id: str, payload: AssignClassInput, user: User = Depends(get_current_user)):
    _require_root(user)

    async with client.start_session() as session:
        async with await session.start_transaction():
            try:
                student = await db.alunos.find_one({"id": aluno_id}, {"_id": 0, "id": 1, "nome": 1, "turma_id": 1}, session=session)

                if not student:
                    raise HTTPException(status_code=404, detail="Aluno não encontrado")

                turma = await db.turmas.find_one({"id": payload.turma_id}, {"_id": 0, "id": 1, "nome": 1, "capacidade": 1, "alunos_ids": 1}, session=session)

                if not turma:
                    raise HTTPException(status_code=404, detail="Turma não encontrada")

                members = turma.get("alunos_ids", [])

                if aluno_id not in members and len(members) >= int(turma.get("capacidade", 20)):
                    raise HTTPException(status_code=409, detail="Esta turma atingiu a capacidade cadastrada")

                previous_class_id = student.get("turma_id")

                if previous_class_id and previous_class_id != payload.turma_id:
                    await db.turmas.update_one({"id": previous_class_id}, {"$pull": {"alunos_ids": aluno_id}}, session=session)

                await db.alunos.update_one({"id": aluno_id}, {"$set": {"turma_id": payload.turma_id}}, session=session)

                await db.turmas.update_one({"id": payload.turma_id}, {"$addToSet": {"alunos_ids": aluno_id}}, session=session)

                await _audit(user, "student_class_assigned", aluno_id, {"class_id": payload.turma_id})

                await session.commit_transaction()

            except Exception:
                await session.abort_transaction()

                raise

    # Post-transaction events (outside transaction to avoid failures)
    await publish_event(aluno_id, "portal")

    await publish_admin_event("unassigned_students")

    if turma.get("professor_id"):
        await publish_user_event(turma["professor_id"], "class_roster")

    return {"id": aluno_id, "nome": student["nome"], "turma_id": payload.turma_id, "turma_nome": turma["nome"]}


@router.delete("/classes/{turma_id}", status_code=200)

async def delete_class(turma_id: str, user: User = Depends(get_current_user)):
    """Exclusão de turma: exclusivamente do administrador raiz.

    Remove o documento da turma e desvincula (não exclui) os alunos e o
    professor que estavam associados, mantendo as contas intactas.
    """
    _require_root(user)

    turma = await db.turmas.find_one({"id": turma_id}, {"_id": 0, "id": 1, "nome": 1, "alunos_ids": 1, "professor_id": 1})

    if not turma:
        raise HTTPException(status_code=404, detail="Turma não encontrada")

    member_ids = list(turma.get("alunos_ids", []))

    if member_ids:
        await db.alunos.update_many({"id": {"$in": member_ids}}, {"$set": {"turma_id": None}})

    await db.turmas.delete_one({"id": turma_id})

    await _audit(user, "class_deleted", turma_id, {"nome": turma["nome"], "students_unlinked": len(member_ids)})

    # Post-transaction events (outside transaction to avoid failures)
    await publish_admin_event("classes")

    await publish_admin_event("unassigned_students")

    if turma.get("professor_id"):
        await publish_user_event(turma["professor_id"], "classes")

    for member_id in member_ids:
        await publish_event(member_id, "portal")

    return {"id": turma_id, "nome": turma["nome"], "status": "excluida", "students_unlinked": len(member_ids)}


@router.get("/teacher-workspace")

async def inspect_teacher_workspace(user: User = Depends(get_current_user)):
    _require_root(user)

    teacher_map = {record["id"]: record["nome"] async for record in db.users.find({"tipo": "professor"}, {"_id": 0, "id": 1, "nome": 1})}

    result = []

    async for turma in db.turmas.find({}, {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1, "professor_id": 1, "alunos_ids": 1}).sort("nome", 1).limit(200):
        students = await db.alunos.find({"turma_id": turma["id"]}, {"_id": 0, "id": 1, "nome": 1}).sort("nome", 1).limit(200).to_list(length=200)

        result.append({"id": turma["id"], "nome": turma["nome"], "modalidade": turma["modalidade"], "ano": turma["ano"], "professor_nome": teacher_map.get(turma.get("professor_id"), "Professor não informado"), "professor_id": turma.get("professor_id"), "alunos": students})

    return {"read_only": True, "classes": result}


@router.get("/students/{aluno_id}/portal")

async def inspect_student(aluno_id: str, user: User = Depends(get_current_user)):
    _require_root(user)

    document = await db.alunos.find_one({"id": aluno_id}, {"_id": 0})

    if not document:
        raise HTTPException(status_code=404, detail="Aluno não encontrado")

    student = Aluno.model_validate(document)

    payload = await build_student_payload(student)

    await _audit(user, "student_portal_inspected", aluno_id)

    return {"read_only": True, "inspected_by": user.nome, "student_portal": payload}
