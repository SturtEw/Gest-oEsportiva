"""Teacher invitations issued by the root admin.

The admin creates an invite for an e-mail address and gets a one-time link
(`/convite-professor?token=...`). Whoever opens it registers straight into an
active teacher account: the admin vouched for that address, so the account is
born active and verified. Only the SHA-256 of the token is stored, like the
password-reset flow, so a leaked database cannot be replayed as invites.

Rules:
- one pending invite per e-mail (a new one revokes the previous);
- single use, enforced atomically when the invite is claimed;
- expires after `validade_dias` (1-30 days);
- the e-mail cannot already belong to an account.
"""

import hashlib
import os
import secrets
import uuid
from datetime import timedelta
from typing import Any, Literal

from fastapi import HTTPException

from lib.dates import ensure_aware, now_utc
from lib.db import db

InviteStatus = Literal["pendente", "usado", "expirado", "revogado"]

INVITE_PATH = "/convite-professor"
DEFAULT_VALIDITY_DAYS = 7
MAX_VALIDITY_DAYS = 30


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.strip().encode()).hexdigest()


def invite_url(token: str) -> str:
    frontend = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    return f"{frontend}{INVITE_PATH}?token={token}"


def invite_status(invite: dict[str, Any]) -> InviteStatus:
    if invite.get("usado_em"):
        return "usado"
    if invite.get("revogado_em"):
        return "revogado"
    expires_at = invite.get("expira_em")
    if expires_at and ensure_aware(expires_at) <= now_utc():
        return "expirado"
    return "pendente"


def class_brief(turma: dict[str, Any] | None) -> dict[str, Any] | None:
    if not turma:
        return None
    return {"id": turma["id"], "nome": turma.get("nome"), "modalidade": turma.get("modalidade"), "ano": turma.get("ano")}


def public_invite(invite: dict[str, Any], turma: dict[str, Any] | None = None) -> dict[str, Any]:
    """Admin listing shape. Never includes the token (only its hash is stored)."""
    return {
        "id": invite["id"],
        "email": invite["email"],
        "nome": invite.get("nome"),
        "turma": class_brief(turma),
        "status": invite_status(invite),
        "criado_em": invite.get("criado_em"),
        "expira_em": invite.get("expira_em"),
        "usado_em": invite.get("usado_em"),
        "email_enviado": bool(invite.get("email_enviado")),
    }


async def load_class(turma_id: str | None) -> dict[str, Any] | None:
    if not turma_id:
        return None
    return await db.turmas.find_one({"id": turma_id}, {"_id": 0, "id": 1, "nome": 1, "modalidade": 1, "ano": 1, "professor_id": 1})


async def create_invite(*, email: str, nome: str | None, turma_id: str | None, validade_dias: int, created_by: str) -> tuple[dict[str, Any], str]:
    """Persist a new invite and return (document, plain token). The token is shown once."""
    email = email.strip().lower()
    if await db.users.find_one({"email": email}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=409, detail="Este e-mail já possui uma conta no portal.")

    turma = await load_class(turma_id)
    if turma_id and not turma:
        raise HTTPException(status_code=404, detail="Turma não encontrada")
    if turma and turma.get("professor_id"):
        raise HTTPException(status_code=409, detail="Esta turma já tem um professor vinculado.")

    now = now_utc()
    # One pending invite per e-mail: generating a new link invalidates the old one.
    await db.professor_convites.update_many(
        {"email": email, "usado_em": None, "revogado_em": None},
        {"$set": {"revogado_em": now, "revogado_motivo": "substituido"}},
    )

    token = generate_token()
    document = {
        "id": str(uuid.uuid4()),
        "email": email,
        "nome": nome,
        "turma_id": turma["id"] if turma else None,
        "token_hash": hash_token(token),
        "criado_por": created_by,
        "criado_em": now,
        "expira_em": now + timedelta(days=validade_dias),
        "usado_em": None,
        "usado_por": None,
        "revogado_em": None,
        "email_enviado": False,
    }
    await db.professor_convites.insert_one(document)
    return document, token


async def find_by_token(token: str) -> dict[str, Any]:
    """The invite for `token`, still usable. 404 when unknown, 410 when no longer valid."""
    token = (token or "").strip()
    invite = await db.professor_convites.find_one({"token_hash": hash_token(token)}, {"_id": 0}) if len(token) >= 20 else None
    if not invite:
        raise HTTPException(status_code=404, detail="Convite não encontrado. Confira se o link foi copiado inteiro.")
    status = invite_status(invite)
    if status == "usado":
        raise HTTPException(status_code=410, detail="Este convite já foi usado. Entre com o e-mail e a senha cadastrados.")
    if status == "revogado":
        raise HTTPException(status_code=410, detail="Este convite foi cancelado pela escola. Peça um novo link à administração.")
    if status == "expirado":
        raise HTTPException(status_code=410, detail="Este convite expirou. Peça um novo link à administração.")
    return invite


async def claim(invite_id: str, user_id: str) -> None:
    """Mark the invite used. Atomic: of two concurrent signups only one claims it."""
    now = now_utc()
    claimed = await db.professor_convites.find_one_and_update(
        {"id": invite_id, "usado_em": None, "revogado_em": None},
        {"$set": {"usado_em": now, "usado_por": user_id}},
    )
    if not claimed:
        raise HTTPException(status_code=410, detail="Este convite já foi usado ou cancelado.")
    expires_at = claimed.get("expira_em")
    if expires_at and ensure_aware(expires_at) <= now:
        await release(invite_id)
        raise HTTPException(status_code=410, detail="Este convite expirou. Peça um novo link à administração.")


async def release(invite_id: str) -> None:
    """Undo `claim` when the account could not be created, so the link still works."""
    await db.professor_convites.update_one({"id": invite_id}, {"$set": {"usado_em": None, "usado_por": None}})


async def revoke(invite_id: str) -> dict[str, Any]:
    invite = await db.professor_convites.find_one({"id": invite_id}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Convite não encontrado")
    if invite_status(invite) != "pendente":
        raise HTTPException(status_code=409, detail="Só é possível cancelar convites pendentes.")
    now = now_utc()
    await db.professor_convites.update_one({"id": invite_id}, {"$set": {"revogado_em": now, "revogado_motivo": "admin"}})
    invite["revogado_em"] = now
    return invite


async def assign_class(turma_id: str | None, teacher_id: str) -> tuple[dict[str, Any] | None, str | None]:
    """Give the invited class to the new teacher, unless someone took it meanwhile.

    Returns (class, warning). The account exists either way.
    """
    if not turma_id:
        return None, None
    turma = await load_class(turma_id)
    if not turma:
        return None, "A turma do convite não existe mais. A administração pode vincular outra turma."
    result = await db.turmas.update_one({"id": turma_id, "professor_id": None}, {"$set": {"professor_id": teacher_id}})
    if not result.matched_count:
        return None, f"A turma {turma.get('nome')} já tem outro professor. A administração pode vincular outra turma."
    return turma, None
