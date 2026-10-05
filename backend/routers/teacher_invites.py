"""Teacher onboarding by invitation link.

Admin side (`/api/admin/teacher-invites`): the root admin creates, lists and
cancels invites. Public side (`/api/auth/teacher-invite*`): the invited person
previews the invite and registers, landing signed in as an active teacher.
Public signup (`/api/auth/register`) stays student-only.
"""

import logging
import os
import re
import uuid
from html import escape
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from pymongo.errors import DuplicateKeyError

from lib.dates import now_utc
from lib.db import db
from lib.emailx import send_email
from lib.realtime import publish_admin_event, publish_user_event
from lib.security import create_token, get_current_user, hash_password, set_session_cookie
from models.models import User
from routers.admin import _audit, _require_root
from routers.auth import _document_digest, _google_claims, _public_user
from services import teacher_invites as invites

logger = logging.getLogger(__name__)

admin_router = APIRouter(prefix="/api/admin/teacher-invites", tags=["root administration"])
public_router = APIRouter(prefix="/api/auth", tags=["authentication"])


# ─── Admin ────────────────────────────────────────────────────────────────────
class TeacherInviteCreate(BaseModel):
    email: EmailStr
    nome: str | None = Field(default=None, max_length=120)
    turma_id: str | None = Field(default=None, max_length=64)
    validade_dias: int = Field(default=invites.DEFAULT_VALIDITY_DAYS, ge=1, le=invites.MAX_VALIDITY_DAYS)
    enviar_email: bool = True

    @field_validator("nome")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        value = " ".join((value or "").split())
        return value or None


def _invite_email_html(nome: str | None, url: str, validade_dias: int, turma_nome: str | None) -> str:
    greeting = f"Olá, {escape(nome)}" if nome else "Olá"
    turma = f" para a turma <strong>{escape(turma_nome)}</strong>" if turma_nome else ""
    from_name = escape(os.environ.get("EMAIL_FROM_NAME", "Gestão Esportiva Escolar"))
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        '<tr><td style="padding:24px;font-family:Arial,sans-serif;background:#F4F6F1">'
        '<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fff;'
        'border:1px solid #DFE5DC;border-radius:12px">'
        '<tr><td style="background:#153B34;border-radius:12px 12px 0 0;padding:20px 24px">'
        '<span style="color:#D9EFAB;font-size:13px;font-weight:bold;letter-spacing:2px">GESTÃO ESPORTIVA ESCOLAR</span></td></tr>'
        '<tr><td style="padding:24px">'
        '<p style="margin:0 0 4px;color:#66806D;font-size:13px">Convite para professor</p>'
        f'<h1 style="margin:0 0 12px;color:#18372F;font-size:20px">{greeting}</h1>'
        f'<p style="margin:0 0 16px;color:#172B27;font-size:15px;line-height:1.6">A escola convidou você para entrar no portal como professor{turma}. '
        f'Crie seu acesso pelo botão abaixo. O link vale por {validade_dias} dia(s) e só pode ser usado uma vez.</p>'
        f'<p style="margin:0 0 16px"><a href="{escape(url)}" style="display:inline-block;background:#234E40;color:#fff;'
        'padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Criar meu acesso de professor</a></p>'
        '<p style="margin:0;color:#718078;font-size:13px">Se você não esperava este convite, ignore este e-mail.</p>'
        '</td></tr>'
        '<tr><td style="padding:16px 24px;border-top:1px solid #DFE5DC">'
        f'<p style="margin:0;font-size:12px;color:#94A3B8">Enviado por {from_name}. Nunca pedimos senhas por e-mail ou WhatsApp.</p>'
        '</td></tr></table></td></tr></table>'
    )


async def _send_invite_email(invite: dict, token: str, turma: dict | None, validade_dias: int) -> bool:
    try:
        await send_email(
            to=invite["email"],
            subject="Seu convite de professor — Gestão Esportiva Escolar",
            html=_invite_email_html(invite.get("nome"), invites.invite_url(token), validade_dias, turma.get("nome") if turma else None),
        )
    except Exception as exc:  # noqa: BLE001 — e-mail is optional; the admin still has the link
        # The token is deliberately NOT queued for retry: the queue would store it in
        # plain text. The admin copies the link instead.
        logger.warning('{"event": "teacher_invite_email_failed", "invite_id": "%s", "error": "%s"}', invite["id"], str(exc)[:200])
        return False
    await db.professor_convites.update_one({"id": invite["id"]}, {"$set": {"email_enviado": True}})
    return True


@admin_router.get("")
async def list_teacher_invites(user: User = Depends(get_current_user)):
    _require_root(user)
    documents = await db.professor_convites.find({}, {"_id": 0, "token_hash": 0}).sort("criado_em", -1).limit(100).to_list(length=100)
    class_ids = {doc["turma_id"] for doc in documents if doc.get("turma_id")}
    classes = {}
    for turma_id in class_ids:
        turma = await invites.load_class(turma_id)
        if turma:
            classes[turma_id] = turma
    return {"invites": [invites.public_invite(doc, classes.get(doc.get("turma_id"))) for doc in documents]}


