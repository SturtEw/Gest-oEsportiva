"""Keep the root administrator in sync with the deployment environment.

`ADMIN_USER` (an e-mail — login is by e-mail) and `ADMIN_PASSWORD` are the source
of truth for the root account. On every boot the account is created if missing,
or brought back to them: e-mail, password, active + verified state, and any
lockout from failed attempts is lifted. Without both variables nothing happens,
so deployments that bootstrapped the admin by script keep working unchanged.

Changing ADMIN_PASSWORD on Render and redeploying is therefore how the password
is rotated; a password changed inside the app is reset to ADMIN_PASSWORD on the
next boot. The legacy ROOT_ADMIN_* variables are deliberately NOT read here: they
were documented as one-time bootstrap values and may hold a stale password.
"""

import logging
import os
import uuid
from typing import Literal

from pydantic import EmailStr, TypeAdapter, ValidationError
from pymongo.errors import DuplicateKeyError

from lib.dates import now_utc
from lib.db import db
from lib.security import hash_password, verify_password

logger = logging.getLogger(__name__)

USER_ENV = "ADMIN_USER"
PASSWORD_ENV = "ADMIN_PASSWORD"
NAME_ENV = "ADMIN_NAME"
DEFAULT_NAME = "Administrador raiz"
# Same floor as every other account password in the app.
MIN_PASSWORD_LENGTH = 10

Outcome = Literal["skipped", "invalid", "conflict", "created", "updated", "unchanged"]

_EMAIL = TypeAdapter(EmailStr)


def _mask(email: str) -> str:
    name, _, domain = email.partition("@")
    return f"{name[:2]}***@{domain}" if domain else "***"


def _password_matches(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False
    try:
        return verify_password(password, stored_hash)
    except (ValueError, TypeError):
        # Unknown/corrupt hash format: treat as mismatch so it gets rewritten.
        return False


def read_credentials() -> tuple[str, str] | None:
    """(email, password) from the environment, or None when not configured.

    Values are stripped: a value pasted into the Render panel with a trailing
    newline or space would otherwise never match what the admin types.
    """
    email = os.environ.get(USER_ENV, "").strip().lower()
    password = os.environ.get(PASSWORD_ENV, "").strip()
    if not email and not password:
        return None
    return email, password


async def ensure_root_admin() -> Outcome:
    credentials = read_credentials()
    if credentials is None:
        logger.info("[root-admin] %s/%s não definidos; conta raiz não é gerenciada pelo ambiente.", USER_ENV, PASSWORD_ENV)
        return "skipped"

    email, password = credentials
    try:
        email = str(_EMAIL.validate_python(email)).lower()
    except ValidationError:
        logger.error("[root-admin] %s precisa ser um e-mail válido (o login é feito por e-mail). Conta raiz não sincronizada.", USER_ENV)
        return "invalid"
    if len(password) < MIN_PASSWORD_LENGTH:
        logger.error("[root-admin] %s precisa ter pelo menos %d caracteres. Conta raiz não sincronizada.", PASSWORD_ENV, MIN_PASSWORD_LENGTH)
        return "invalid"

    by_email = await db.users.find_one({"email": email}, {"_id": 0})
    if by_email and by_email.get("is_root_admin") is not True:
        # Never silently elevate an ordinary account to root.
        logger.error(
            "[root-admin] O e-mail de %s (%s) já pertence a uma conta do tipo '%s'. Use outro e-mail ou remova essa conta.",
            USER_ENV, _mask(email), by_email.get("tipo"),
        )
        return "conflict"

    # Same e-mail, or the existing root account being moved to a new e-mail.
    target = by_email or await db.users.find_one({"is_root_admin": True}, {"_id": 0})

    if target is None:
        try:
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "nome": os.environ.get(NAME_ENV, "").strip() or DEFAULT_NAME,
                "email": email,
                "senha_hash": hash_password(password),
                "google_sub": None,
                "tipo": "admin",
                "aluno_id": None,
                "status": "ativo",
                "telefone": None,
                "filhos_ids": [],
                "is_root_admin": True,
                "email_verified": True,
                "dataCriacao": now_utc(),
            })
        except DuplicateKeyError:
            # A concurrent boot (another instance) created it first.
            logger.info("[root-admin] Conta raiz criada por outra instância.")
            return "unchanged"
        logger.info("[root-admin] Conta raiz criada para %s.", _mask(email))
        return "created"

    changes: dict = {}
    if target.get("email") != email:
        changes["email"] = email
        # The linked Google identity belonged to the old address.
        changes["google_sub"] = None
    if target.get("tipo") != "admin":
        changes["tipo"] = "admin"
    if target.get("status") != "ativo":
        changes["status"] = "ativo"
    if target.get("email_verified") is not True:
        changes["email_verified"] = True
    password_changed = not _password_matches(password, target.get("senha_hash"))
    if password_changed:
        changes["senha_hash"] = hash_password(password)
        # Sessions opened with the old password end now.
        changes["token_valid_after"] = now_utc()
    unlock = bool(target.get("locked_until") or target.get("failed_attempts"))

    if changes or unlock:
        update: dict = {}
        if changes:
            update["$set"] = changes
        if unlock:
            update["$unset"] = {"locked_until": 1, "failed_attempts": 1}
        try:
            await db.users.update_one({"id": target["id"]}, update)
        except DuplicateKeyError:
            logger.error("[root-admin] Não foi possível mudar o e-mail da conta raiz para %s: e-mail já em uso.", _mask(email))
            return "conflict"

    # Failed attempts made while the password was out of sync must not keep the
    # admin rate-limited (10 failures / 15 min) after the fix is deployed.
    await db.auth_attempts.delete_many({"key": f"ratelimit:{email}", "success": False})

    if not changes and not unlock:
        logger.info("[root-admin] Conta raiz de %s já está sincronizada.", _mask(email))
        return "unchanged"
    fields = sorted(key for key in changes if key not in ("senha_hash", "token_valid_after", "google_sub"))
    logger.info(
        "[root-admin] Conta raiz de %s sincronizada (senha %s%s%s).",
        _mask(email), "redefinida" if password_changed else "mantida",
        f"; campos: {', '.join(fields)}" if fields else "", "; bloqueio removido" if unlock else "",
    )
    return "updated"
