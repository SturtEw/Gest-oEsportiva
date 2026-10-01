"""Auth primitives: password hashing, JWT session (7 dias), httpOnly cookie,
Double-Submit CSRF cookie, e dependências de RBAC (get_current_user / require_role).
"""

import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone


import jwt
from fastapi import Depends, HTTPException, Request, Response
from passlib.context import CryptContext


from lib.dates import now_utc
from lib.db import db
from models.models import User


pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


APP_ENV = os.environ.get("APP_ENV", "development").lower()


JWT_SECRET = os.environ.get("JWT_SECRET")


if not JWT_SECRET:
    if APP_ENV == "production":
        raise RuntimeError("JWT_SECRET deve estar definido em produção")

    JWT_SECRET = "dev-insecure-secret"


CSRF_HMAC_SECRET = os.environ.get("CSRF_HMAC_SECRET") or JWT_SECRET


COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true" if APP_ENV == "production" else "false").lower() == "true"


# Em cross-origin (front no Firebase Hosting, API no Render), o navegador só
# envia o cookie de sessão se ele for SameSite=None; Secure. 'Strict' funciona
# apenas quando front e API compartilham a mesma origem (dev com proxy do Vite).
# Configurável: SESSION_SAMESITE=none em produção cross-origin.
SESSION_SAMESITE = os.environ.get("SESSION_SAMESITE", "strict" if APP_ENV == "production" else "lax").lower()
if SESSION_SAMESITE not in ("strict", "lax", "none"):
    SESSION_SAMESITE = "strict"


JWT_ALGORITHM = "HS256"


SESSION_DAYS = 7


SESSION_COOKIE = "gesp_session"


CSRF_COOKIE = "gesp_csrf"


CSRF_HEADER = "X-CSRF-Token"


CSRF_BYTES = 32


STATELESS_CSRF = os.environ.get("STATELESS_CSRF", "true").lower() == "true"


IDEMPOTENT_METHODS = {"GET", "HEAD", "OPTIONS"}


AUTH_SAFE_PATHS = {

    "/api/auth/login",

    "/api/auth/google-login",

    "/api/auth/register",

    "/api/auth/google-config",

    "/api/auth/forgot-password",

    "/api/auth/reset-password",

    "/api/auth/me",

    "/api/auth/logout",

    "/api/health",


}



def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)



def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)



def create_token(user: User) -> str:
    payload = {

        "sub": user.id,

        "tipo": user.tipo,

        "iat": now_utc(),

        "exp": now_utc() + timedelta(days=SESSION_DAYS),

        "jti": str(uuid.uuid4()),

    }

    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)



def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])



def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(

        SESSION_COOKIE,

        token,

        max_age=SESSION_DAYS * 24 * 3600,

        httponly=True,

        secure=COOKIE_SECURE,

        samesite=SESSION_SAMESITE,  # "none" em cross-origin (obrigatório + Secure)

        path="/",

    )

    set_csrf_cookie(response)



def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", secure=COOKIE_SECURE, httponly=True, samesite=SESSION_SAMESITE if SESSION_SAMESITE != "none" else "none")

    clear_csrf_cookie(response)



def _csrf_sign(token: str) -> str:
    return hmac.new(CSRF_HMAC_SECRET.encode("utf-8"), token.encode("utf-8"), "sha256").hexdigest()



def issue_csrf_token() -> str:
    raw = secrets.token_urlsafe(CSRF_BYTES)

    sig = _csrf_sign(raw)

    return f"{raw}.{sig}"



def verify_csrf_token(value: str | None) -> bool:
    if not value or "." not in value:
        return False

    try:
        raw, sig = value.rsplit(".", 1)

        expected = _csrf_sign(raw)

        return hmac.compare_digest(expected, sig) and len(raw) >= 32

    except Exception:
        return False



def set_csrf_cookie(response: Response) -> str:
    token = issue_csrf_token()

    response.set_cookie(

        CSRF_COOKIE,

        token,

        max_age=SESSION_DAYS * 24 * 3600,

        httponly=False,  # Required for double-submit pattern (frontend reads cookie)

        secure=COOKIE_SECURE,

        samesite="strict",  # Strict CSRF protection

        path="/",

    )

    return token



