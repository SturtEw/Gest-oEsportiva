"""Professional hardening layer: standardized error payloads, audit ring, security
headers, rate limiting, body-size cap and CSRF double-submit enforcement.

Every error response leaves as { code, message, traceId } (plus `errors` for

validation failures) — no stack traces leak to the client; the traceId is what

ties a user complaint back to the server log.

"""

import datetime
import logging
import os
import secrets
import time
import uuid
from collections import deque


from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


from lib.dates import now_utc
from lib.db import db as mongo_db
from lib.security import csrf_protected, set_csrf_cookie


logger = logging.getLogger(__name__)


# In-memory audit trail (newest first) surfaced in the admin panel /api/admin/auditoria.
AUDIT: deque = deque(maxlen=200)


MAX_BODY_BYTES = 64 * 1024  # mirror of the doc's json body cap — blocks memory-abuse payloads


APP_ENV = os.environ.get("APP_ENV", "development").lower()


PRODUCTION = APP_ENV == "production"


TRUST_PROXY = os.environ.get("TRUST_PROXY", "false").lower() == "true"


SECURITY_HEADERS = {

    "X-Content-Type-Options": "nosniff",        # helmet: no MIME sniffing

    "X-Frame-Options": "DENY",                  # helmet: no clickjacking

    "Referrer-Policy": "strict-origin-when-cross-origin",

    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",


}


CSP_NONCE_LENGTH = 32


GOOGLE_SCRIPT_ORIGINS = (

    "https://accounts.google.com",

    "https://www.gstatic.com",


)


def csp_header(nonce: str) -> str:
    gapi = " ".join(f"'{src}'" for src in GOOGLE_SCRIPT_ORIGINS)

    script_src = (

        f"script-src 'nonce-{nonce}' 'strict-dynamic' https: 'unsafe-inline';"

        if PRODUCTION

        else f"script-src 'self' 'nonce-{nonce}' 'unsafe-inline' 'unsafe-eval' {gapi};"

    )

    style_src = (

        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://accounts.google.com;"

    )

    font_src = (

        "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com data:;"

    )

    img_src = (

        "img-src 'self' data: https: blob:;"

    )

    connect_src = (

        f"connect-src 'self' {gapi} wss: ws:;"

    )

    frame_src = (

        "frame-src 'self' https://accounts.google.com;"

    )

    base = "base-uri 'self';"

    form = "form-action 'self';"

    object_src = "object-src 'none';"

    default = "default-src 'self';"

    return " ".join([default, script_src, style_src, font_src, img_src, connect_src, frame_src, base, form, object_src])


RATE_LIMITS: list[tuple[str, int, int]] = [
    ("/api/auth/login", 20, 900),
    ("/api/auth/google-login", 20, 900),
    ("/api/auth/register", 10, 900),
]


DEFAULT_LIMIT = (240, 900)  # 240 req / 15 min por IP


# Rotas fora do rate limit. O health check do Render bate a cada poucos
# segundos do mesmo IP: contá-lo esgotaria a cota (429 = instância "unhealthy")
# e amarraria a saúde do serviço a três escritas no Mongo por sonda.
RATE_LIMIT_EXEMPT_PATHS = {"/api/health"}


async def _allow(path: str, ip: str) -> tuple[bool, int | None]:
    """Sliding-window rate limit backed by MongoDB with atomic operations.

    Returns (allowed, retry_after_seconds). Each request is stored as a
    timestamped event in the `rate_limits` collection; the window is enforced
    by counting events within the last `secs` seconds and a TTL index on
    `expires_at` auto-cleans stale documents.
    """
    window = DEFAULT_LIMIT
    for prefix, limit, secs in RATE_LIMITS:
        if path.startswith(prefix):
            window = (limit, secs)

            break

    limit, secs = window

    key = f"{path}:{ip}"
    now = time.time()
    cutoff = now - secs

    collection = mongo_db.rate_limits

    # Remove expired events atomically (defensive cleanup; TTL index also does this)
    await collection.delete_many({"path": path, "ip": ip, "ts": {"$lt": cutoff}})

    # Count remaining events in the current window
    count = await collection.count_documents({"path": path, "ip": ip, "ts": {"$gte": cutoff}})
    if count >= limit:
        return False, secs

    # Insert this request event; TTL index will drop it after `secs` seconds
    await collection.insert_one(
        {
            "path": path,
            "ip": ip,
            "ts": now,
            "expires_at": datetime.datetime.fromtimestamp(
                now + secs, tz=datetime.timezone.utc
            ),
        }
    )

    return True, None


def record_error(trace_id: str, code: int, method: str, path: str, message: str) -> None:
    AUDIT.appendleft(

        {

            "traceId": trace_id,

            "code": code,

            "metodo": method,

            "path": path,

            "mensagem": message[:300],

            "at": now_utc().isoformat(),

        }

    )


def _error_body(code: int, message: str, trace_id: str, errors: list | None = None) -> dict:
    body = {"code": code, "message": message, "traceId": trace_id}

    if errors is not None:
        body["errors"] = errors

    return body


