"""Notificações in-app: helper compartilhado usado pelos gatilhos.

Chamado por routers (atividades, treinos individuais e de turma) para gravar a
notificação com a frase que identifica o autor da ação:
  "O Professor Ana Souza adicionou você na atividade Torneio Relâmpago."
"""

import uuid
from typing import Any

from lib.db import db
from lib.dates import now_utc
from lib.realtime import publish_event


async def _recipient_user_ids(aluno_id: str) -> list[str]:
    """Contas que devem ver a notificação do aluno: a conta do próprio aluno e
    a de qualquer responsável vinculado a ele."""
    query: dict[str, Any] = {
        "$or": [
            {"tipo": "aluno", "aluno_id": aluno_id},
            {"tipo": "responsavel", "filhos_ids": aluno_id},
        ]
    }
    cursor = db.users.find(query, {"_id": 0, "id": 1})
    return [item["id"] async for item in cursor]


async def notify_student(
    aluno_id: str,
    titulo: str,
    mensagem: str,
    link: str | None = None,
) -> None:
    user_ids = await _recipient_user_ids(aluno_id)
    if not user_ids:
        return
    now = now_utc()
    documents = [
        {
            "id": str(uuid.uuid4()),
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


async def notify_teacher_name(aluno_id: str, professor_name: str, acao: str, assunto: str, link: str | None = None) -> None:
    """Frase pronta no padrão: 'O Professor [Nome] [acao] [assunto].'"""
    await notify_student(
        aluno_id,
        titulo="Atualização do professor",
        mensagem=f"O Professor {professor_name} {acao} {assunto}.",
        link=link,
    )
