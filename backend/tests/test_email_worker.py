"""Tests for the background email queue worker in server.py.

These use hand-rolled fakes for the Mongo collection and the email provider so
the suite runs without a live mongod or SMTP relay.

"""

import asyncio
from datetime import datetime, timezone


import pytest


import server
from server import (

    EMAIL_WORKER_MAX_BACKOFF,
    EMAIL_WORKER_SLEEP_SECS,

    _email_queue_worker,

    _email_worker_once,


)


pytestmark = pytest.mark.asyncio



class FakeCursor:
    """Stands in for an AsyncMongoClient cursor over a list of docs."""

    def __init__(self, docs):
        self._docs = docs

        self._iter = None


    def sort(self, *_args, **_kwargs):
        return self


    def limit(self, _n):
        return self


    async def to_list(self, length=None):
        return self._docs[:length] if length else list(self._docs)


    def __aiter__(self):
        """server.py consumes the cursor with `async for`, as AsyncMongoClient allows."""
        return self

    async def __anext__(self):
        if not self._iter:
            self._iter = iter(self._docs)

        try:
            return next(self._iter)

        except StopIteration:
            raise StopAsyncIteration



class FakeCollection:
    def __init__(self, docs=()):
        self.docs = list(docs)

        self.updates = []


    def find(self, _query=None, _projection=None):
        return FakeCursor(self.docs)


    def sort(self, *_args, **_kwargs):
        return self


    def limit(self, _n):
        return self


    async def update_one(self, filt, update):
        self.updates.append((filt, update))

        return None



class FakeDB:
    def __init__(self, docs=()):
        self.email_queue = FakeCollection(docs)



@pytest.fixture

def queue(monkeypatch):
    """Install a fake db and provider; yields the FakeDB under test."""
    fake = FakeDB()
    monkeypatch.setattr(server, "db", fake)

    return fake



async def test_marks_document_sent_and_counts_it(queue, monkeypatch):
    queue.email_queue.docs = [{"_id": "q1", "to": "a@b.c", "template": "generic", "data": {}}]

    monkeypatch.setattr(server, "send_email", _fake_sender("prov-1"))

    sent = await _email_worker_once()

    assert sent == 1

    filt, update = queue.email_queue.updates[0]

    assert filt == {"_id": "q1"}

    assert update["$set"]["status"] == "sent"

    assert update["$set"]["provider_id"] == "prov-1"

    assert "sent_at" in update["$set"]



async def test_matches_on_id_when_id_field_present(queue, monkeypatch):
    """Documents carrying 'id' instead of '_id' must still be updatable."""
    queue.email_queue.docs = [{"id": "q7", "to": "a@b.c", "template": "generic", "data": {}}]
    monkeypatch.setattr(server, "send_email", _fake_sender())

    sent = await _email_worker_once()

    assert sent == 1

    filt, _update = queue.email_queue.updates[0]

    assert filt == {"id": "q7"}



async def test_send_failure_marks_failed_with_exponential_backoff(queue, monkeypatch):
    queue.email_queue.docs = [{"_id": "q2", "to": "a@b.c", "template": "generic", "data": {}, "retry_count": 0}]


    async def boom(**_kwargs):
        raise RuntimeError("smtp down")

    monkeypatch.setattr(server, "send_email", boom)

    sent = await _email_worker_once()

    assert sent == 0

    _filt, update = queue.email_queue.updates[0]

    assert update["$set"]["status"] == "failed"

    assert update["$set"]["retry_count"] == 1

    # First retry: base delay of 15s after now.
    next_retry = datetime.fromisoformat(update["$set"]["next_retry_at"])

    assert 10 <= (next_retry - datetime.now(timezone.utc)).total_seconds() <= 20