def clear_csrf_cookie(response: Response) -> None:
    response.delete_cookie(CSRF_COOKIE, path="/", secure=COOKIE_SECURE, httponly=False, samesite="strict")



def csrf_protected(request: Request) -> bool:
    """Validate double-submit CSRF for state-changing requests.

    Safe paths (auth entrypoints) and idempotent methods are skipped.
    For Websocket paths we skip because cookies cannot be set in upgrade

    request headers; the websocket handshake validates the session JWT.

    """
    if request.method in IDEMPOTENT_METHODS:
        return True

    path = request.url.path

    if path in AUTH_SAFE_PATHS:
        return True

    if path.startswith("/api/realtime"):
        return True

    if STATELESS_CSRF:
        cookie_token = request.cookies.get(CSRF_COOKIE)

        header_token = request.headers.get(CSRF_HEADER)

        if not verify_csrf_token(cookie_token) or not verify_csrf_token(header_token):
            return False

        return hmac.compare_digest(cookie_token or "", header_token or "")

    return True



async def revoke_user_tokens(user_id: str) -> None:
    """Revoke every outstanding session for a user by stamping
    token_valid_after on the user document. Tokens issued before this
    timestamp will be rejected by get_current_user.
    """
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"token_valid_after": now_utc()}},
    )


async def is_token_revoked(payload: dict) -> bool:
    """Reject revoked/malformed sessions, checking both jti and account cutoff."""
    sub = payload.get("sub")
    jti = payload.get("jti")
    iat = payload.get("iat")
    # Tokens issued by create_token always carry these claims. Reject malformed
    # signed tokens rather than silently bypassing individual or bulk revocation.
    if not isinstance(sub, str) or not sub or not isinstance(jti, str) or not jti or type(iat) not in (int, float):
        return True
    try:
        iat_dt = datetime.fromtimestamp(iat, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return True
    # A database outage must not turn a revocation check into an authorization.
    # Let database exceptions propagate; callers must fail closed.
    doc = await db.users.find_one({"id": sub}, {"_id": 0, "id": 1, "token_valid_after": 1})
    if not doc:
        return True
    # Check the individual token regardless of whether token_valid_after exists.
    if await db.revoked_jti.find_one({"jti": jti}, {"_id": 0, "jti": 1}):
        return True
    stamp = doc.get("token_valid_after")
    if stamp is None:
        return False
    if not isinstance(stamp, datetime):
        return True
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)

    return iat_dt < stamp


async def revoke_token(jti: str) -> None:
    """Insert a single revoked jti into the revoked_jti collection so
    that a specific token can be invalidated even without touching the
    user's token_valid_after stamp.
    """
    await db.revoked_jti.insert_one({"jti": jti, "revoked_at": now_utc()})


async def get_current_user(request: Request) -> User:
    """Dependency: resolves the user from the httpOnly session cookie."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")

    try:
        payload = decode_token(token)

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão expirada. Faça login novamente.")

    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sessão inválida")

    if await is_token_revoked(payload):
        raise HTTPException(status_code=401, detail="Sessao revogada. Faca login novamente.")

    doc = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})

    if not doc:
        raise HTTPException(status_code=401, detail="Sessão inválida")

    if payload.get("tipo") != doc.get("tipo"):
        raise HTTPException(status_code=401, detail="Sessão inválida")

    if doc.get("tipo") == "aluno" and not doc.get("aluno_id"):
        raise HTTPException(status_code=401, detail="Conta de aluno não vinculada")

    if doc.get("status") in ("inativo", "reprovado"):
        raise HTTPException(status_code=403, detail="Conta desativada")

    if doc.get("status") == "pendente" and doc.get("tipo") != "professor":
        raise HTTPException(status_code=403, detail="Conta ainda não está ativa")

    return User(**doc)



def require_role(*tipos: str):
    """RBAC dependency factory: require_role("admin", "professor")."""

    async def dependency(user: User = Depends(get_current_user)) -> User:
        if user.tipo not in tipos:
            raise HTTPException(status_code=403, detail="Acesso restrito para este perfil")

        return user

    return dependency
