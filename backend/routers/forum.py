"""Fórum de turma — chat de grupo estilo WhatsApp.

Mensagens por turma em tempo real via WebSocket de invalidações já existente:
- POST/GET usam a coleção `forum_mensagens` (histórico paginado por `criado_em`).
- Cada envio dispara `publish_class_event(turma_id, "forum")`; o cliente que
  estiver com o chat aberto refetcha o histórico incremental (since=timestamp).
- Paginação: o cliente carrega as últimas N mensagens (`?limit=50&before=...`)
  e busca apenas mensagens mais novas que a última conhecida (`?after=...`),
  evitando baixar o histórico antigo desnecessariamente.

Autorização:
  Professor: somente turmas atribuídas a ele (professor_id).
  Aluno: somente turmas em suas `turmas_ids` (multi-turmas) ou `turma_id` legado.
"""

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from lib.dates import now_utc
from lib.db import db
from lib.realtime import publish_class_event
from lib.security import get_current_user
from lib.impersonation import get_current_user_with_impersonation
from models.models import ForumMessageCreate, ForumMessageOut, User

router = APIRouter(prefix="/api/forum", tags=["forum"])

HISTORY_LIMIT = 50
MAX_LIMIT = 100


async def _avatar_of(user_doc: dict[str, Any]) -> str | None:
    """Avatar público do autor (preset → url estática; upload → data URL)."""
    avatar = user_doc.get("avatar")
    if not avatar:
        return None
    if avatar.get("tipo") == "upload":
        return avatar.get("image_base64")
    return f"/avatars/{avatar.get('avatar_id')}.svg"


def _serialize(document: dict[str, Any]) -> ForumMessageOut:
    return ForumMessageOut(
        id=document["id"],
        autor_id=document["autor_id"],
        autor_nome=document.get("autor_nome") or "Usuário",
        autor_tipo=document.get("autor_tipo") or "aluno",
        autor_avatar=document.get("autor_avatar"),
        texto=document["texto"],
        criado_em=document["criado_em"],
    )


async def _classes_of_student(aluno_id: str) -> list[str]:
    student = await db.alunos.find_one({"id": aluno_id}, {"_id": 0, "turma_id": 1, "turmas_ids": 1})
    if not student:
        return []
    ids = list(student.get("turmas_ids") or [])
    primary = student.get("turma_id")
    if primary and primary not in ids:
        ids.insert(0, primary)  # legado: turma única sem o array preenchido
    return ids


async def _classes_of_teacher(user: User) -> list[str]:
    cursor = db.turmas.find({"professor_id": user.id}, {"_id": 0, "id": 1})
    return [item["id"] async for item in cursor]


def _require_member(user: User, turma_id: str) -> None:
    """Membership is resolved by the caller (async); this is the role shape check."""
    if user.tipo not in ("professor", "aluno"):
        raise HTTPException(status_code=403, detail="Fórum disponível para alunos e professores")


async def _assert_membership(user: User, turma_id: str) -> None:
    """Only members of the class read or write its forum."""
    if user.tipo == "professor":
        classes = await _classes_of_teacher(user)
    elif user.tipo == "aluno" and user.aluno_id:
        classes = await _classes_of_student(user.aluno_id)
    else:
        raise HTTPException(status_code=403, detail="Fórum disponível apenas para o aluno ou professor da turma")

    _require_member(user, turma_id)

    if turma_id not in classes:
        raise HTTPException(status_code=403, detail="Você não participa desta turma")


@router.get("/turmas")
async def my_forum_classes(user: User = Depends(get_current_user_with_impersonation)):
    """Turmas em que o usuário pode conversar, com resumo para o seletor."""
    if user.tipo == "professor":
        cursor = db.turmas.find(
            {"professor_id": user.id},
            {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1, "alunos_ids": 1},
        ).sort("nome", 1)
        classes = [item async for item in cursor]
    elif user.tipo == "aluno" and user.aluno_id:
        class_ids = await _classes_of_student(user.aluno_id)
        cursor = db.turmas.find(
            {"id": {"$in": class_ids}},
            {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1, "alunos_ids": 1},
        ).sort("nome", 1)
        classes = [item async for item in cursor]
    else:
        raise HTTPException(status_code=403, detail="Fórum disponível para alunos e professores")

    return {
        "classes": [
            {
                "id": item["id"],
                "nome": item.get("nome") or "Turma",
                "modalidade": item.get("modalidade"),
                "ano": item.get("ano"),
                "total_membros": len(item.get("alunos_ids") or []),
            }
            for item in classes
        ]
    }


@router.get("/turmas/{turma_id}/mensagens")
async def list_messages(
    turma_id: str,
    limit: int = Query(default=HISTORY_LIMIT, ge=1, le=MAX_LIMIT),
    # ISO timestamps: `before` pagina o histórico (mensagens mais antigas),
    # `after` traz só as novas desde a última known message (tempo real).
    before: datetime | None = None,
    after: datetime | None = None,
    user: User = Depends(get_current_user_with_impersonation),
):
    await _assert_membership(user, turma_id)

    query: dict[str, Any] = {"turma_id": turma_id}
    if after is not None:
        query["criado_em"] = {"$gt": after}
    elif before is not None:
        query["criado_em"] = {"$lt": before}

    # Carga inicial/delta: pega as últimas N (sort DESC) e devolve em ordem
    # cronológica ASC (mais antiga em cima, mais nova embaixo — padrão WhatsApp).
    # Histórico (before=): pega as N anteriores (sort DESC) e devolve ASC também.
    cursor = (
        db.forum_mensagens.find(query, {"_id": 0})
        .sort("criado_em", -1)
        .limit(limit)
    )
    items = [item async for item in cursor]

    # Ordem cronológica ascendente na resposta (o chat renderiza de cima p/ baixo).
    items.reverse()
    has_more = len(items) == limit
    return {"mensagens": [_serialize(item) for item in items], "has_more": has_more}


@router.post("/turmas/{turma_id}/mensagens", status_code=201, response_model=ForumMessageOut)
async def send_message(turma_id: str, payload: ForumMessageCreate, user: User = Depends(get_current_user)):
    if user.tipo not in ("professor", "aluno"):
        raise HTTPException(status_code=403, detail="Fórum disponível para alunos e professores")

    await _assert_membership(user, turma_id)

    avatar = await _avatar_of(user.model_dump())
    document = {
        "id": str(uuid.uuid4()),
        "turma_id": turma_id,
        "autor_id": user.id,
        "autor_nome": user.nome,
        "autor_tipo": user.tipo,
        "autor_avatar": avatar,
        "texto": payload.texto.strip(),
        "criado_em": now_utc(),
    }
    await db.forum_mensagens.insert_one(document)

    # Tempo real: invalida o fórum da turma (change stream ou fallback local).
    await publish_class_event(turma_id, "forum")

    return _serialize(document)
