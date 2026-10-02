"""MongoDB connection manager with PyMongo Async, Secret Manager, and resilience patterns.

Provides a singleton AsyncMongoClient with connection pooling, automatic retry for
transient failures, structured logging for Cloud Logging, and secure credential

retrieval via Google Secret Manager.

"""

from __future__ import annotations


import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import timezone
from functools import wraps
from typing import Any, Callable, TypeVar


from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.asynchronous.mongo_client import AsyncMongoClient
from pymongo.errors import (

    ConnectionFailure,
    OperationFailure,

    PyMongoError,

    ServerSelectionTimeoutError,


)


# ─── Structured logging for Google Cloud Logging ──────────────────────────────
# Cloud Logging detects JSON on stdout; we emit JSON for severity + trace correlation.
# Both the library AND the credentials are optional. The library being installed does
# not mean the process can authenticate to GCP: locally there is no Application
# Default Credentials, and Client() resolves the project via google.auth.default(),
# which raises DefaultCredentialsError. A missing library and missing credentials are
# the same situation for this module's purposes — no Cloud Logging — so both degrade to
# the local stdout handler instead of breaking the whole app at import time.
try:
    import google.cloud.logging  # type: ignore

    _HAS_CLOUD_LOGGING = True
except Exception:  # pragma: no cover - optional in local dev
    _HAS_CLOUD_LOGGING = False


logger = logging.getLogger(__name__)


if _HAS_CLOUD_LOGGING and not logger.handlers:
    # Only attempt Cloud Logging if we have credentials or are on GCP
    # Check common indicators of GCP environment
    has_adc = bool(os.getenv("GOOGLE_APPLICATION_CREDENTIALS"))
    on_gcp = bool(os.getenv("K_SERVICE") or os.getenv("GAE_SERVICE") or os.getenv("GCP_PROJECT"))

    if has_adc or on_gcp:
        try:
            client = google.cloud.logging.Client()
            client.setup_logging(log_level=logging.INFO)
        except Exception as exc:  # pragma: no cover
            _HAS_CLOUD_LOGGING = False
            sys.stderr.write(
                f'[db] Cloud Logging indisponivel ({type(exc).__name__}); usando log local em stdout.\n'
            )
    else:
        _HAS_CLOUD_LOGGING = False
        sys.stderr.write('[db] Cloud Logging desativado (sem credenciais GCP); usando log local em stdout.\n')

if not _HAS_CLOUD_LOGGING and not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)

    handler.setFormatter(

        logging.Formatter(

            '{"timestamp": "%(asctime)s", "severity": "%(levelname)s", '

            '"logger": "%(name)s", "message": "%(message)s"}'

        )
    )

    logger.addHandler(handler)

    logger.setLevel(os.getenv("LOG_LEVEL", "INFO"))


# ─── Secret Manager integration ───────────────────────────────────────────────
_SECRET_CACHE: dict[str, str] = {}



async def get_secret(secret_id: str, version: str = "latest") -> str:
    """Fetch a secret from Google Secret Manager with in-process caching.

    Args:
        secret_id: Secret ID (e.g., "mongo-connection-string" or "jwt-secret").

        version: Secret version ("latest" or numeric version string).


    Returns:
        The secret payload as a decoded string.


    Raises:
        RuntimeError: If Secret Manager is unavailable or secret not found.

    """
    if secret_id in _SECRET_CACHE:
        return _SECRET_CACHE[secret_id]

    project_id = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCP_PROJECT")

    if not project_id:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT not set; cannot fetch secrets")

    try:
        from google.cloud import secretmanager  # type: ignore
    except Exception as exc:  # pragma: no cover - optional in local dev
        raise RuntimeError("google-cloud-secret-manager not installed") from exc

    # Building the client authenticates against GCP. Locally there are no Application
    # Default Credentials, and this raises before the access_secret_version try-block
    # below — surfacing as a confusing startup crash rather than a clean fallback to
    # the MONGO_URL env var. Callers already fall back on any RuntimeError, so report
    # it as one instead.
    try:
        client = secretmanager.SecretManagerServiceClient()
    except Exception as exc:
        raise RuntimeError(f"Secret Manager indisponivel: {type(exc).__name__}: {exc}") from exc

    name = f"projects/{project_id}/secrets/{secret_id}/versions/{version}"

    try:
        response = client.access_secret_version(request={"name": name})

        payload = response.payload.data.decode("UTF-8")

    except Exception as exc:
        logger.error(

            '{"event": "secret_fetch_failed", "secret_id": "%s", "error": "%s"}',

            secret_id,

            exc,

        )

        raise RuntimeError(f"Failed to fetch secret {secret_id}") from exc

    _SECRET_CACHE[secret_id] = payload

    logger.info('{"event": "secret_fetched", "secret_id": "%s"}', secret_id)

    return payload



