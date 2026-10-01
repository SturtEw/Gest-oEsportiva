"""Role-specific password and Google OIDC access; no public teacher self-approval."""


import hashlib
import hmac
import logging
import os
import re
import secrets
import time
import uuid
from datetime import date, datetime, timedelta
from html import escape
from typing import Literal


from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from starlette.concurrency import run_in_threadpool


from lib.dates import ensure_aware, now_utc, today_in_app_tz
from lib.db import db
from lib.emailx import send_email
from lib.rate_limit import (

    check_account_lockout,
    check_rate_limit,

    increment_failed_attempts,

    record_auth_attempt,

    reset_failed_attempts,


)


from lib.realtime import publish_admin_event, publish_event, publish_user_event
from lib.security import (

    clear_session_cookie,
    create_token,

    get_current_user,

    hash_password,

    require_role,

    revoke_user_tokens,

    set_session_cookie,

    verify_password,


)


from models.models import LoginInput, User


class ConfirmEmailInput(BaseModel):
    token: str = Field(min_length=16, max_length=256)


class ResendConfirmationInput(BaseModel):
    email: EmailStr


router = APIRouter(prefix="/api/auth", tags=["authentication"])
children_router = APIRouter(prefix="/api/student", tags=["student portal"])



class RegisterAccountInput(BaseModel):
    provider: Literal["email", "google"] = "email"

    credential: str | None = Field(default=None, max_length=10000)

    nome: str = Field(min_length=3, max_length=120)

    email: EmailStr

    senha: str | None = Field(default=None, min_length=10, max_length=72)

    tipo: Literal["aluno", "professor"]

    data_nascimento: str | None = None

    documento_tipo: Literal["cpf", "rg", "outro"]

    documento_numero: str = Field(min_length=5, max_length=40)

    formacao_academica: str | None = Field(default=None, min_length=2, max_length=160)

    area_atuacao: str | None = Field(default=None, min_length=2, max_length=160)


    @field_validator("nome")

    @classmethod

    def normalize_name(cls, value: str) -> str:
        return " ".join(value.strip().split())


    @field_validator("documento_numero")

    @classmethod

    def normalize_document(cls, value: str) -> str:
        normalized = re.sub(r"[^0-9A-Za-z]", "", value).upper()

        if len(normalized) < 5:
            raise ValueError("Informe um documento válido")

        return normalized


    @field_validator("data_nascimento")

    @classmethod

    def validate_birth_date(cls, value: str | None) -> str | None:
        if value is None:
            return value

        try:
            parsed = date.fromisoformat(value)

        except ValueError as exc:
            raise ValueError("Use uma data de nascimento válida (AAAA-MM-DD)") from exc

        if parsed > today_in_app_tz():
            raise ValueError("A data de nascimento não pode estar no futuro")

        return value


    @model_validator(mode="after")

    def validate_role_fields(self):
        if self.provider == "email" and not self.senha:
            raise ValueError("Informe uma senha para continuar")

        if self.provider == "google" and not self.credential:
            raise ValueError("Não foi possível validar sua conta Google")

        if self.tipo == "aluno" and not self.data_nascimento:
            raise ValueError("Informe sua data de nascimento")

        if self.tipo == "professor" and (not self.formacao_academica or not self.area_atuacao):
            raise ValueError("Informe sua formação acadêmica e área de atuação")

        return self



class GoogleLoginInput(BaseModel):
    credential: str = Field(min_length=20, max_length=10000)

    tipo: Literal["aluno", "professor"]



class ProvisionStudentLoginInput(BaseModel):
    email: EmailStr

    senha: str = Field(min_length=10, max_length=72)



class DocumentLinkInput(BaseModel):
    aluno_id: str

    responsavel_id: str



class ForgotPasswordInput(BaseModel):
    email: EmailStr



class ResetPasswordInput(BaseModel):
    token: str

    new_password: str = Field(min_length=12, max_length=72)



class ChangePasswordInput(BaseModel):
    current_password: str

    new_password: str = Field(min_length=12, max_length=72)



class GoogleLinkInput(BaseModel):
    credential: str = Field(min_length=20, max_length=10000)



def _document_digest(value: str) -> str:
    secret = os.getenv("DOCUMENT_HMAC_SECRET")

    if not secret:
        if os.getenv("APP_ENV", "development").lower() == "production":
            raise HTTPException(status_code=503, detail="DOCUMENT_HMAC_SECRET deve ser configurado antes de aceitar documentos")

        secret = os.getenv("JWT_SECRET", "dev-insecure-secret")

    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()



