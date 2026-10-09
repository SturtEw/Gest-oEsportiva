"""Self-service account management for teachers and students.

One module owns the whole lifecycle of a user's own account:
  - profile data (nome, telefone) + avatar (preset gallery or uploaded photo)
  - password (change requires the current one; reset uses the existing flow)
  - deactivate (temporary, reversible by simply logging in again)
  - delete (permanent, frees the e-mail for a future registration)

Deactivation policy: the user is marked "inativo" and unlinked from every
active class (alunos.turma_id = None; turmas.alunos_ids purged). Re-activation
happens automatically at login: presenting valid credentials proves identity,
so the account flips back to "ativo" and the user keeps their data. Nothing is
erased on deactivation.

Deletion policy: hard removal. The user document and the linked student
record (if any) are deleted, class memberships are pulled, and the e-mail
becomes free for a brand-new registration. Existing OAuth links (google_sub)
die with the document.

Endpoints (all require an authenticated user acting on their own account):
  GET   /api/conta                    profile + avatar + status
  PATCH /api/conta                    update nome / telefone
  POST  /api/conta/avatar             set preset avatar { avatar_id }
  POST  /api/conta/avatar/upload      set uploaded avatar { image_base64 }
  DELETE /api/conta/avatar            remove avatar (falls back to initials)
  POST  /api/conta/desativar          { senha } -> status "inativo", unlink classes
  POST  /api/conta/excluir            { senha } -> permanent delete
"""

import base64
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from lib.db import db
from lib.realtime import publish_admin_event, publish_class_event, publish_user_event
from lib.security import get_current_user, revoke_user_tokens
from models.models import User

router = APIRouter(prefix="/api/conta", tags=["account management"])

MAX_AVATAR_BYTES = 512 * 1024  # 512 KB base64 payload cap
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
DATA_URL = re.compile(r"^data:(image/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$")


# ─── Payloads ─────────────────────────────────────────────────────────────────
class ProfileUpdate(BaseModel):
    nome: str = Field(min_length=3, max_length=120)
    telefone: str | None = Field(default=None, max_length=20)

    @field_validator("nome")
    @classmethod
    def clean_nome(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) < 3:
            raise ValueError("O nome precisa ter pelo menos 3 caracteres")
        return cleaned

    @field_validator("telefone")
    @classmethod
    def clean_telefone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class AvatarPresetInput(BaseModel):
    avatar_id: str = Field(min_length=1, max_length=64)


class AvatarUploadInput(BaseModel):
    image_base64: str = Field(min_length=50)

    @field_validator("image_base64")
    @classmethod
    def valid_image(cls, value: str) -> str:
        match = DATA_URL.match(value.strip())
        if not match:
            raise ValueError("Envie uma imagem PNG, JPEG ou WEBP em base64 (data URL)")
        mime, payload = match.group(1), match.group(3)
        try:
            size = len(base64.b64decode(payload, validate=True))
        except Exception as exc:
            raise ValueError("Imagem base64 inválida") from exc
        if size > MAX_AVATAR_BYTES:
            raise ValueError("A imagem deve ter no máximo 512 KB")
        if size < 100:
            raise ValueError("Imagem vazia ou corrompida")
        return f"data:{mime};base64,{payload}"


class PasswordConfirmInput(BaseModel):
    senha: str = Field(min_length=1, max_length=72)


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _avatar_public(user: User) -> dict | None:
    """Avatar for the client: only the id for presets; the data URL for uploads."""
    if not user.avatar:
        return None
    if user.avatar.get("tipo") == "upload":
        return {"tipo": "upload", "image_base64": user.avatar.get("image_base64")}
    return {"tipo": "preset", "avatar_id": user.avatar.get("avatar_id")}


async def _account_payload(user: User) -> dict:
    fresh = await db.users.find_one({"id": user.id}, {"_id": 0, "nome": 1, "email": 1, "tipo": 1, "status": 1, "telefone": 1, "avatar": 1})
    if not fresh:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    return {
        "id": user.id,
        "nome": fresh.get("nome", user.nome),
        "email": fresh.get("email", user.email),
        "tipo": fresh.get("tipo", user.tipo),
        "status": fresh.get("status", user.status),
        "telefone": fresh.get("telefone"),
        "avatar": _avatar_public(User.model_validate({"id": user.id, "nome": fresh.get("nome", ""), "email": fresh.get("email", ""), "tipo": fresh.get("tipo", "aluno"), "avatar": fresh.get("avatar")})),
        "tem_senha": True,
    }