@admin_router.post("", status_code=201)
async def create_teacher_invite(payload: TeacherInviteCreate, user: User = Depends(get_current_user)):
    _require_root(user)
    invite, token = await invites.create_invite(
        email=str(payload.email), nome=payload.nome, turma_id=payload.turma_id,
        validade_dias=payload.validade_dias, created_by=user.id,
    )
    turma = await invites.load_class(invite.get("turma_id"))
    email_sent = await _send_invite_email(invite, token, turma, payload.validade_dias) if payload.enviar_email else False
    invite["email_enviado"] = email_sent
    await _audit(user, "teacher_invite_created", invite["id"], {"email": invite["email"], "turma_id": invite.get("turma_id"), "email_enviado": email_sent})
    await publish_admin_event("teacher_invites")
    # The token is returned this one time; afterwards only its hash exists.
    return {"invite": invites.public_invite(invite, turma), "token": token, "path": f"{invites.INVITE_PATH}?token={token}", "url": invites.invite_url(token), "email_enviado": email_sent}


@admin_router.delete("/{invite_id}")
async def revoke_teacher_invite(invite_id: str, user: User = Depends(get_current_user)):
    _require_root(user)
    invite = await invites.revoke(invite_id)
    await _audit(user, "teacher_invite_revoked", invite_id, {"email": invite["email"]})
    await publish_admin_event("teacher_invites")
    return {"id": invite_id, "status": "revogado"}


# ─── Public: preview + registration ───────────────────────────────────────────
class TeacherInviteRegisterInput(BaseModel):
    token: str = Field(min_length=20, max_length=256)
    provider: Literal["email", "google"] = "email"
    credential: str | None = Field(default=None, max_length=10000)
    nome: str = Field(min_length=3, max_length=120)
    senha: str | None = Field(default=None, min_length=10, max_length=72)
    documento_tipo: Literal["cpf", "rg", "outro"]
    documento_numero: str = Field(min_length=5, max_length=40)
    formacao_academica: str = Field(min_length=2, max_length=160)
    area_atuacao: str = Field(min_length=2, max_length=160)

    @field_validator("nome", "formacao_academica", "area_atuacao")
    @classmethod
    def collapse_spaces(cls, value: str) -> str:
        return " ".join(value.strip().split())

    @field_validator("documento_numero")
    @classmethod
    def normalize_document(cls, value: str) -> str:
        normalized = re.sub(r"[^0-9A-Za-z]", "", value).upper()
        if len(normalized) < 5:
            raise ValueError("Informe um documento válido")
        return normalized

    @model_validator(mode="after")
    def validate_provider(self):
        if self.provider == "email" and not self.senha:
            raise ValueError("Informe uma senha para continuar")
        if self.provider == "google" and not self.credential:
            raise ValueError("Não foi possível validar sua conta Google")
        return self


@public_router.get("/teacher-invite")
async def preview_teacher_invite(token: str = Query(min_length=20, max_length=256)):
    invite = await invites.find_by_token(token)
    turma = await invites.load_class(invite.get("turma_id"))
    return {"email": invite["email"], "nome": invite.get("nome"), "turma": invites.class_brief(turma), "expira_em": invite.get("expira_em")}


@public_router.post("/register-teacher", status_code=201)
async def register_teacher(payload: TeacherInviteRegisterInput, response: Response):
    invite = await invites.find_by_token(payload.token)
    email = invite["email"]

    google_claims = await _google_claims(payload.credential or "") if payload.provider == "google" else None
    if google_claims and str(google_claims.get("email", "")).lower() != email:
        raise HTTPException(status_code=400, detail=f"Use a conta Google de {email}, o e-mail que recebeu o convite.")

    if await db.users.find_one({"email": email}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=409, detail="Este e-mail já possui uma conta. Entre pela tela de login.")
    digest = _document_digest(payload.documento_numero)
    if await db.users.find_one({"documento_hash": digest}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=409, detail="Este documento já está vinculado a outra conta.")

    user_id = str(uuid.uuid4())
    # Claim first: of two simultaneous submissions only one gets past this line.
    await invites.claim(invite["id"], user_id)

    now = now_utc()
    user_document = {
        "id": user_id,
        "nome": payload.nome,
        "email": email,
        "senha_hash": hash_password(payload.senha) if payload.senha else "",
        "google_sub": google_claims.get("sub") if google_claims else None,
        "tipo": "professor",
        "aluno_id": None,
        "data_nascimento": None,
        "documento_tipo": payload.documento_tipo,
        "documento_hash": digest,
        "documento_final": payload.documento_numero[-4:],
        "formacao_academica": payload.formacao_academica,
        "area_atuacao": payload.area_atuacao,
        "motivo_reprovacao": None,
        # The admin invited this exact address and the link reached its owner, so
        # the account starts active and verified (no approval queue, no e-mail check).
        "status": "ativo",
        "telefone": None,
        "filhos_ids": [],
        "is_root_admin": False,
        "email_verified": True,
        "verification_token_hash": None,
        "verification_expires_at": None,
        "convite_professor_id": invite["id"],
        "dataCriacao": now,
    }
    try:
        await db.users.insert_one(user_document)
    except Exception as exc:
        await invites.release(invite["id"])
        if isinstance(exc, DuplicateKeyError):
            raise HTTPException(status_code=409, detail="Este e-mail ou documento já está cadastrado.") from exc
        raise

    turma, warning = await invites.assign_class(invite.get("turma_id"), user_id)

    await db.admin_notifications.insert_one({
        "id": str(uuid.uuid4()), "tipo": "professor_convite_aceito", "user_id": user_id,
        "nome": payload.nome, "email": email, "status": "unread", "dataCriacao": now,
    })
    await publish_admin_event("teacher_invites")
    if turma:
        await publish_admin_event("classes")
        await publish_user_event(user_id, "classes")

    user = User.model_validate(user_document)
    set_session_cookie(response, create_token(user))
    return {"user": _public_user(user), "turma": invites.class_brief(turma), "aviso": warning}