def _ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if TRUST_PROXY and forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)

    async def http_exception_handler(request: Request, exc: HTTPException):
        trace_id = str(uuid.uuid4())

        record_error(trace_id, exc.status_code, request.method, request.url.path, str(exc.detail))

        return JSONResponse(

            status_code=exc.status_code,

            content=_error_body(exc.status_code, str(exc.detail), trace_id),

            headers=getattr(exc, "headers", None),

        )


    @app.exception_handler(RequestValidationError)

    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        trace_id = str(uuid.uuid4())

        errors = [

            {

                "campo": ".".join(str(p) for p in err.get("loc", []) if p != "body"),

                "mensagem": err.get("msg", "dado inválido"),

            }

            for err in exc.errors()

        ]

        record_error(trace_id, 422, request.method, request.url.path, "validação falhou")

        return JSONResponse(

            status_code=422,

            content=_error_body(422, "Erro de validação nos dados enviados.", trace_id, errors),

        )


    @app.exception_handler(Exception)

    async def unhandled_exception_handler(request: Request, exc: Exception):
        trace_id = str(uuid.uuid4())

        logger.exception("[ERROR] TraceID: %s | Path: %s", trace_id, request.url.path)

        record_error(trace_id, 500, request.method, request.url.path, str(exc))

        return JSONResponse(

            status_code=500,

            content=_error_body(500, "Ocorreu um erro inesperado. Tente novamente mais tarde.", trace_id),

        )


def register_middlewares(app: FastAPI) -> None:
    @app.middleware("http")

    async def harden_request(request: Request, call_next):
        nonce = secrets.token_urlsafe(CSP_NONCE_LENGTH)

        request.state.csp_nonce = nonce

        content_length = request.headers.get("content-length", "")

        if content_length.isdigit() and int(content_length) > MAX_BODY_BYTES:
            trace_id = str(uuid.uuid4())

            record_error(trace_id, 413, request.method, request.url.path, "payload excedido")

            resp = JSONResponse(

                status_code=413,

                content=_error_body(413, "Corpo da requisição muito grande.", trace_id),

            )

            resp.headers["Content-Security-Policy"] = csp_header(nonce)

            for key, value in SECURITY_HEADERS.items():
                resp.headers.setdefault(key, value)

            return resp

        if not csrf_protected(request):
            trace_id = str(uuid.uuid4())

            record_error(trace_id, 403, request.method, request.url.path, "csrf validation failed")

            resp = JSONResponse(

                status_code=403,

                content=_error_body(403, "Token de proteção CSRF ausente ou inválido.", trace_id),

            )

            resp.headers["Content-Security-Policy"] = csp_header(nonce)

            for key, value in SECURITY_HEADERS.items():
                resp.headers.setdefault(key, value)

            return resp

        exempt = request.method == "OPTIONS" or request.url.path in RATE_LIMIT_EXEMPT_PATHS

        allowed = True if exempt else (await _allow(request.url.path, _ip(request)))[0]

        if not allowed:
            trace_id = str(uuid.uuid4())

            record_error(trace_id, 429, request.method, request.url.path, "rate limit")

            resp = JSONResponse(

                status_code=429,

                content=_error_body(429, "Muitas requisições deste IP. Tente novamente em 15 minutos.", trace_id),

            )

            resp.headers["Content-Security-Policy"] = csp_header(nonce)

            for key, value in SECURITY_HEADERS.items():
                resp.headers.setdefault(key, value)

            return resp

        response = await call_next(request)

        if request.url.path in ("/", "/index.html") or request.url.path.startswith("/api/auth"):
            # Não sobrescrever um token que o handler acabou de emitir (ex.:
            # /api/auth/google-config devolve o token no corpo). Dois Set-Cookie
            # diferentes fazem o navegador guardar o último, que não bate com o
            # token do corpo, e o double-submit falha com 403.
            already_set = any(
                header.startswith("gesp_csrf=") for header in response.headers.getlist("set-cookie")
            )

            if not request.cookies.get("gesp_csrf") and not already_set:
                set_csrf_cookie(response)

        # Login/cadastro rotacionam o gesp_csrf. Em cross-origin o JS do front não
        # lê esse cookie, então espelhamos o token vigente num header exposto via
        # CORS (só origens de FRONTEND_ORIGINS conseguem lê-lo) e o client.ts
        # passa a usá-lo. Sem isso o header antigo diverge do cookie novo e toda
        # mutação autenticada cai em 403.
        for header in response.headers.getlist("set-cookie"):
            if header.startswith("gesp_csrf="):
                token = header.split(";", 1)[0].split("=", 1)[1].strip('"')

                if token:
                    response.headers["X-CSRF-Token"] = token

        # Recarga de página em cross-origin: o JS não lê o cookie gesp_csrf e o
        # token em memória morreu com o unload — a primeira mutação depois do
        # refresh caía em 403. Espelhar o token vigente do cookie em TODA resposta
        # (o /api/auth/me incluído) repõe o cache do client.ts sem custo adicional.
        if "X-CSRF-Token" not in response.headers:
            cookie_token = request.cookies.get("gesp_csrf")

            if cookie_token:
                response.headers["X-CSRF-Token"] = cookie_token

        response.headers["Content-Security-Policy"] = csp_header(nonce)

        response.headers["X-CSP-Nonce"] = nonce

        for key, value in SECURITY_HEADERS.items():
            response.headers.setdefault(key, value)

        return response
