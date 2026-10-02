"""Invite codes and join requests that link a student to a teacher's class (turma).

Two entry points share one linking primitive, `link_student_to_class`:

  * invite code — typed at signup or later on the student's home screen: the
    student enters the class directly;
  * join request — the student picks a class from the search, and the class
    teacher approves or rejects it.

Linking deliberately avoids a multi-document transaction (the admin assignment
uses one), because the public signup path must also work on a standalone Mongo in
development. Instead it claims the *student* first with a conditional update
(turma_id still null), then the *seat* with a capacity guard, and compensates the
first write when the second fails. Both writes are single-document atomic, so two
concurrent joins can neither put a student in two classes nor overfill a class.
"""

import re
import secrets
from datetime import timedelta
from typing import Any

from fastapi import HTTPException

from lib.dates import ensure_aware, now_utc
from lib.db import db


# No 0/O or 1/I: the code is read aloud in class and copied by hand from a board.
INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
INVITE_LENGTH = 8
INVITE_MAX_VALIDITY_DAYS = 90

CLASS_SUMMARY_PROJECTION = {
    "_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1,
    "capacidade": 1, "alunos_ids": 1, "professor_id": 1,
}


def generate_invite_code() -> str:
    return "".join(secrets.choice(INVITE_ALPHABET) for _ in range(INVITE_LENGTH))


def normalize_invite_code(raw: str | None) -> str:
    """Accept what people actually type: lowercase, dashes, spaces."""
    return re.sub(r"[^0-9A-Za-z]", "", raw or "").upper()


def capacity_of(turma: dict[str, Any]) -> int:
    return int(turma.get("capacidade") or 20)


def seats_left(turma: dict[str, Any]) -> int:
    return max(0, capacity_of(turma) - len(turma.get("alunos_ids") or []))


def invite_expired(invite: dict[str, Any]) -> bool:
    expires_at = invite.get("expira_em")
    return bool(expires_at) and ensure_aware(expires_at) <= now_utc()


def invite_expiry(validade_dias: int | None):
    return now_utc() + timedelta(days=validade_dias) if validade_dias else None


def class_summary(turma: dict[str, Any]) -> dict[str, Any]:
    return {"id": turma["id"], "nome": turma["nome"], "modalidade": turma.get("modalidade", ""), "ano": turma.get("ano")}


async def resolve_invite(raw_code: str | None) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (invite, turma) for a usable code or raise a user-facing HTTPException.

    Called *before* an account is created, so a typo never leaves behind an account
    the student has to sort out with the school.
    """
    code = normalize_invite_code(raw_code)

    if len(code) != INVITE_LENGTH:
        raise HTTPException(status_code=422, detail=f"O código de convite tem {INVITE_LENGTH} caracteres.")

    invite = await db.turma_convites.find_one({"codigo": code, "ativo": True}, {"_id": 0})

    if not invite or invite_expired(invite):
        raise HTTPException(status_code=404, detail="Código de convite inválido ou expirado. Confira com seu professor.")

    turma = await db.turmas.find_one({"id": invite["turma_id"]}, CLASS_SUMMARY_PROJECTION)

    # A class handed to another teacher invalidates the old teacher's invite.
    if not turma or turma.get("professor_id") != invite["professor_id"]:
        raise HTTPException(status_code=404, detail="Este convite não está mais disponível. Peça um novo código ao professor.")

    if seats_left(turma) == 0:
        raise HTTPException(status_code=409, detail="Esta turma atingiu a capacidade. Fale com o professor.")

    return invite, turma


async def link_student_to_class(aluno_id: str, turma: dict[str, Any]) -> None:
    """Atomically place a student without a class into `turma`.

    Idempotent for the same class; raises 409 when the student already belongs to
    another class or the class is full.
    """
    claimed = await db.alunos.update_one({"id": aluno_id, "turma_id": None}, {"$set": {"turma_id": turma["id"]}})

    if claimed.matched_count == 0:
        current = await db.alunos.find_one({"id": aluno_id}, {"_id": 0, "turma_id": 1})

        if not current:
            raise HTTPException(status_code=404, detail="Cadastro de aluno não encontrado")

        if current.get("turma_id") == turma["id"]:
            return

        raise HTTPException(status_code=409, detail="Este aluno já participa de uma turma.")

    # `alunos_ids.<capacity-1>` existing means the array already has `capacity`
    # members, so this filter is the capacity check and the seat claim in one write.
    seat = await db.turmas.update_one(
        {"id": turma["id"], f"alunos_ids.{capacity_of(turma) - 1}": {"$exists": False}},
        {"$addToSet": {"alunos_ids": aluno_id}},
    )

    if seat.matched_count == 0:
        await db.alunos.update_one({"id": aluno_id, "turma_id": turma["id"]}, {"$set": {"turma_id": None}})
        raise HTTPException(status_code=409, detail="Esta turma atingiu a capacidade cadastrada.")


async def cancel_pending_requests(aluno_id: str, reason: str) -> int:
    result = await db.solicitacoes_turma.update_many(
        {"aluno_id": aluno_id, "status": "pendente"},
        {"$set": {"status": "cancelada", "motivo_rejeicao": reason, "dataDecisao": now_utc()}},
    )
    return result.modified_count


async def join_with_invite(aluno_id: str, raw_code: str | None) -> dict[str, Any]:
    """Resolve the code, link the student and record the use. Returns the class summary."""
    invite, turma = await resolve_invite(raw_code)

    await link_student_to_class(aluno_id, turma)

    await record_invite_use(invite["id"])

    await cancel_pending_requests(aluno_id, "Entrou em uma turma por código de convite")

    return {"turma": class_summary(turma), "professor_id": turma["professor_id"]}


async def record_invite_use(invite_id: str) -> None:
    await db.turma_convites.update_one({"id": invite_id}, {"$inc": {"usos": 1}, "$set": {"ultimo_uso_em": now_utc()}})


def public_invite(invite: dict[str, Any] | None) -> dict[str, Any] | None:
    if not invite:
        return None
    return {
        "id": invite["id"],
        "codigo": invite["codigo"],
        "turma_id": invite["turma_id"],
        "ativo": bool(invite.get("ativo")),
        "usos": int(invite.get("usos") or 0),
        "expira_em": invite.get("expira_em"),
        "expirado": invite_expired(invite),
        "dataCriacao": invite.get("dataCriacao"),
    }


def public_request(document: dict[str, Any], turma: dict[str, Any] | None = None, professor_nome: str | None = None) -> dict[str, Any]:
    return {
        "id": document["id"],
        "aluno_id": document["aluno_id"],
        "aluno_nome": document.get("aluno_nome", "Aluno"),
        "turma_id": document["turma_id"],
        "turma_nome": (turma or {}).get("nome", "Turma"),
        "modalidade": (turma or {}).get("modalidade"),
        "professor_nome": professor_nome,
        "status": document["status"],
        "mensagem": document.get("mensagem"),
        "motivo_rejeicao": document.get("motivo_rejeicao"),
        "dataSolicitacao": document.get("dataSolicitacao"),
        "dataDecisao": document.get("dataDecisao"),
    }
