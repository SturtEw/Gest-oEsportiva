"""Training prescriptions: individual (personal) or group (class)."""


import uuid
from typing import Any


from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field


from lib.dates import now_utc
from lib.db import db
from lib.portal_access import get_authorized_aluno, require_assigned_professor
from lib.realtime import publish_event, publish_user_event
from lib.security import get_current_user
from models.models import (

    ExecucaoTreinamento,
    ExecucaoTreinamentoCreate,

    Treinamento,

    TreinamentoCreate,

    User,


)


router = APIRouter(prefix="/api/treinamentos", tags=["treinamentos"])


class TreinamentoResponse(BaseModel):
    mensagem: str

    treinamentoId: str

    volumeExercicios: int


class TreinamentosAlunoResponse(BaseModel):
    alunoId: str

    totalTreinos: int

    treinos: list[Treinamento]


class ExecucaoResponse(BaseModel):
    mensagem: str

    registroExecucao: ExecucaoTreinamento


@router.post("/prescrever", response_model=TreinamentoResponse, status_code=201)

async def prescrever_treinamento(payload: TreinamentoCreate, user: User = Depends(get_current_user)):
    if user.tipo not in ("admin", "professor"):
        raise HTTPException(status_code=403, detail="Acesso restrito a professores e administradores")

    if payload.alunoId:
        aluno = await db.alunos.find_one({"id": payload.alunoId}, {"_id": 0, "id": 1, "turma_id": 1})

        if not aluno:
            raise HTTPException(status_code=404, detail="Aluno não encontrado")

        if user.tipo == "professor" and aluno.get("turma_id"):
            await require_assigned_professor(user, payload.alunoId)

    elif payload.turmaId:
        turma = await db.turmas.find_one({"id": payload.turmaId}, {"_id": 0, "id": 1, "professor_id": 1})

        if not turma:
            raise HTTPException(status_code=404, detail="Turma não encontrada")

        if user.tipo == "professor" and turma.get("professor_id") != user.id:
            raise HTTPException(status_code=403, detail="Esta turma não está sob sua responsabilidade")

    treinamento_id = str(uuid.uuid4())

    now = now_utc()

    novo_treinamento = Treinamento(

        treinamentoId=treinamento_id,

        professorId=user.id,

        titulo=payload.titulo.strip(),

        descricao=payload.descricao.strip() if payload.descricao else "",

        objetivo=payload.objetivo,

        alunoId=payload.alunoId,

        turmaId=payload.turmaId,

        dataInicio=payload.dataInicio,

        dataFim=payload.dataFim,

        exercicios=payload.exercicios,

        ativo=True,

        dataCriacao=now,

    )

    await db.treinamentos.insert_one(novo_treinamento.model_dump())

    if payload.alunoId:
        await publish_event(payload.alunoId, "treinamentos")

    elif payload.turmaId:
        alunos_turma = await db.alunos.find({"turma_id": payload.turmaId}, {"_id": 0, "id": 1}).to_list(length=500)

        for aluno in alunos_turma:
            await publish_event(aluno["id"], "treinamentos")

    mensagem = "Treino individual prescrito com sucesso!" if payload.alunoId else "Treino coletivo prescrito com sucesso!"

    return TreinamentoResponse(

        mensagem=mensagem,

        treinamentoId=treinamento_id,

        volumeExercicios=len(payload.exercicios),

    )


async def _fetch_treinos(query: dict) -> list[Treinamento]:
    """Run a training query and return up to 200 Treinamento objects, newest first."""
    cursor = db.treinamentos.find(query, {"_id": 0}).sort("dataInicio", -1)
    docs = await cursor.to_list(length=200)

    return [Treinamento(**doc) for doc in docs]


@router.get("/aluno/{aluno_id}", response_model=TreinamentosAlunoResponse)