def _public_user(user: User) -> dict:
    return {

        "id": user.id,

        "nome": user.nome,

        "email": user.email,

        "tipo": user.tipo,

        "status": user.status,

        "aluno_id": user.aluno_id,

        "filhos_ids": user.filhos_ids if user.tipo == "responsavel" else [],

        "is_root_admin": user.is_root_admin,

        "tem_senha": bool(user.senha_hash),

        "google_sub": user.google_sub,

        "google_email": user.email if user.google_sub else None,

    }



def _google_client_id() -> str:
    value = os.getenv("GOOGLE_CLIENT_ID")

    if not value:
        raise HTTPException(status_code=503, detail="O acesso Google ainda não está configurado")

    return value



def _verify_google_token_sync(credential: str) -> dict:
    from google.auth.transport.requests import Request as GoogleRequest
    from google.oauth2 import id_token

    claims = id_token.verify_oauth2_token(credential, GoogleRequest(), audience=_google_client_id())
    if not claims.get("email_verified") or not claims.get("sub") or not claims.get("email"):
        raise ValueError("A conta Google não possui um e-mail verificado")

    return claims



async def _google_claims(credential: str) -> dict:
    try:
        return await run_in_threadpool(_verify_google_token_sync, credential)

    except HTTPException:
        raise

    except ValueError as exc:
        # A Google ID token carries its own "aud" (the client id it was issued for).
        # A mismatch means the browser is using a different OAuth client than the one
        # configured here, which Google reports as invalid_client. Naming that cause
        # explicitly beats a bare 401, because it is otherwise very hard to diagnose.
        raise HTTPException(status_code=401, detail=_google_token_error_detail(exc)) from exc

    except Exception as exc:
        raise HTTPException(status_code=401, detail="Não foi possível validar sua conta Google") from exc



def _google_token_error_detail(exc: Exception) -> str:
    """Turn a google-auth verification failure into an actionable message."""
    message = str(exc).lower()
    configured = os.getenv("GOOGLE_CLIENT_ID", "").strip() or "(vazio)"
    audience = _token_audience(exc)
    client_mismatch = "invalid_client" in message or "aud" in message

    if client_mismatch:
        if audience and audience != configured:
            return (
                f"O navegador enviou um token do cliente {audience}, mas o backend espera {configured}. "
                "Use o mesmo projeto do Google nos dois lados: o botao do portal e a variavel GOOGLE_CLIENT_ID."
            )
        return (
            "Token Google emitido para um cliente diferente do configurado no servidor. "
            f"Confirme GOOGLE_CLIENT_ID={configured} e reinicie o backend; apague o cache do navegador "
            "e use uma janela anonima para descartar o token antigo."
        )

    if "expired" in message:
        return "A sessao do Google expirou. Tente entrar novamente."

    if "signature" in message or "crypt" in message:
        return "A assinatura do token Google nao pode ser verificada."

    return "Não foi possível validar sua conta Google"



def _token_audience(exc: Exception) -> str | None:
    """Best-effort extraction of the token's 'aud' from a google-auth error."""
    for attribute in ("_token", "token"):
        token = getattr(exc, attribute, None)
        if isinstance(token, str) and token.count(".") == 2:
            import base64
            import json

            try:
                payload = token.split(".")[1]
                payload += "=" * (-len(payload) % 4)
                claims = json.loads(base64.urlsafe_b64decode(payload))
                audience = claims.get("aud")
                if isinstance(audience, str):
                    return audience
            except Exception:
                return None
    return None