def clear_secret_cache() -> None:
    """Clear the in-process secret cache (useful for rotation)."""
    _SECRET_CACHE.clear()


# ─── Connection string resolution ─────────────────────────────────────────────
async def resolve_mongo_uri() -> str:
    """Resolve MongoDB URI from Secret Manager, then env var, then local default."""
    # 1) Secret Manager (production on Cloud Run / Cloud Functions / GKE)
    secret_id = os.getenv("MONGO_URI_SECRET_ID")
    if secret_id:
        try:
            return await get_secret(secret_id)

        except Exception:
            logger.warning(

                '{"event": "secret_manager_fallback", "secret_id": "%s"}', secret_id

            )

    # 2) Environment variable (local dev / CI)
    env_uri = os.getenv("MONGO_URL")

    if env_uri:
        return env_uri

    # 3) Local default (dev only)
    return "mongodb://localhost:27017"



async def resolve_db_name() -> str:
    """Resolve database name from Secret Manager, then env var, then default."""
    secret_id = os.getenv("MONGO_DB_NAME_SECRET_ID")
    if secret_id:
        try:
            return await get_secret(secret_id)

        except Exception:
            logger.warning(

                '{"event": "db_name_secret_manager_fallback", "secret_id": "%s"}', secret_id

            )

    return os.getenv("DB_NAME", "gestao_esportiva_escolar")


# ─── Retry decorator for transient failures ───────────────────────────────────
TRANSIENT_ERRORS = (

    ConnectionFailure,

    ServerSelectionTimeoutError,

    OperationFailure,  # some OperationFailure are transient (e.g., not master)


)


T = TypeVar("T")



