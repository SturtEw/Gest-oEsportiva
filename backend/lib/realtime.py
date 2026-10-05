"""Authorized change-stream invalidations; never send Mongo documents over sockets."""


import asyncio
import logging
import os
from collections import defaultdict
from typing import Any


from fastapi import WebSocket
from pymongo.errors import PyMongoError
from pymongo.read_concern import ReadConcern


from lib.dates import now_utc
from lib.db import db


logger = logging.getLogger(__name__)


def _is_standalone(exc: Exception) -> bool:
    """True when the failure is the server refusing $changeStream for topology reasons.

    A standalone mongod has no oplog, so change streams are impossible. That is a
    legitimate dev configuration: the hub degrades to the single-process fallback and
    keeps working, so there is nothing to retry and nothing for the operator to fix
    beyond the log line.
    """
    message = str(exc).lower()
    code = getattr(exc, "code", None)
    markers = (
        "only supported on replica sets",
        "$change_stream is only supported",
        "the $changestream stage is only supported",
        "does not support readconcern",
    )
    if code in (40573, 40615):  # ChangeStreamFatalError / NotImplemented
        return True
    return any(marker in message for marker in markers)


def _describe_change_stream_failure(exc: Exception) -> str:
    """Short human-readable reason, surfaced to the frontend on the websocket."""
    if _is_standalone(exc):
        return "MongoDB standalone (replica set ausente) - usando realtime local"
    code = getattr(exc, "code", None)
    return f"code {code}: {exc}" if code else str(exc)