async def _create_registration(payload: RegisterAccountInput, response: Response | None = None) -> dict:
    google_claims = await _google_claims(payload.credential or "") if payload.provider == "google" else None

    email = str(payload.email).lower()

    if google_claims and str(google_claims.get("email", "")).lower() != email:
        raise HTTPException(status_code=400, detail="O e-mail informado não corresponde à conta Google verificada")

    verified_name = " ".join(str(google_claims.get("name", "")).split()) if google_claims else ""

    account_name = verified_name if len(verified_name) >= 3 else payload.nome

    existing = await db.users.find_one({"email": email}, {"_id": 0, "id": 1})

    if existing:
        raise HTTPException(status_code=409, detail="Este e-mail já possui uma conta. Entre ou solicite ajuda à escola.")

    digest = _document_digest(payload.documento_numero)

    if await db.users.find_one({"documento_hash": digest}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Este documento já está vinculado a uma conta")

    if payload.tipo == "aluno" and payload.data_nascimento:
        birth = date.fromisoformat(payload.data_nascimento)

        if birth >= today_in_app_tz():
            raise HTTPException(status_code=400, detail="Informe uma data de nascimento válida")

    user_id = str(uuid.uuid4())

    student_id = str(uuid.uuid4()) if payload.tipo == "aluno" else None

    account_status = "pendente" if payload.tipo == "professor" else "ativo"

    now = now_utc()

    user_document = {

        "id": user_id,

        "nome": account_name,

        "email": email,

        "senha_hash": hash_password(payload.senha) if payload.senha else "",

        "google_sub": google_claims.get("sub") if google_claims else None,

        "tipo": payload.tipo,

        "aluno_id": student_id,

        "data_nascimento": payload.data_nascimento if payload.tipo == "aluno" else None,

        "documento_tipo": payload.documento_tipo,

        "documento_hash": digest,

        "documento_final": payload.documento_numero[-4:],

        "formacao_academica": payload.formacao_academica if payload.tipo == "professor" else None,

        "area_atuacao": payload.area_atuacao if payload.tipo == "professor" else None,

        "motivo_reprovacao": None,

        "status": account_status,

        "telefone": None,

        "filhos_ids": [],

        "is_root_admin": False,

        # Password registration never proves e-mail ownership, so the account starts
        # unverified. Google registration is the exception: the ID token carries
        # email_verified=true and Google validated the address itself.
        "email_verified": bool(google_claims),

        "verification_token_hash": None,

        "verification_expires_at": None,

        "dataCriacao": now,

    }

    student_document = None

    if payload.tipo == "aluno":
        student_document = {

            "id": student_id,

            "nome": account_name,

            "turma_id": None,

            "data_nascimento": payload.data_nascimento,

            "responsavel_id": None,

            "responsavel_email": None,

            "responsavel_telefone": None,

            "participa_ranking": False,

            "consentimentoRankingAtualizadoEm": None,

            "dataCriacao": now,

        }

    try:
        if student_document:
            await db.alunos.insert_one(student_document)

        await db.users.insert_one(user_document)

    except Exception as exc:
        if student_document:
            await db.alunos.delete_one({"id": student_id})

        if exc.__class__.__name__ == "DuplicateKeyError":
            raise HTTPException(status_code=409, detail="Este e-mail ou documento já está cadastrado") from exc

        raise

    # Confirmation e-mail for password registrations. Failure must not abort the
    # account — the user can request a new link later — but it is logged so the gap is
    # visible instead of silently leaving an account that can never be verified.
    if not google_claims:
        try:
            await _send_confirmation_email(user_document)
        except Exception as exc:
            logging.getLogger(__name__).error('{"event": "confirmation_email_failed", "email": "%s", "error": "%s"}', email, exc)

    if payload.tipo == "professor":
        await db.admin_notifications.insert_one({

            "id": str(uuid.uuid4()),

            "tipo": "professor_signup",

            "user_id": user_id,

            "nome": payload.nome,

            "email": email,

            "status": "unread",

            "dataCriacao": now,

        })

        await publish_admin_event("teacher_applications")

        return {"status": "pendente", "requires_approval": True, "user": {"id": user_id, "nome": account_name, "email": email, "tipo": "professor", "status": "pendente", "aluno_id": None, "filhos_ids": [], "is_root_admin": False}}

    if response:
        from lib.security import create_token, set_session_cookie
        created_user = User.model_validate(user_document)

        set_session_cookie(response, create_token(created_user))

        await publish_event(student_id or "", "portal")

    return {"status": "ativo", "requires_approval": False, "user": {"id": user_id, "nome": account_name, "email": email, "tipo": "aluno", "status": "ativo", "aluno_id": student_id, "filhos_ids": [], "is_root_admin": False}}



@router.get("/google-config")

async def google_config():
    return {"client_id": os.getenv("GOOGLE_CLIENT_ID") or None}



@router.post("/register")

async def register(payload: RegisterAccountInput, response: Response):
    return await _create_registration(payload, response=response if payload.tipo == "aluno" else None)



@router.post("/google-login")

async def google_login(payload: GoogleLoginInput, response: Response):
    rate = await check_rate_limit(f"google:{payload.tipo}")

    if rate["blocked"]:
        raise HTTPException(status_code=429, detail="Muitas tentativas. Aguarde 15 minutos.")

    claims = await _google_claims(payload.credential)

    email = str(claims["email"]).lower()

    lockout = await check_account_lockout(email)

    if lockout.get("locked"):
        raise HTTPException(status_code=423, detail=f"Conta bloqueada. Tente novamente em {lockout['minutes']} minutos.")

    user_doc = await db.users.find_one({"$or": [{"google_sub": claims["sub"]}, {"email": email}]}, {"_id": 0})

    if not user_doc:
        await record_auth_attempt(email, False)

        raise HTTPException(status_code=404, detail="Conta Google não vinculada. Crie sua conta primeiro.")

    root_login = payload.tipo == "professor" and user_doc.get("tipo") == "admin" and user_doc.get("is_root_admin") is True

    if user_doc.get("tipo") != payload.tipo and not root_login:
        await record_auth_attempt(email, False)

        raise HTTPException(status_code=403, detail="Esta conta não pertence à área selecionada")

    if user_doc.get("status") == "reprovado":
        await record_auth_attempt(email, False)

        raise HTTPException(status_code=403, detail="Seu cadastro não foi aprovado. Entre em contato com a escola.")

    if user_doc.get("status") not in ("ativo", "pendente"):
        await record_auth_attempt(email, False)

        raise HTTPException(status_code=403, detail="Esta conta não está ativa")

    if user_doc.get("status") == "pendente" and user_doc.get("tipo") != "professor":
        await record_auth_attempt(email, False)

        raise HTTPException(status_code=403, detail="Esta conta não está ativa")

    if user_doc.get("email", "").lower() != email:
        await record_auth_attempt(email, False)

        raise HTTPException(status_code=401, detail="O e-mail Google não corresponde a esta conta")

    if not user_doc.get("email_verified"):
        # The Google ID token is the proof. Google validates the address itself and
        # carries email_verified=true in the JWT payload. Trust ONLY that flag — the
        # e-mail match below proves the address matches the account, but not that the
        # account's owner controls it (that is the pre-account-takeover: an attacker
        # registers with the victim's e-mail and a password of their own; linking
        # google_sub to that unverified account would hand them the victim's account
        # the moment the real owner signs in with Google).
        if not claims.get("email_verified"):
            await record_auth_attempt(email, False)

            raise HTTPException(
                status_code=403,
                detail="Não foi possível validar o e-mail desta conta via Google. Confirme seu endereço de e-mail para vincular a conta.",
            )

        # Google validated the identity, so the local account is now verified too.
        await db.users.update_one(
            {"id": user_doc["id"]},
            {"$set": {"google_sub": claims["sub"], "email_verified": True}},
        )

        user_doc["google_sub"] = claims["sub"]

        user_doc["email_verified"] = True

    elif not user_doc.get("google_sub"):
        # Verified account that never signed in with Google. Same gate applies: the
        # token must carry email_verified=true before google_sub is written, otherwise
        # an attacker who guesses the victim's e-mail could bind their Google identity
        # to the victim's verified account.
        if not claims.get("email_verified"):
            await record_auth_attempt(email, False)

            raise HTTPException(status_code=403, detail="Não foi possível validar o e-mail via Google.")

        await db.users.update_one({"id": user_doc["id"]}, {"$set": {"google_sub": claims["sub"]}})

        user_doc["google_sub"] = claims["sub"]

    await reset_failed_attempts(email)

    await record_auth_attempt(email, True)

    user = User.model_validate(user_doc)

    set_session_cookie(response, create_token(user))

    return {"user": _public_user(user)}



@router.post("/login")

async def login(payload: LoginInput, response: Response):
    lockout = await check_account_lockout(payload.login.strip().lower())

    if lockout.get("locked"):
        raise HTTPException(status_code=423, detail=f"Conta bloqueada. Tente novamente em {lockout['minutes']} minutos.")

    rate = await check_rate_limit(payload.login.strip().lower())

    if rate["blocked"]:
        raise HTTPException(status_code=429, detail="Muitas tentativas. Aguarde 15 minutos.")

    login_value = payload.login.strip().lower()

    user_doc = await db.users.find_one({"email": login_value}, {"_id": 0})

    if not user_doc or not user_doc.get("senha_hash") or not verify_password(payload.senha, user_doc["senha_hash"]):
        await record_auth_attempt(login_value, False)

        await increment_failed_attempts(login_value)

        raise HTTPException(status_code=401, detail="E-mail ou senha inválidos")

    # E-mail verification gate. Placed AFTER the password check on purpose: before it,
    # the response would leak which e-mails have accounts (a correct password for a
    # verified address would say "verify your e-mail" while a wrong one says
    # "invalid credentials"). Now the same message comes out for wrong password and
    # unverified account alike — no oracle.
    if not user_doc.get("email_verified"):
        await record_auth_attempt(login_value, False)

        raise HTTPException(
            status_code=403,
            detail="Por favor, verifique seu endereço de e-mail antes de iniciar sessão.",
        )

    await reset_failed_attempts(login_value)

    await record_auth_attempt(login_value, True)

    selected_role = payload.tipo_esperado

    is_root = user_doc.get("tipo") == "admin" and user_doc.get("is_root_admin") is True

    if user_doc.get("tipo") != selected_role and not (selected_role == "professor" and is_root):
        raise HTTPException(status_code=403, detail="Esta conta não pertence à área selecionada")

    if user_doc.get("status") == "reprovado":
        raise HTTPException(status_code=403, detail="Seu cadastro não foi aprovado. Entre em contato com a escola.")

    if user_doc.get("status") == "pendente" and user_doc.get("tipo") != "professor":
        raise HTTPException(status_code=403, detail="Esta conta não está ativa")

    if user_doc.get("status") not in ("ativo", "pendente"):
        raise HTTPException(status_code=403, detail="Esta conta não está ativa")

    user = User.model_validate(user_doc)

    set_session_cookie(response, create_token(user))

    return {"user": _public_user(user)}



# ─── E-mail verification (pre-account-takeover defense) ───────────────────────
VERIFICATION_TTL_SECONDS = 60 * 60 * 24  # 24h


def _generate_verification_token() -> str:
    """URL-safe one-time token. Only its SHA-256 is stored, mirroring the password-reset
    flow — a leaked database cannot be replayed as a confirmation link."""
    return secrets.token_urlsafe(32)


async def _send_confirmation_email(user_document: dict) -> None:
    """Issue a confirmation link and queue the e-mail.

    Persistence failure raises so the caller can log it; envelope failure is non-fatal
    (the account exists either way and a new link can be requested).
    """
    email = str(user_document.get("email", "")).lower()
    token = _generate_verification_token()

    await db.users.update_one(
        {"id": user_document["id"]},
        {
            "$set": {
                "verification_token_hash": hashlib.sha256(token.encode()).hexdigest(),
                "verification_expires_at": now_utc() + timedelta(seconds=VERIFICATION_TTL_SECONDS),
            }
        },
    )

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    verify_url = f"{frontend_url.rstrip('/')}/confirmar-email?token={token}"

    try:
        await send_email(
            to=email,
            subject="Confirme seu e-mail — Gestão Esportiva Escolar",
            html=_confirmation_email_html(user_document.get("nome", "Usuário"), verify_url),
        )
    except Exception:
        await db.email_queue.insert_one({
            "type": "email_verification",
            "to": email,
            "template": "email_verification",
            "data": {"user_name": user_document.get("nome", "Usuário"), "verify_url": verify_url},
            "created_at": now_utc(),
            "status": "pending",
        })
        raise


def _confirmation_email_html(name: str, url: str) -> str:
    name = escape(name)
    from_name = escape(os.environ.get("EMAIL_FROM_NAME", "Gestão Esportiva Escolar"))

    return (
        f'<table style="width:100%;background:#F4F6F1;padding:32px 0">'
        f'<tr><td align="center"><table style="max-width:560px;background:#fff;border-radius:12px">'
        f'<tr><td style="padding:24px">'
        f'<p style="margin:0 0 4px;color:#64748B;font-size:13px">Confirmação de e-mail</p>'
        f'<h1 style="margin:0 0 12px;color:#0F172A;font-size:20px">Olá, {name}</h1>'
        f'<p style="margin:0 0 16px;color:#0F172A;font-size:15px;line-height:1.6">'
        f'Clique no botão abaixo para confirmar que este e-mail é seu. O link é válido por 24 horas.</p>'
        f'<p style="margin:0 0 16px"><a href="{url}" style="display:inline-block;background:#0D9488;color:#fff;'
        f'padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Confirmar meu e-mail</a></p>'
        f'<p style="margin:0;color:#64748B;font-size:13px">Se você não criou esta conta, ignore este e-mail — nada será alterado.</p>'
        f'</td></tr>'
        f'<tr><td style="padding:16px 24px;border-top:1px solid #E2E8F0">'
        f'<p style="margin:0;font-size:12px;color:#94A3B8">Enviado por {from_name}.</p>'
        f'</td></tr></table></td></tr></table>'
    )


def _password_reset_email_html(user_name: str, reset_url: str) -> str:
    name = escape(user_name or "Usuário")

    url = escape(reset_url)

    return (

        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'

        '<tr><td style="padding:24px;font-family:Arial,sans-serif;background:#F8FAFC">'

        '<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;'

        'background:#fff;border:1px solid #E2E8F0;border-radius:12px">'

        '<tr><td style="background:#090D16;border-radius:12px 12px 0 0;padding:20px 24px">'

        '<span style="color:#38BDF8;font-size:13px;font-weight:bold;letter-spacing:2px">'

        'GESTÃO ESPORTIVA ESCOLAR</span></td></tr>'

        f'<tr><td style="padding:24px">'

        f'<p style="margin:0 0 4px;color:#64748B;font-size:13px">Redefinição de senha</p>'

        f'<h1 style="margin:0 0 12px;color:#0F172A;font-size:20px">Olá, {name}</h1>'

        f'<p style="margin:0 0 16px;color:#0F172A;font-size:15px;line-height:1.6">'

        f'Você solicitou a redefinição da sua senha. Clique no botão abaixo para criar uma nova senha. '

        f'O link é válido por 1 hora.</p>'

        f'<p style="margin:0 0 16px"><a href="{url}" style="display:inline-block;background:#0D9488;color:#fff;'

        f'padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Redefinir minha senha</a></p>'

        f'<p style="margin:0;color:#64748B;font-size:13px">Se você não solicitou essa alteração, ignore este e-mail — sua senha permanece a mesma.</p>'

        f'</td></tr>'

        f'<tr><td style="padding:16px 24px;border-top:1px solid #E2E8F0">'

        f'<p style="margin:0;font-size:12px;color:#94A3B8">Enviado por {escape(os.environ.get("EMAIL_FROM_NAME", "Gestão Esportiva Escolar"))}'

        f'. Nunca pedimos senhas ou códigos por e-mail ou WhatsApp.</p>'

        f'</td></tr></table></td></tr></table>'

    )



@router.post("/forgot-password")

async def forgot_password(payload: ForgotPasswordInput):
    email = payload.email.strip().lower()

    rate = await check_rate_limit(f"reset:{email}")

    if rate["blocked"]:
        raise HTTPException(status_code=429, detail="Muitas solicitações. Aguarde 15 minutos.")

    user_doc = await db.users.find_one({"email": email}, {"_id": 0})

    if not user_doc:
        return {"message": "Se o e-mail estiver cadastrado, um link de redefinição foi enviado."}

    reset_token = secrets.token_urlsafe(32)

    expires_at = now_utc() + timedelta(hours=1)

    await db.password_resets.insert_one({

        "user_id": user_doc["id"],

        "email": email,

        "token_hash": hashlib.sha256(reset_token.encode()).hexdigest(),

        "expires_at": expires_at,

        "used": False,

    })

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")

    reset_url = f"{frontend_url.rstrip('/')}/reset-senha?token={reset_token}"

    queue_doc = {

        "type": "password_reset",

        "to": email,

        "template": "password_reset",

        "data": {"user_name": user_doc.get("nome", "Usuário"), "reset_token": reset_token, "reset_url": reset_url},

        "created_at": now_utc(),

        "status": "pending",

    }

    try:
        email_id = await send_email(

            to=email,

            subject="Redefina sua senha — Gestão Esportiva Escolar",

            html=_password_reset_email_html(user_doc.get("nome", "Usuário"), reset_url),

        )

        queue_doc["status"] = "sent"

        queue_doc["provider_id"] = email_id

        queue_doc["sent_at"] = now_utc()

    except Exception as exc:
        logging.getLogger(__name__).warning("Password reset email sync send failed, queued for retry: %s", exc)

        queue_doc["status"] = "failed"

        queue_doc["error"] = str(exc)[:300]

    await db.email_queue.insert_one(queue_doc)

    await record_auth_attempt(f"reset:{email}", True)

    return {"message": "Se o e-mail estiver cadastrado, um link de redefinição foi enviado."}



@router.post("/reset-password")

async def reset_password(payload: ResetPasswordInput):
    token_hash = hashlib.sha256(payload.token.encode()).hexdigest()

    reset_doc = await db.password_resets.find_one({

        "token_hash": token_hash,

        "used": False,

    }, {"_id": 0})

    if not reset_doc:
        raise HTTPException(status_code=400, detail="Token inválido ou já utilizado.")

    expires_at = reset_doc.get("expires_at")

    if isinstance(expires_at, datetime) and expires_at < now_utc():
        raise HTTPException(status_code=400, detail="Token expirado.")

    user_doc = await db.users.find_one({"id": reset_doc["user_id"]}, {"_id": 0})

    if not user_doc:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    new_hash = hash_password(payload.new_password)

    await db.users.update_one(

        {"id": reset_doc["user_id"]},

        {"$set": {"senha_hash": new_hash, "motivo_reprovacao": None}, "$unset": {"locked_until": 1}},

    )

    await db.password_resets.update_one(

        {"token_hash": token_hash},

        {"$set": {"used": True}},

    )

    return {"message": "Senha redefinida com sucesso."}



@router.post("/change-password")

async def change_password(payload: ChangePasswordInput, user: User = Depends(get_current_user)):
    if not user.senha_hash or not verify_password(payload.current_password, user.senha_hash):
        raise HTTPException(status_code=401, detail="Senha atual incorreta.")

    new_hash = hash_password(payload.new_password)

    await db.users.update_one({"id": user.id}, {"$set": {"senha_hash": new_hash}})

    return {"message": "Senha alterada com sucesso."}



@router.get("/me")

async def get_session(user: User = Depends(get_current_user)):
    return {"user": _public_user(user)}



@router.post("/confirm-email")

async def confirm_email(payload: ConfirmEmailInput):
    """Consume a confirmation link: /confirmar-email?token=... from the e-mail.

    One-time and time-boxed. The token is compared by hash, so the raw value never
    needs to be stored — and cannot be derived from the database.
    """
    token_hash = hashlib.sha256((payload.token or "").encode()).hexdigest()

    user_doc = await db.users.find_one(
        {"verification_token_hash": token_hash},
        {"_id": 0, "id": 1, "email": 1, "email_verified": 1, "verification_expires_at": 1},
    )

    if not user_doc:
        raise HTTPException(status_code=400, detail="Link de confirmação inválido ou já utilizado.")

    expires_at = user_doc.get("verification_expires_at")

    if expires_at and ensure_aware(expires_at) < now_utc():
        raise HTTPException(status_code=400, detail="O link de confirmação expirou. Solicite um novo na tela de login.")

    await db.users.update_one(
        {"id": user_doc["id"]},
        {
            "$set": {"email_verified": True},
            "$unset": {"verification_token_hash": "", "verification_expires_at": ""},
        },
    )

    return {"email": user_doc.get("email"), "email_verified": True, "message": "E-mail confirmado com sucesso."}



@router.post("/resend-confirmation")

async def resend_confirmation(payload: ResendConfirmationInput):
    """Reissue the confirmation link.

    Responds the same way whether or not the e-mail has an account (and whether or not
    it is already verified) so the endpoint cannot be used to enumerate accounts.
    """
    email = (payload.email or "").strip().lower()

    if email:
        user_doc = await db.users.find_one({"email": email}, {"_id": 0})

        # Already verified → nothing to send, but keep the response identical.
        if user_doc and not user_doc.get("email_verified"):
            try:
                await _send_confirmation_email(user_doc)
            except Exception as exc:
                logging.getLogger(__name__).error(
                    '{"event": "confirmation_email_failed", "email": "%s", "error": "%s"}', email, exc
                )

    return {"message": "Se este e-mail tiver uma conta pendente, o link de confirmação foi reenviado."}



@router.post("/logout", status_code=204)

async def logout(response: Response, _user: User = Depends(get_current_user)):
    clear_session_cookie(response)

    return response



@router.post("/google-link")

async def link_google_account(payload: GoogleLinkInput, user: User = Depends(get_current_user)):
    """Vincula uma conta Google ao usuário autenticado (incluindo Admin Raiz)."""
    claims = await _google_claims(payload.credential)
    google_email = str(claims.get("email", "")).lower()

    google_sub = claims.get("sub")

    if not google_email or not google_sub:
        raise HTTPException(status_code=400, detail="Não foi possível validar a conta Google")

    if user.email and user.email.lower() != google_email:
        raise HTTPException(

            status_code=400,

            detail=f"O e-mail da conta Google ({google_email}) não corresponde ao e-mail desta conta ({user.email}).",

        )

    existing = await db.users.find_one({"google_sub": google_sub}, {"_id": 0, "id": 1, "email": 1})

    if existing and existing.get("id") != user.id:
        raise HTTPException(status_code=409, detail="Esta conta Google já está vinculada a outro usuário.")

    await db.users.update_one(

        {"id": user.id},

        {"$set": {"google_sub": google_sub}},

    )

    await record_auth_attempt(user.email, True)

    return {"google_linked": True, "google_email": google_email, "user_id": user.id}



@router.post("/google-unlink", status_code=204)

async def unlink_google_account(user: User = Depends(get_current_user)):
    """Desvincula a conta Google do usuário autenticado. Requer senha definida como fallback."""
    if not user.senha_hash:
        raise HTTPException(

            status_code=400,

            detail="Defina uma senha antes de desvincular a conta Google, para não perder o acesso.",

        )

    await db.users.update_one({"id": user.id}, {"$unset": {"google_sub": ""}})

    return Response(status_code=204)



@router.post("/students/{aluno_id}/credentials", status_code=201)

async def provision_student_login(aluno_id: str, payload: ProvisionStudentLoginInput, admin: User = Depends(get_current_user)):
    if admin.tipo != "admin" or not admin.is_root_admin:
        raise HTTPException(status_code=403, detail="Apenas o administrador raiz pode criar o acesso do aluno")

    student = await db.alunos.find_one({"id": aluno_id}, {"_id": 0, "id": 1, "nome": 1})

    if not student:
        raise HTTPException(status_code=404, detail="Aluno não encontrado")

    email = str(payload.email).lower()

    if await db.users.find_one({"$or": [{"email": email}, {"aluno_id": aluno_id}]}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Já existe uma conta vinculada a este e-mail ou aluno")

    user_doc = {"id": str(uuid.uuid4()), "nome": student["nome"], "email": email,

        "senha_hash": hash_password(payload.senha), "google_sub": None, "tipo": "aluno", "aluno_id": aluno_id,

        "status": "ativo", "telefone": None, "filhos_ids": [], "is_root_admin": False,

        "dataCriacao": now_utc()}

    await db.users.insert_one(user_doc)

    return {"user": {"id": user_doc["id"], "nome": user_doc["nome"], "email": email, "tipo": "aluno"}}



@children_router.get("/children")

async def linked_children(user: User = Depends(get_current_user)):
    if user.tipo != "responsavel":
        raise HTTPException(status_code=403, detail="Somente responsáveis podem escolher um aluno vinculado")

    children: dict[str, dict] = {}

    if user.filhos_ids:
        async for record in db.alunos.find({"id": {"$in": user.filhos_ids}}, {"_id": 0, "id": 1, "nome": 1, "turma_id": 1, "participa_ranking": 1}):
            children[record["id"]] = record

    async for record in db.alunos.find({"responsavel_id": user.id}, {"_id": 0, "id": 1, "nome": 1, "turma_id": 1, "participa_ranking": 1}):
        children[record["id"]] = record

    return {"children": list(children.values())}



@children_router.post("/link-responsavel", status_code=204)

async def link_responsible(payload: DocumentLinkInput, user: User = Depends(get_current_user)):
    if user.tipo != "admin" or not user.is_root_admin:
        raise HTTPException(status_code=403, detail="Somente o administrador raiz pode vincular um responsável")

    responsible = await db.users.find_one({"id": payload.responsavel_id, "tipo": "responsavel", "status": "ativo"}, {"_id": 1})

    if not responsible:
        raise HTTPException(status_code=404, detail="Conta de responsável não encontrada")

    linked = await db.alunos.update_one({"id": payload.aluno_id}, {"$set": {"responsavel_id": payload.responsavel_id}})

    if not linked.matched_count:
        raise HTTPException(status_code=404, detail="Aluno não encontrado")

    await db.users.update_one({"id": payload.responsavel_id}, {"$addToSet": {"filhos_ids": payload.aluno_id}})

    await publish_event(payload.aluno_id, "portal")

    return Response(status_code=204)
