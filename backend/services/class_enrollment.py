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
    """Coloca o aluno em `turma` (MULTI-TURMAS: o aluno pode ter várias).

    Mantém `turmas_ids` (a lista completa) e `turma_id` (a principal = primeira)
    em sincronia, conforme o contrato do modelo Aluno. As duas escritas são
    atômicas por documento:
      1. reivindica o assento na turma (guarda de capacidade no próprio filtro);
      2. adiciona a turma à lista do aluno.
    Se a etapa 2 falhar, o assento é devolvido (compensação).

    Idempotente na mesma turma; 409 se a turma estiver cheia.
    """
    student = await db.alunos.find_one({"id": aluno_id}, {"_id": 0, "id": 1, "turma_id": 1, "turmas_ids": 1})
    if not student:
        raise HTTPException(status_code=404, detail="Cadastro de aluno não encontrado")

    # Já pertence a esta turma: nada a fazer (nem reivindica assento de novo).
    if student.get("turma_id") == turma["id"] or turma["id"] in (student.get("turmas_ids") or []):
        return

    # 1. Assento: `alunos_ids.<capacity-1>` existente significa que a turma já
    #    tem `capacity` membros — checagem de capacidade e reserva em uma escrita.
    seat = await db.turmas.update_one(
        {"id": turma["id"], f"alunos_ids.{capacity_of(turma) - 1}": {"$exists": False}},
        {"$addToSet": {"alunos_ids": aluno_id}},
    )
    if seat.matched_count == 0:
        raise HTTPException(status_code=409, detail="Esta turma atingiu a capacidade cadastrada.")

    # 2. Vínculo no aluno. `turma_id` legado = primeira turma quando ainda não há.
    try:
        await db.alunos.update_one(
            {"id": aluno_id},
            {
                "$addToSet": {"turmas_ids": turma["id"]},
                "$set": {"turma_id": student.get("turma_id") or turma["id"]},
            },
        )
    except Exception:
        # Compensação: devolve o assento reservado e propaga o erro.
        await db.turmas.update_one({"id": turma["id"]}, {"$pull": {"alunos_ids": aluno_id}})
        raise


async def unlink_student_from_class(aluno_id: str, turma_id: str) -> dict[str, Any]:
    """Remove o aluno de UMA turma, preservando as demais.

    Devolve `{"turmas_restantes": [...], "turma_id": <nova principal ou None>}`.
    """
    student = await db.alunos.find_one({"id": aluno_id}, {"_id": 0, "id": 1, "turma_id": 1, "turmas_ids": 1})
    if not student:
        raise HTTPException(status_code=404, detail="Cadastro de aluno não encontrado")

    ids = list(student.get("turmas_ids") or [])
    legacy = student.get("turma_id")
    if legacy and legacy not in ids:
        ids.insert(0, legacy)
    if turma_id not in ids:
        raise HTTPException(status_code=409, detail="Você não participa desta turma.")

    remaining = [item for item in ids if item != turma_id]
    await db.turmas.update_one({"id": turma_id}, {"$pull": {"alunos_ids": aluno_id}})
    await db.alunos.update_one(
        {"id": aluno_id},
        {"$set": {"turma_id": remaining[0] if remaining else None, "turmas_ids": remaining}},
    )
    return {"turmas_restantes": remaining, "turma_id": remaining[0] if remaining else None}


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

    # Multi-turmas: cancelar apenas a solicitação PENDENTE para ESTA turma
    # (acabou de ser atendida por convite). Solicitações a outras turmas
    # permanecem pendentes.
    await db.solicitacoes_turma.update_many(
        {"aluno_id": aluno_id, "turma_id": turma["id"], "status": "pendente"},
        {"$set": {"status": "cancelada", "motivo_rejeicao": "Entrou nesta turma por código de convite", "dataDecisao": now_utc()}},
    )

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