class RealtimeHub:
    def __init__(self) -> None:
        self.connections: dict[str, set[WebSocket]] = defaultdict(set)

        self._lock = asyncio.Lock()

        self._watch_task: asyncio.Task | None = None

        self.change_stream_available = False

        self._disable_reason: str | None = None

        self._stopping = False


    @property
    def mode(self) -> str:
        return "live" if self.change_stream_available else "single_worker"

    @property
    def disable_reason(self) -> str | None:
        """Why the change stream is off, or None when it is live."""
        return None if self.change_stream_available else self._disable_reason


    def start(self) -> None:
        self._stopping = False

        if not self._watch_task or self._watch_task.done():
            self._watch_task = asyncio.create_task(
                self._watch_database(), name="student-change-stream"
            )
            # Prevent "Task exception was never retrieved" warnings when the
            # change stream fails on standalone MongoDB. The task handles its
            # own errors internally and exits cleanly when _is_terminal returns True.
            self._watch_task.add_done_callback(self._on_watch_task_done)

    def _on_watch_task_done(self, task: asyncio.Task) -> None:
        """Consume task exception to prevent unhandled exception warnings."""
        # Use exception() instead of result() to avoid re-raising
        # If the task was cancelled, exception() returns CancelledError
        exc = task.exception()
        if exc is None or isinstance(exc, asyncio.CancelledError):
            return  # Normal completion or expected cancellation
        # Task failed but we already logged it internally; just consume the exception
        # to prevent Python's default task exception handler from logging it.


    async def stop(self) -> None:
        self._stopping = True

        if self._watch_task:
            self._watch_task.cancel()

            try:
                await self._watch_task

            except asyncio.CancelledError:
                pass

        async with self._lock:
            sockets = [socket for group in self.connections.values() for socket in group]

            self.connections.clear()

        for socket in sockets:
            try:
                await socket.close(code=1001)

            except Exception:
                pass


    async def add(self, channel: str, websocket: WebSocket) -> None:
        async with self._lock:
            self.connections[channel].add(websocket)


    async def remove(self, channel: str, websocket: WebSocket) -> None:
        async with self._lock:
            group = self.connections.get(channel)

            if group:
                group.discard(websocket)

                if not group:
                    self.connections.pop(channel, None)


    async def _send_to(self, channel: str, payload: dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self.connections.get(channel, set()))

        failed = []

        for socket in sockets:
            try:
                await socket.send_json(payload)

            except Exception:
                failed.append(socket)

        for socket in failed:
            await self.remove(channel, socket)


    async def _invalidate(self, channel: str, section: str) -> None:
        await self._send_to(channel, {

            "type": "invalidate",

            "section": section,

            "updatedAt": now_utc().isoformat(),

            "mode": self.mode,

        })


    async def publish(self, aluno_id: str, section: str) -> None:
        if not self.change_stream_available:
            await self._invalidate(f"student:{aluno_id}", section)


    async def publish_admin(self, section: str) -> None:
        if not self.change_stream_available:
            await self._invalidate("admins", section)


    async def publish_user(self, user_id: str, section: str) -> None:
        if not self.change_stream_available:
            await self._invalidate(f"user:{user_id}", section)


    async def publish_class(self, turma_id: str, section: str) -> None:
        if not self.change_stream_available:
            await self._publish_class(turma_id, section)


    async def _publish_class(self, turma_id: str, section: str) -> None:
        if not turma_id:
            return

        async for student in db.alunos.find({"turma_id": turma_id}, {"_id": 0, "id": 1}):
            await self._invalidate(f"student:{student['id']}", section)


    async def _publish_opted_in_class(self, turma_id: str) -> None:
        async for student in db.alunos.find(

            {"turma_id": turma_id, "participa_ranking": True}, {"_id": 0, "id": 1}

        ):
            await self._invalidate(f"student:{student['id']}", "ranking")


    async def _dispatch_change(self, event: dict[str, Any]) -> None:
        collection = (event.get("ns") or {}).get("coll")

        document = event.get("fullDocument") or event.get("fullDocumentBeforeChange") or {}

        if not collection:
            return

        direct = {

            "avaliacoes": "assessments",

            "badges": "achievements",

            "conquistas": "achievements",

            "ocorrencias": "records",

            "justificativas": "records",

            "duvidas": "questions",

        }

        if collection in direct:
            student_id = document.get("aluno_id")

            if student_id:
                await self._invalidate(f"student:{student_id}", direct[collection])

        elif collection == "chamadas":
            await self._publish_class(document.get("turma_id", ""), "attendance")

        elif collection == "comunicados" and document.get("status") == "enviado":
            await self._publish_class(document.get("turma_id", ""), "announcements")

        elif collection == "alunos":
            student_id = document.get("id")

            if student_id:
                await self._invalidate(f"student:{student_id}", "portal")

            if document.get("turma_id") and "participa_ranking" in document:
                await self._publish_opted_in_class(document["turma_id"])

        elif collection == "users":
            if document.get("tipo") == "professor" and document.get("status") == "pendente":
                await self._invalidate("admins", "teacher_applications")

            if document.get("tipo") == "professor" and document.get("id"):
                await self._invalidate(f"user:{document['id']}", "account_status")

        elif collection == "admin_notifications":
            await self._invalidate("admins", "teacher_applications")

        elif collection == "solicitacoes_turma":
            # Join requests concern both sides: the class teacher's queue and the
            # student's status card.
            if document.get("professor_id"):
                await self._invalidate(f"user:{document['professor_id']}", "enrollment")

            if document.get("aluno_id"):
                await self._invalidate(f"student:{document['aluno_id']}", "enrollment")

        elif collection == "turma_convites" and document.get("professor_id"):
            await self._invalidate(f"user:{document['professor_id']}", "enrollment")

        elif collection == "atividades":
            # Class activities: the class students' list and the teacher's panel.
            await self._publish_class(document.get("turma_id", ""), "activities")

            if document.get("professor_id"):
                await self._invalidate(f"user:{document['professor_id']}", "activities")


    async def _watch_database(self) -> None:
        """Watch for database changes with robust error handling for standalone MongoDB."""
        delay = 1

        # Change streams require readConcern "majority" and a replica set / mongos.
        #
        # The client-wide default was "local", which the server rejects for $changeStream
        # with code 72 (InvalidOptions), so every watch() failed and the hub silently
        # dropped to the single-process fallback. Database.watch() has no read_concern
        # argument, so the concern is attached with with_options() on a derived handle;
        # every other read keeps the cheaper "local" concern.
        watched = db.with_options(read_concern=ReadConcern("majority"))

        try:
            while not self._stopping:
                try:
                    async with await watched.watch(
                        full_document="updateLookup",
                        full_document_before_change="whenAvailable",
                    ) as stream:
                        self.change_stream_available = True

                        delay = 1

                        logger.info("MongoDB Change Stream active for portal invalidations")

                        async for event in stream:
                            await self._dispatch_change(event)

                            if self._stopping:
                                break

                except asyncio.CancelledError:
                    raise

                except (PyMongoError, OSError, RuntimeError, TypeError) as exc:
                    self.change_stream_available = False
                    self._disable_reason = _describe_change_stream_failure(exc)

                    # Standalone Mongo is a supported dev setup: the hub keeps working
                    # through the single-process fallback, so this is information, not a
                    # warning that needs action.
                    log = logger.info if _is_standalone(exc) else logger.warning
                    log("Change Stream unavailable; single-process realtime fallback: %s", exc)

                    await asyncio.sleep(delay)
                    delay = min(delay * 2, 30)

                    if self._is_terminal(exc):
                        return

                except Exception:
                    # Catch any other exception to prevent task crash
                    self.change_stream_available = False
                    self._disable_reason = "erro inesperado"
                    logger.info("Unexpected Change Stream error; using single-process fallback", exc_info=True)
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, 30)
                    # Check if we should stop retrying
                    if _is_standalone(Exception("fallback")):
                        return
        except asyncio.CancelledError:
            raise
        except Exception:
            # Absolute last resort - never let the task crash and propagate
            logger.info("Change stream watcher terminated unexpectedly", exc_info=True)

    def _is_terminal(self, exc: Exception) -> bool:
        """Stop retrying when retrying cannot possibly help (standalone topology)."""
        return _is_standalone(exc)


hub = RealtimeHub()


async def publish_event(aluno_id: str, section: str) -> None:
    await hub.publish(aluno_id, section)


async def publish_admin_event(section: str) -> None:
    await hub.publish_admin(section)


async def publish_user_event(user_id: str, section: str) -> None:
    await hub.publish_user(user_id, section)


async def publish_class_event(turma_id: str, section: str) -> None:
    """Invalidate `section` for every student of the class."""
    await hub.publish_class(turma_id, section)


def allowed_websocket_origin(origin: str | None) -> bool:
    if not origin:
        return False

    configured = os.getenv("FRONTEND_ORIGINS", "")

    allowed = {value.strip().rstrip("/") for value in configured.split(",") if value.strip()} if configured else {"http://localhost:5173", "http://127.0.0.1:5173"}

    return origin.rstrip("/") in allowed