async def listar_treinamentos_aluno(

    aluno_id: str,

    turmaId: str | None = Query(default=None, alias="turmaId"),

    user: User = Depends(get_current_user),


):
    student = await get_authorized_aluno(user, aluno_id)

    treinos: list[Treinamento] = []

    treinos.extend(await _fetch_treinos({"alunoId": aluno_id, "ativo": True}))

    if turmaId:
        await require_assigned_professor(user, aluno_id)

        treinos.extend(await _fetch_treinos({"turmaId": turmaId, "ativo": True}))

    elif student.turma_id:
        treinos.extend(await _fetch_treinos({"turmaId": student.turma_id, "ativo": True}))

    treinos.sort(key=lambda t: t.dataInicio, reverse=True)

    return TreinamentosAlunoResponse(

        alunoId=aluno_id,

        totalTreinos=len(treinos),

        treinos=treinos,

    )


@router.post("/{treinamento_id}/executar", response_model=ExecucaoResponse, status_code=201)

async def registrar_execucao(

    treinamento_id: str,

    payload: ExecucaoTreinamentoCreate,

    user: User = Depends(get_current_user),


):
    treinamento = await db.treinamentos.find_one({"treinamentoId": treinamento_id}, {"_id": 0})

    if not treinamento:
        raise HTTPException(status_code=404, detail="Treinamento não encontrado")

    if treinamento.get("alunoId") != payload.alunoId and treinamento.get("turmaId") is None:
        raise HTTPException(status_code=403, detail="Este treinamento não pertence a este aluno")

    if treinamento.get("turmaId"):
        aluno = await db.alunos.find_one({"id": payload.alunoId}, {"_id": 0, "turma_id": 1})

        if not aluno or aluno.get("turma_id") != treinamento.get("turmaId"):
            raise HTTPException(status_code=403, detail="Aluno não pertence à turma deste treinamento")

    if user.tipo == "aluno" and user.aluno_id != payload.alunoId:
        raise HTTPException(status_code=403, detail="Alunos só podem registrar seus próprios treinos")

    if user.tipo == "responsavel":
        responsavel = await db.users.find_one({"id": user.id}, {"_id": 0, "filhos_ids": 1})

        if payload.alunoId not in responsavel.get("filhos_ids", []):
            raise HTTPException(status_code=403, detail="Você não tem autorização para registrar treino deste aluno")

    execucao_id = str(uuid.uuid4())

    now = now_utc()

    execucao = ExecucaoTreinamento(

        execucaoId=execucao_id,

        treinamentoId=treinamento_id,

        alunoId=payload.alunoId,

        dataExecucao=now,

        esforcoPercebido=payload.feedbackEsforco,

    )

    await db.execucoes_treinamentos.insert_one(execucao.model_dump())

    await publish_event(payload.alunoId, "treinamentos")

    return ExecucaoResponse(

        mensagem="Treino registrado com sucesso! Continue o bom trabalho.",

        registroExecucao=execucao,

    )


@router.get("/{treinamento_id}", response_model=Treinamento)

async def obter_treinamento(treinamento_id: str, user: User = Depends(get_current_user)):
    treinamento = await db.treinamentos.find_one({"treinamentoId": treinamento_id}, {"_id": 0})

    if not treinamento:
        raise HTTPException(status_code=404, detail="Treinamento não encontrado")

    if treinamento.get("alunoId"):
        await get_authorized_aluno(user, treinamento["alunoId"])

    elif treinamento.get("turmaId"):
        if user.tipo == "professor":
            turma = await db.turmas.find_one({"id": treinamento["turmaId"]}, {"_id": 0, "professor_id": 1})

            if not turma or turma.get("professor_id") != user.id:
                raise HTTPException(status_code=403, detail="Sem acesso a este treinamento")

        elif user.tipo == "aluno":
            await get_authorized_aluno(user, user.aluno_id)

            aluno = await db.alunos.find_one({"id": user.aluno_id}, {"_id": 0, "turma_id": 1})

            if not aluno or aluno.get("turma_id") != treinamento["turmaId"]:
                raise HTTPException(status_code=403, detail="Sem acesso a este treinamento")

    return Treinamento(**treinamento)
