"""FastAPI API for the student/family, teacher and root-admin portal.

From backend/: uvicorn server:app --reload --port 8000

"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path


from dotenv import load_dotenv


# Load .env before any other imports that might need env vars
load_dotenv(Path(__file__).parent / ".env")


from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware


from lib.dates import now_utc
from lib.db import mongo_lifespan, ensure_indexes, db
from lib.emailx import send_email
from lib.errors import register_error_handlers, register_middlewares
from lib.portal_access import get_authorized_aluno
from lib.impersonation import allowed_view_path
from lib.realtime import allowed_websocket_origin, hub
from lib.security import decode_token, is_token_revoked
from models.models import User
from routers.admin import router as admin_router
from routers.auth import _password_reset_email_html, children_router, router as auth_router
from routers.class_enrollment import router as class_enrollment_router
from routers.professor import router as professor_router
from routers.student import router as student_router
from routers.teacher_invites import admin_router as teacher_invites_admin_router, public_router as teacher_invites_public_router
from routers.teacher_portal import router as teacher_portal_router
from routers.treinamentos_torneios import router as treinamentos_torneios_router
from services.root_admin import ensure_root_admin


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)



def _validate_env_security() -> None:
    """Startup checks that prevent weak or misconfigured secrets in production."""
    app_env = os.environ.get("APP_ENV", "development").lower()
    production = app_env == "production"

    weak = {"dev-insecure-secret", "replace-with-a-unique-random-secret-of-at-least-32-bytes",

            "replace-with-a-separate-random-secret-of-at-least-32-bytes",

            "replace-with-a-third-random-secret-of-at-least-32-bytes",

            "REPLACE_WITH_UNIQUE_RANDOM_SECRET_32_BYTES_MINIMUM"}

    for key in ("JWT_SECRET", "CSRF_HMAC_SECRET", "DOCUMENT_HMAC_SECRET"):
        value = os.environ.get(key, "")

        if not value or len(value) < 16 or value.strip() in weak:
            if production:
                raise SystemExit(f"[FATAL] Produção: configure {key} com um segredo forte de pelo menos 16 bytes.")

            logger.warning("[SECURITY] %s está fraco ou ausente; nunca use isto em produção.", key)

    if production:
        if os.environ.get("COOKIE_SECURE", "true").lower() != "true":
            raise SystemExit("[FATAL] Produção: COOKIE_SECURE=true é obrigatório.")

        origins = [o.strip() for o in os.environ.get("FRONTEND_ORIGINS", "").split(",") if o.strip()]

        if not origins or "*" in origins:
            raise SystemExit("[FATAL] Produção: FRONTEND_ORIGINS deve listar origens explícitas (sem *).")

        if os.environ.get("ROOT_ADMIN_PASSWORD"):
            logger.warning(

                "[SECURITY] ROOT_ADMIN_PASSWORD (bootstrap legado) ainda está no ambiente e não é usado pela API. "
                "Remova-o; a conta raiz agora vem de ADMIN_USER/ADMIN_PASSWORD.",

            )


_validate_env_security()


EMAIL_WORKER_SLEEP_SECS = 30


EMAIL_WORKER_MAX_BACKOFF = 300



async def _render_template_email(template: str, data: dict) -> tuple[str, str]:
    """Render known templates into (subject, html). Always return safe outputs."""
    if template == "password_reset":
        user_name = data.get("user_name", "Usuário")

        reset_url = data.get("reset_url") or data.get("reset_token")

        if reset_url and not reset_url.startswith("http"):
            frontend = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")

            reset_url = f"{frontend}/reset-senha?token={reset_url}"

        return (

            "Redefina sua senha — Gestão Esportiva Escolar",

            _password_reset_email_html(user_name, reset_url),

        )

    if template == "announcement":
        from routers.teacher_portal import _render_comunicado_email
        return _render_comunicado_email(data)

    return (

        "Atualização da escola",

        f'<p style="font-family:Arial,sans-serif">{data.get("message", "")}</p>',

    )



async def _email_worker_once() -> int:
    """Pick up to 8 pending/failed queue items and attempt delivery. Returns sent count."""
    now = now_utc()
    cutoff = now.timestamp() - EMAIL_WORKER_MAX_BACKOFF

    cursor = db.email_queue.find(

        {

            "$or": [

                {"status": "pending"},

                {"status": "failed", "next_retry_at": {"$exists": True, "$lte": now.isoformat()}},

                {"status": "failed", "retry_count": {"$exists": False}},

                {"status": "failed", "retry_count": {"$lt": 5}, "updated_at": {"$exists": False}},

            ]

        },

        {"_id": 0},

    ).sort([("created_at", 1)]).limit(8)

    sent = 0

    async for doc in cursor:
        qid = doc.get("id") or doc.get("_id")

        if not qid:
            logger.error(

                "Email queue document without id/_id cannot be processed (to=%s); skipping.",

                doc.get("to"),

            )

            continue

        try:
            subject, html = await _render_template_email(doc.get("template", "generic"), doc.get("data", {}))

            provider_id = await send_email(to=doc["to"], subject=subject, html=html)

            await db.email_queue.update_one(

                {"_id": doc["_id"]} if "_id" in doc else {"id": qid},

                {"$set": {"status": "sent", "provider_id": provider_id, "sent_at": now.isoformat(), "updated_at": now.isoformat()}},

            )

            sent += 1

        except Exception as exc:
            retry_count = int(doc.get("retry_count", 0)) + 1

            backoff = min(EMAIL_WORKER_MAX_BACKOFF, 15 * (2 ** (retry_count - 1)))

            next_retry = datetime.fromtimestamp(now.timestamp() + backoff, tz=timezone.utc).isoformat()

            await db.email_queue.update_one(

                {"_id": doc["_id"]} if "_id" in doc else {"id": qid},

                {

                    "$set": {

                        "status": "failed",

                        "retry_count": retry_count,

                        "last_error": str(exc)[:300],

                        "next_retry_at": next_retry,

                        "updated_at": now.isoformat(),

                    }

                },

            )

            logger.warning("Email queue send failed (retry=%s, queue_id=%s): %s", retry_count, qid, exc)

    return sent



async def _email_queue_worker(stop_event: asyncio.Event) -> None:
    """Long-running background worker for the email queue."""
    backoff = EMAIL_WORKER_SLEEP_SECS
    while not stop_event.is_set():
        try:
            sent = await _email_worker_once()

            backoff = EMAIL_WORKER_SLEEP_SECS if sent == 0 else max(5, EMAIL_WORKER_SLEEP_SECS // 2)

        except Exception as exc:
            logger.exception("Email queue worker loop error: %s", exc)

            backoff = min(EMAIL_WORKER_MAX_BACKOFF, backoff * 2)

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=backoff)

        except asyncio.TimeoutError:
            pass



@asynccontextmanager

async def lifespan(_app: FastAPI):
    # The mongo_lifespan context manager handles connection + indexes
    async with mongo_lifespan(_app):
        # ADMIN_USER / ADMIN_PASSWORD from the Render environment group are the
        # root account's credentials. A failure here must not take the API down.
        try:
            await ensure_root_admin()
        except Exception:
            logger.exception("[root-admin] Falha ao sincronizar a conta raiz com o ambiente.")

        hub.start()

        email_stop = asyncio.Event()

        email_task = asyncio.create_task(_email_queue_worker(email_stop), name="email-queue-worker")

        try:
            yield

        finally:
            email_stop.set()

            try:
                await asyncio.wait_for(email_task, timeout=5.0)

            except (asyncio.TimeoutError, Exception):
                email_task.cancel()

                try:
                    await email_task

                except asyncio.CancelledError:
                    pass

            await hub.stop()


app = FastAPI(title="Gestão Esportiva Escolar", version="1.0.0", lifespan=lifespan)


register_error_handlers(app)


register_middlewares(app)


origins = [origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]


app.add_middleware(

    CORSMiddleware,

    allow_origins=origins,

    allow_credentials=True,

    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],

    allow_headers=["Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-Impersonate-Role", "X-Impersonate-Target"],

    # Token CSRF rotacionado (ver lib/errors.py): o front cross-origin só o lê se exposto.
    expose_headers=["X-CSRF-Token"],


)



@app.middleware("http")

async def security_headers(request, call_next):
    role = request.headers.get("X-Impersonate-Role")
    target = request.headers.get("X-Impersonate-Target")
    if (role is not None or target is not None) and (
        not role or not target or request.method != "GET" or not allowed_view_path(request.url.path, role)
    ):
        return JSONResponse({"detail": "Visualização permitida apenas para consultas da área selecionada"}, status_code=403)
    response = await call_next(request)

    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"

    response.headers["X-Content-Type-Options"] = "nosniff"

    response.headers["X-Frame-Options"] = "DENY"

    response.headers["X-XSS-Protection"] = "1; mode=block"

    response.headers["Cache-Control"] = "no-store"

    response.headers["Pragma"] = "no-cache"

    return response


app.include_router(auth_router)


app.include_router(children_router)


app.include_router(student_router)


app.include_router(professor_router)


app.include_router(admin_router)


app.include_router(teacher_portal_router)


app.include_router(treinamentos_torneios_router)


app.include_router(class_enrollment_router)


app.include_router(teacher_invites_admin_router)


app.include_router(teacher_invites_public_router)



@app.get("/api/health")

async def health():
    return {"ok": True, "realtime": hub.mode, "realtime_reason": hub.disable_reason}



async def _authorize_realtime(actor: User, audience: str, aluno_id: str | None) -> str:
    """Return the hub channel an actor may subscribe to, or raise HTTPException."""
    if audience == "admin":
        if actor.tipo != "admin" or not actor.is_root_admin:
            raise HTTPException(status_code=403, detail="Acesso restrito ao administrador raiz")

        return "admins"

    if audience == "teacher":
        if actor.tipo != "professor":
            raise HTTPException(status_code=403, detail="Acesso restrito a professores aprovados")

        return f"user:{actor.id}"

    if audience == "student" and aluno_id:
        await get_authorized_aluno(actor, aluno_id)

        return f"student:{aluno_id}"

    raise HTTPException(status_code=400, detail="Inscrição em tempo real inválida")



@app.websocket("/api/realtime")

async def realtime(websocket: WebSocket, audience: str = "student", aluno_id: str | None = None):
    if not allowed_websocket_origin(websocket.headers.get("origin")):
        await websocket.close(code=1008, reason="Origem não autorizada")

        return

    token = websocket.cookies.get("gesp_session")

    if not token:
        await websocket.close(code=4401, reason="Sessão necessária")

        return

    channel = ""

    try:
        claims = decode_token(token)

        if await is_token_revoked(claims):
            await websocket.close(code=4401, reason="Sessao revogada")

            return

        actor_doc = await db.users.find_one({"id": claims.get("sub")}, {"_id": 0})

        if not actor_doc or actor_doc.get("status") != "ativo" or actor_doc.get("tipo") != claims.get("tipo"):
            await websocket.close(code=4401, reason="Sessão inválida")

            return

        actor = User.model_validate(actor_doc)

        channel = await _authorize_realtime(actor, audience, aluno_id)

    except HTTPException as exc:
        await websocket.close(code=4403 if exc.status_code == 403 else 4400, reason=str(exc.detail))

        return

    except Exception:
        await websocket.close(code=4403, reason="Acesso não autorizado")

        return

    await websocket.accept()

    await hub.add(channel, websocket)

    if hub.change_stream_available:
        message = "Mudanças da nuvem serão sincronizadas por MongoDB Change Streams"

    else:
        reason = hub.disable_reason
        message = "Atualizações locais deste servidor; sincronização entre instâncias requer MongoDB replica set"
        if reason:
            message = f"{message} ({reason})"

    await websocket.send_json({"type": "connection", "status": hub.mode, "message": message})

    try:
        while True:
            data = await websocket.receive_json()

            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass

    finally:
        await hub.remove(channel, websocket)