async def test_backoff_doubles_and_is_capped(queue, monkeypatch):
    """A document deep into retries gets exponential delay, capped at the max."""

    async def boom(**_kwargs):
        raise RuntimeError("smtp down")

    monkeypatch.setattr(server, "send_email", boom)

    queue.email_queue.docs = [{"_id": "q3", "to": "a@b.c", "template": "generic", "data": {}, "retry_count": 20}]

    await _email_worker_once()

    next_retry = datetime.fromisoformat(queue.email_queue.updates[-1][1]["$set"]["next_retry_at"])

    # 15 * 2^19 is far beyond the cap, so the cap must apply.
    assert 295 <= (next_retry - datetime.now(timezone.utc)).total_seconds() <= EMAIL_WORKER_MAX_BACKOFF



async def test_skips_document_without_any_identifier(queue, monkeypatch):
    """The regression: a doc with neither id nor _id must not be processed."""
    queue.email_queue.docs = [{"to": "a@b.c", "template": "generic", "data": {}}]
    calls = []

    monkeypatch.setattr(server, "send_email", _fake_sender(calls))

    sent = await _email_worker_once()

    assert sent == 0

    assert calls == []

    assert queue.email_queue.updates == []



async def test_continues_after_unprocessable_document(queue, monkeypatch):
    """One bad document must not prevent later ones in the same batch."""
    queue.email_queue.docs = [
        {"to": "a@b.c", "template": "generic", "data": {}},

        {"_id": "q4", "to": "d@e.f", "template": "generic", "data": {}},

    ]

    monkeypatch.setattr(server, "send_email", _fake_sender())

    sent = await _email_worker_once()

    assert sent == 1

    assert queue.email_queue.updates[0][0] == {"_id": "q4"}



async def test_worker_loop_stops_when_event_set(monkeypatch):
    """The loop must exit promptly when the stop event is set."""
    stop = asyncio.Event()
    calls = []


    async def once():
        calls.append(1)

        return 0

    monkeypatch.setattr(server, "_email_worker_once", once)


    async def stopper():
        await asyncio.sleep(0.05)

        stop.set()

    await asyncio.wait_for(

        asyncio.gather(_email_queue_worker(stop), stopper()),

        timeout=5,

    )

    assert len(calls) >= 1



async def test_worker_loop_backs_off_on_exception(monkeypatch):
    """An exception in the loop grows the sleep interval beyond the base."""
    stop = asyncio.Event()
    timeouts = []

    real_wait_for = asyncio.wait_for


    async def boom():
        raise RuntimeError("db down")


    async def spy_wait_for(awaitable, *, timeout):
        timeouts.append(timeout)

        if len(timeouts) >= 3:
            stop.set()

            return await real_wait_for(awaitable, timeout=0.01)

        await real_wait_for(awaitable, timeout=0.01)

        raise asyncio.TimeoutError

    monkeypatch.setattr(server, "_email_worker_once", boom)

    monkeypatch.setattr(asyncio, "wait_for", spy_wait_for)

    await real_wait_for(_email_queue_worker(stop), timeout=5)

    # boom() fails on every iteration, so the very first sleep is already one
    # backoff step above the base interval.
    assert timeouts[0] == EMAIL_WORKER_SLEEP_SECS * 2

    assert timeouts[1] > timeouts[0]



async def test_worker_uses_short_interval_after_progress(monkeypatch):
    """After successfully sending, the loop shortens its next sleep."""
    stop = asyncio.Event()
    timeouts = []

    real_wait_for = asyncio.wait_for


    async def once():
        return 5  # pretend we sent something


    async def spy_wait_for(awaitable, *, timeout):
        timeouts.append(timeout)

        stop.set()

        return await real_wait_for(awaitable, timeout=0.01)

    monkeypatch.setattr(server, "_email_worker_once", once)

    monkeypatch.setattr(asyncio, "wait_for", spy_wait_for)

    await real_wait_for(_email_queue_worker(stop), timeout=5)

    assert timeouts[0] == max(5, EMAIL_WORKER_SLEEP_SECS // 2)



def _fake_sender(provider_id="fake-id", calls=None):
    async def send(*, to, subject, html):
        if calls is not None:
            calls.append(to)

        return provider_id

    return send
