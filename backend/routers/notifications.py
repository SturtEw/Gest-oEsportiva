"""Notificações in-app do aluno/família.

Geradas automaticamente pelo backend nos gatilhos:
  a) aluno adicionado a uma nova atividade      (routers/class_activities.py)
  b) novo treino de turma atribuído ao aluno    (routers/class_activities.py —
     coberto pelo mesmo gatilho de atividade/turma quando o professor monta times)
  c) nova prescrição de treino individual       (routers/individual_workouts.py)

A mensagem sempre identifica quem fez a ação:
  "O Professor Ana Souza adicionou você na atividade Torneio Relâmpago."

Leitura:
  GET    /api/notifications            lista (não lidas primeiro), com contagem
  POST   /api/notifications/{id}/read  marca uma como lida
  POST   /api/notifications/read-all   marca todas como lidas
"""

from typing import Any

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from lib.db import db
from lib.realtime import publish_event
from lib.dates import now_utc
from lib.security import get_current_user
from models.models import User

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

LIST_LIMIT = 50


def _out(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": document["id"],
        "titulo": document.get("titulo", ""),
        "mensagem": document.get("mensagem", ""),
        "lida": bool(document.get("lida")),
        "link": document.get("link"),
        "criado_em": document.get("criado_em"),
    }


async def _student_user_ids(aluno_id: str) -> list[str]:
    """User accounts that should see this student's notifications: the student
    itself and any guardian linked to it."""
    ids: list[str] = []
    student = await db.alunos.find_one({"id": aluno_id}, {"_id": 0, "responsavel_id": 1})
    cursor = db.users.find({"$or": [{"aluno_id": aluno_id}, {"tipo": "responsavel", "filhos_ids": aluno_id}]}, {"_id": 0, "id": 1})
    async for item in cursor:
        ids.append(item["id"])
    return ids


async def notify_student(
    aluno_id: str,
    titulo: str,
    mensagem: str,
    link: str | None = None,
) -> None:
    """Create the notification for every account tied to the student and ping
    their realtime channel. Used by the trigger points (activities, workouts)."""
    user_ids = await _student_user_ids(aluno_id)
    if not user_ids:
        return
    now = now_utc()
    documents = [
        {
            "id": _uuid(),
            "destinatario_id": user_id,
            "aluno_id": aluno_id,
            "titulo": titulo,
            "mensagem": mensagem,
            "lida": False,
            "link": link,
            "criado_em": now,
        }
        for user_id in user_ids
    ]
    await db.notificacoes.insert_many(documents)
    for user_id in user_ids:
        await publish_event(user_id, "notifications")


@router.get("")
async def list_notifications(limit: int = Query(default=LIST_LIMIT, ge=1, le=100), user: User = Depends(get_current_user)):
    cursor = (
        db.notificacoes.find({"destinatario_id": user.id}, {"_id": 0})
        .sort("criado_em", -1)
        .limit(limit)
    )
    items = [item async for item in cursor]
    unread = sum(1 for item in items if not item.get("lida"))
    return {"notifications": [_out(item) for item in items], "unread": unread}


@router.post("/{notification_id}/read")
async def mark_read(notification_id: str, user: User = Depends(get_current_user)):
    result = await db.notificacoes.update_one(
        {"id": notification_id, "destinatario_id": user.id},
        {"$set": {"lida": True}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notificação não encontrada")
    await publish_event(user.id, "notifications")
    return {"id": notification_id, "lida": True}


@router.post("/read-all")
async def mark_all_read(user: User = Depends(get_current_user)):
    result = await db.notificacoes.update_many(
        {"destinatario_id": user.id, "lida": False},
        {"$set": {"lida": True}},
    )
    await publish_event(user.id, "notifications")
    return {"modified": result.modified_count}