async def _require_password(user: User, senha: str) -> None:
    """Destructive actions re-verify the password against the stored hash."""
    from lib.security import verify_password

    if not user.senha_hash or not verify_password(senha, user.senha_hash):
        raise HTTPException(status_code=401, detail="Senha incorreta. Ação não confirmada.")


# ─── Profile & avatar ─────────────────────────────────────────────────────────
@router.get("")
async def get_account(user: User = Depends(get_current_user)):
    return {"conta": await _account_payload(user)}


@router.patch("")
async def update_account(payload: ProfileUpdate, user: User = Depends(get_current_user)):
    changes = {"nome": payload.nome}
    if payload.telefone is not None:
        changes["telefone"] = payload.telefone
    await db.users.update_one({"id": user.id}, {"$set": changes})
    return {"conta": await _account_payload(user), "message": "Dados atualizados."}


@router.post("/avatar")
async def set_preset_avatar(payload: AvatarPresetInput, user: User = Depends(get_current_user)):
    await db.users.update_one(
        {"id": user.id},
        {"$set": {"avatar": {"tipo": "preset", "avatar_id": payload.avatar_id}}},
    )
    return {"conta": await _account_payload(user), "message": "Avatar atualizado."}


@router.post("/avatar/upload")
async def upload_avatar(payload: AvatarUploadInput, user: User = Depends(get_current_user)):
    await db.users.update_one(
        {"id": user.id},
        {"$set": {"avatar": {"tipo": "upload", "image_base64": payload.image_base64}}},
    )
    return {"conta": await _account_payload(user), "message": "Foto de perfil atualizada."}


@router.delete("/avatar")
async def remove_avatar(user: User = Depends(get_current_user)):
    await db.users.update_one({"id": user.id}, {"$unset": {"avatar": ""}})
    return {"conta": await _account_payload(user), "message": "Avatar removido."}


# ─── Danger zone ──────────────────────────────────────────────────────────────
async def _unlink_from_classes(user_id: str) -> int:
    """Remove every active class membership. Returns how many classes were touched."""
    student = await db.alunos.find_one({"id": user_id}, {"_id": 0, "id": 1, "turma_id": 1})
    touched = 0
    if student and student.get("turma_id"):
        await db.alunos.update_one({"id": student["id"]}, {"$set": {"turma_id": None}})
        await db.turmas.update_one({"id": student["turma_id"]}, {"$pull": {"alunos_ids": student["id"]}})
        touched += 1
        await publish_class_event(student["turma_id"], "roster")
    return touched


@router.post("/desativar")
async def deactivate_account(payload: PasswordConfirmInput, user: User = Depends(get_current_user)):
    """Temporary deactivation. Reversible: the next successful login reactivates."""
    if user.is_root_admin:
        raise HTTPException(status_code=403, detail="A conta raiz não pode ser desativada")
    await _require_password(user, payload.senha)

    unlinked = await _unlink_from_classes(user.id)
    await db.users.update_one({"id": user.id}, {"$set": {"status": "inativo"}})
    await revoke_user_tokens(user.id)  # kill current sessions immediately

    await publish_user_event(user.id, "account")
    await publish_admin_event("users")

    return {
        "status": "inativo",
        "turmas_desvinculadas": unlinked,
        "message": "Conta desativada. Você pode reativá-la fazendo login novamente.",
    }


@router.post("/excluir")
async def delete_account(payload: PasswordConfirmInput, user: User = Depends(get_current_user)):
    """Permanent removal: user document, student record, memberships, tokens."""
    if user.is_root_admin:
        raise HTTPException(status_code=403, detail="A conta raiz não pode ser excluída")
    await _require_password(user, payload.senha)

    # Refresh from DB so we act on the real state, not on the token's snapshot.
    doc = await db.users.find_one({"id": user.id}, {"_id": 0, "id": 1, "tipo": 1, "email": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Conta não encontrada")

    await _unlink_from_classes(user.id)

    # Students own a record in `alunos`; teachers don't. Both die here if present.
    await db.alunos.delete_many({"id": user.id})
    await db.users.delete_one({"id": user.id})
    await revoke_user_tokens(user.id)

    await publish_admin_event("users")

    return {
        "status": "excluida",
        "email_liberado": doc.get("email"),
        "message": "Conta excluída permanentemente. O e-mail ficou livre para um novo cadastro.",
    }