def with_retry(

    *,

    max_attempts: int = 3,

    base_delay: float = 0.1,

    max_delay: float = 2.0,

    exponential_base: float = 2.0,

    jitter: float = 0.1,

    retry_on: tuple[type[Exception], ...] = TRANSIENT_ERRORS,


) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Async retry decorator with exponential backoff and jitter.

    Args:
        max_attempts: Maximum number of attempts (including the first).

        base_delay: Initial delay in seconds.

        max_delay: Cap for delay in seconds.

        exponential_base: Multiplier for each retry.

        jitter: Random jitter factor (0-1) to avoid thundering herd.

        retry_on: Exception types that trigger a retry.

    """
    import asyncio
    import random

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)

        async def wrapper(*args: Any, **kwargs: Any) -> T:
            attempt = 0

            delay = base_delay

            last_exc: Exception | None = None

            while attempt < max_attempts:
                try:
                    return await func(*args, **kwargs)

                except retry_on as exc:
                    last_exc = exc

                    attempt += 1

                    if attempt >= max_attempts:
                        logger.error(

                            '{"event": "retry_exhausted", "function": "%s", '

                            '"attempts": %d, "error": "%s"}',

                            func.__name__,

                            attempt,

                            exc,

                        )

                        raise

                    logger.warning(

                        '{"event": "retry_attempt", "function": "%s", '

                        '"attempt": %d, "max_attempts": %d, "delay": %.3f, "error": "%s"}',

                        func.__name__,

                        attempt,

                        max_attempts,

                        delay,

                        exc,

                    )

                    await asyncio.sleep(delay * (1 + random.uniform(-jitter, jitter)))

                    delay = min(delay * exponential_base, max_delay)

            raise last_exc  # pragma: no cover - logic guarantees raise above

        return wrapper

    return decorator


# ─── Connection manager ───────────────────────────────────────────────────────
class MongoManager:
    """Manages the lifecycle of a single AsyncMongoClient with pooling.

    Usage:
        manager = MongoManager()

        await manager.connect()

        db = manager.db

        # ... use db ...
        await manager.close()

    """

    _instance: MongoManager | None = None

    def __init__(

        self,

        *,

        max_pool_size: int = 100,

        min_pool_size: int = 10,

        max_idle_time_ms: int = 30000,

        connect_timeout_ms: int = 10000,

        server_selection_timeout_ms: int = 10000,

        socket_timeout_ms: int = 30000,

        retry_writes: bool = True,

    ) -> None:
        self._client: AsyncMongoClient | None = None

        self._db: AsyncDatabase | None = None

        self._db_name: str | None = None

        self._config = {

            "maxPoolSize": max_pool_size,

            "minPoolSize": min_pool_size,

            "maxIdleTimeMS": max_idle_time_ms,

            "connectTimeoutMS": connect_timeout_ms,

            "serverSelectionTimeoutMS": server_selection_timeout_ms,

            "socketTimeoutMS": socket_timeout_ms,

            "retryWrites": retry_writes,

            "readPreference": "primary",

            # BSON dates are UTC. Ask for aware datetimes explicitly — otherwise the
            # driver hands back naive values, .isoformat() drops the offset, and the
            # browser reinterprets them as local time (timestamps shift by APP_TZ).
            "tz_aware": True,

            "tzinfo": timezone.utc,

        }


    @classmethod

    def get_instance(cls) -> MongoManager:
        if cls._instance is None:
            cls._instance = cls()

        return cls._instance


    @classmethod

    def reset_instance(cls) -> None:
        cls._instance = None


    @property

    def client(self) -> AsyncMongoClient:
        if self._client is None:
            raise RuntimeError("MongoManager not connected. Call connect() first.")

        return self._client


    @property

    def db(self) -> AsyncDatabase:
        if self._db is None:
            raise RuntimeError("MongoManager not connected. Call connect() first.")

        return self._db


    @with_retry(max_attempts=3, base_delay=0.2)

    async def connect(self) -> None:
        """Create the AsyncMongoClient and verify connectivity."""
        if self._client is not None:
            logger.warning('{"event": "already_connected"}')

            return

        uri = await resolve_mongo_uri()

        self._db_name = await resolve_db_name()

        logger.info(

            '{"event": "mongo_connecting", "db": "%s", "pool_max": %d}',

            self._db_name,

            self._config["maxPoolSize"],

        )

        self._client = AsyncMongoClient(uri, **self._config)

        self._db = self._client[self._db_name]

        # Verify connection with a lightweight command
        await self._client.admin.command("ping")

        logger.info('{"event": "mongo_connected", "db": "%s"}', self._db_name)


    async def close(self) -> None:
        """Close the client and release all pooled connections."""
        if self._client is None:
            return

        await self._client.close()

        logger.info('{"event": "mongo_disconnected", "db": "%s"}', self._db_name)

        self._client = None

        self._db = None

        self._db_name = None


    @asynccontextmanager

    async def session(self):
        """Context manager for a causal-consistent client session."""
        async with self.client.start_session() as session:
            yield session


    @asynccontextmanager

    async def transaction(self, session=None):
        """Context manager for a transaction.

        If `session` is provided, uses that session; otherwise creates a new one.
        """
        if session is None:
            async with self.client.start_session() as s:
                async with await s.start_transaction() as txn:
                    yield txn

        else:
            async with await session.start_transaction() as txn:
                yield txn


# ─── Index definitions (identical to original, kept for compatibility) ───────
INDEXES: dict[str, list[IndexModel]] = {

    "status_checks": [IndexModel([("timestamp", DESCENDING)], name="timestamp_desc")],

    "users": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("email", ASCENDING)], name="email", unique=True),

        IndexModel([("cpf", ASCENDING)], name="cpf", unique=True, sparse=True),

        IndexModel(

            [("google_sub", ASCENDING)],

            name="google_sub",

            unique=True,

            partialFilterExpression={"google_sub": {"$type": "string"}},

        ),

        IndexModel(

            [("documento_hash", ASCENDING)],

            name="documento_hash",

            unique=True,

            partialFilterExpression={"documento_hash": {"$type": "string"}},

        ),

        IndexModel([("tipo", ASCENDING), ("status", ASCENDING)], name="tipo_status"),

    ],

    "turmas": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("professor_id", ASCENDING)], name="professor"),

    ],

    "alunos": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("turma_id", ASCENDING)], name="turma"),

        IndexModel([("responsavel_id", ASCENDING)], name="responsavel"),

        IndexModel(

            [("turma_id", ASCENDING), ("participa_ranking", ASCENDING)],

            name="turma_ranking_opt_in",

        ),

    ],

    "avaliacoes": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("aluno_id", ASCENDING), ("bimestre", ASCENDING)], name="aluno_bimestre", unique=True),

        IndexModel([("turma_id", ASCENDING)], name="turma"),

    ],

    "badges": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("aluno_id", ASCENDING), ("badge_id", ASCENDING)], name="aluno_badge", unique=True),

    ],

    "conquistas": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("aluno_id", ASCENDING), ("dataObtencao", DESCENDING)], name="aluno_data"),

        IndexModel([("turma_id", ASCENDING), ("aluno_id", ASCENDING)], name="turma_aluno"),

    ],

    "duvidas": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("aluno_id", ASCENDING), ("dataEnvio", DESCENDING)], name="aluno_data"),

        IndexModel([("professor_id", ASCENDING), ("dataEnvio", DESCENDING)], name="professor_data"),

    ],

    "admin_notifications": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("tipo", ASCENDING), ("status", ASCENDING), ("dataCriacao", DESCENDING)], name="admin_status_date"),

    ],

    "revoked_jti": [

        IndexModel([("jti", ASCENDING)], name="jti", unique=True),

        IndexModel([("revoked_at", ASCENDING)], name="revoked_at", expireAfterSeconds=0),

    ],

    "chamadas": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("turma_id", ASCENDING), ("data_aula", ASCENDING)], name="turma_data", unique=True),

    ],

    "agenda_aulas": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        # One scheduled session per class per day: the same guarantee the chamadas
        # index enforces, so "aulas de hoje" can never double-count a class.
        IndexModel([("turma_id", ASCENDING), ("data_aula", ASCENDING)], name="turma_data", unique=True),

        # Serves the teacher agenda query (turma_id IN [...] AND ativo AND date range).
        IndexModel([("turma_id", ASCENDING), ("ativo", ASCENDING), ("data_aula", ASCENDING)], name="turma_ativo_data"),

    ],

    "ocorrencias": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("aluno_id", ASCENDING), ("dataOcorrencia", DESCENDING)], name="aluno_data"),

        IndexModel([("turma_id", ASCENDING)], name="turma"),

    ],

    "justificativas": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("aluno_id", ASCENDING), ("data_falta", ASCENDING)], name="aluno_data"),

        IndexModel([("turma_id", ASCENDING), ("status", ASCENDING)], name="turma_status"),

    ],

    "fila_espera": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("turma_id", ASCENDING), ("status", ASCENDING)], name="turma_status"),

    ],

    "turma_convites": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        # Each invite code is unique across the whole school, not just per class.
        IndexModel([("codigo", ASCENDING)], name="codigo", unique=True),

        IndexModel([("turma_id", ASCENDING), ("ativo", ASCENDING)], name="turma_ativo"),

    ],

    "solicitacoes_turma": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        # A student keeps at most one pending request; the app checks first, this
        # index closes the race between two concurrent submissions.
        IndexModel(

            [("aluno_id", ASCENDING)],

            name="aluno_pendente_unico",

            unique=True,

            partialFilterExpression={"status": "pendente"},

        ),

        IndexModel([("aluno_id", ASCENDING), ("dataSolicitacao", DESCENDING)], name="aluno_data"),

        IndexModel([("turma_id", ASCENDING), ("status", ASCENDING), ("dataSolicitacao", DESCENDING)], name="turma_status_data"),

    ],

    "comunicados": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("turma_id", ASCENDING), ("dataEnvio", DESCENDING)], name="turma_data"),

    ],

    "ia_conversas": [

        IndexModel([("id", ASCENDING)], name="id", unique=True),

        IndexModel([("user_id", ASCENDING), ("dataCriacao", DESCENDING)], name="user_data"),

    ],

    "rate_limits": [

        # Compound index supports the sliding-window count/delete queries
        # (path, ip, ts) filtered in _allow().
        IndexModel([("path", ASCENDING), ("ip", ASCENDING), ("ts", ASCENDING)], name="path_ip_ts"),

        # TTL index auto-deletes rate-limit documents after their window closes.

        IndexModel([("expires_at", ASCENDING)], name="expires_at", expireAfterSeconds=0),

    ],


}



@with_retry(max_attempts=2, base_delay=0.5)

async def ensure_indexes() -> None:
    """Create all indexes defined in INDEXES. Idempotent and safe to re-run."""
    manager = MongoManager.get_instance()
    db = manager.db

    for collection, models in INDEXES.items():
        try:
            await db[collection].create_indexes(models)

            logger.info('{"event": "indexes_created", "collection": "%s", "count": %d}', collection, len(models))

        except PyMongoError as exc:
            logger.error('{"event": "index_creation_failed", "collection": "%s", "error": "%s"}', collection, exc)

            # Don't raise - indexes are best-effort at startup


# ─── Backward-compatible module-level exports ─────────────────────────────────
# These allow existing `from lib.db import client, db, ensure_indexes` to work.
_manager: MongoManager | None = None



def _get_manager() -> MongoManager:
    global _manager

    if _manager is None:
        _manager = MongoManager.get_instance()

    return _manager


# Expose `client` and `db` as properties that initialize on first access
class _LazyProxy:
    def __getattr__(self, name: str) -> Any:
        return getattr(_get_manager().client, name)


client = _LazyProxy()  # type: ignore



class _DbProxy:
    def __getattr__(self, name: str) -> Any:
        return getattr(_get_manager().db, name)


db = _DbProxy()  # type: ignore


# ─── Lifespan helper for FastAPI ──────────────────────────────────────────────
@asynccontextmanager

async def mongo_lifespan(app: Any):
    """FastAPI lifespan that connects on startup and closes on shutdown."""
    manager = MongoManager.get_instance()
    try:
        await manager.connect()

        await ensure_indexes()

    except Exception as exc:
        logger.critical('{"event": "mongo_startup_failed", "error": "%s"}', exc)

        raise

    try:
        yield

    finally:
        await manager.close()
