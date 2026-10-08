# Regression tests for the audit fixes (C1, C2, C3):
# - C1: stale open sessions are closed with server-computed duration.
# - C2: deleting a class cascades to its subgroups and presence sessions.
# - C3: the partial unique index is asserted (FakeCollection unique) — a second
#   open session for the same student must be impossible.
import pytest
from fastapi import HTTPException

from models.models import User
from routers import admin as admin_router
from routers import subgroups as router
from tests.fake_mongo import FakeClient, FakeCollection, enrollment_db

PROF = User(id="prof-1", nome="Ana Souza", email="ana@escola.com", tipo="professor", status="ativo")
ALUNO = User(id="user-aluno", nome="Aluno Conta", email="aluno@escola.com", tipo="aluno", status="ativo", aluno_id="a-1")


@pytest.fixture
def db(monkeypatch):
    fake = enrollment_db(
        turmas=FakeCollection([{"id": "t-1", "nome": "Judô", "modalidade": "Judô", "ano": 2026, "professor_id": "prof-1"}]),
        alunos=FakeCollection([{"id": "a-1", "nome": "Carlos Alves", "turma_id": "t-1"}]),
        subgrupos=FakeCollection(),
        sessoes_presenca=FakeCollection(unique=[("aluno_id", {"saida": None})]),
        admin_audit=FakeCollection(),
        admin_notifications=FakeCollection(),
        forum_mensagens=FakeCollection(),
        atividades=FakeCollection(),
        comunicados=FakeCollection(),
        agenda_aulas=FakeCollection(),
        chamadas=FakeCollection(),
        solicitacoes_turma=FakeCollection(),
        turma_convites=FakeCollection(),
    )

    async def record(*args):
        pass

    monkeypatch.setattr(router, "db", fake)
    monkeypatch.setattr(admin_router, "db", fake)
    monkeypatch.setattr(admin_router, "client", FakeClient())
    monkeypatch.setattr(router, "publish_class_event", record)
    monkeypatch.setattr(router, "publish_user_event", record)
    return fake


def make_subgroup(sid="sg-1", turma_id="t-1"):
    import asyncio
    from datetime import timedelta
    from lib.dates import now_utc
    from lib.db import db as real_db  # noqa: F401 — not used, FakeCollection is injected
    asyncio.get_event_loop()
    return {"id": sid, "turma_id": turma_id, "nome": "Judô", "descricao": None, "status": "ativo", "criado_em": now_utc(), "atualizado_em": now_utc()}


# ─── C1: stale sessions ──────────────────────────────────────────────────────
async def test_stale_sessions_closed_with_flag_and_duration(db, monkeypatch):
    from datetime import timedelta
    from lib.dates import now_utc
    from routers.subgroups import SESSION_STALE_SECONDS

    old = now_utc() - timedelta(seconds=SESSION_STALE_SECONDS + 60)
    fresh = now_utc() - timedelta(seconds=60)
    db.sessoes_presenca.documents = [
        {"id": "s-old", "aluno_id": "a-1", "subgrupo_id": "sg-1", "turma_id": "t-1", "entrada": old, "saida": None, "tempo_permanencia_segundos": None},
        {"id": "s-fresh", "aluno_id": "a-2", "subgrupo_id": "sg-1", "turma_id": "t-1", "entrada": fresh, "saida": None, "tempo_permanencia_segundos": None},
    ]

    closed = await router.close_stale_sessions()
    assert closed == 1
    old_doc = db.sessoes_presenca.documents[0]
    fresh_doc = db.sessoes_presenca.documents[1]
    # Only the old one was closed, with the ghost flag and a computed duration.
    assert old_doc["saida"] is not None and old_doc.get("auto_encerrada") is True
    assert isinstance(old_doc["tempo_permanencia_segundos"], int) and old_doc["tempo_permanencia_segundos"] > 0
    assert fresh_doc["saida"] is None


# ─── C3: unique partial index (race guard) ───────────────────────────────────
async def test_second_open_session_for_same_student_is_rejected(db):
    from datetime import timedelta
    from lib.dates import now_utc
    from pymongo.errors import DuplicateKeyError

    db.subgrupos.documents = [make_subgroup()]
    db.sessoes_presenca.documents = [
        {"id": "s-1", "aluno_id": "a-1", "subgrupo_id": "sg-1", "turma_id": "t-1", "entrada": now_utc() - timedelta(minutes=5), "saida": None, "tempo_permanencia_segundos": None},
    ]
    with pytest.raises(DuplicateKeyError):
        await db.sessoes_presenca.insert_one({
            "id": "s-2", "aluno_id": "a-1", "subgrupo_id": "sg-1", "turma_id": "t-1",
            "entrada": now_utc(), "saida": None, "tempo_permanencia_segundos": None,
        })


async def test_closed_session_does_not_block_new_checkin(db):
    from datetime import timedelta
    from lib.dates import now_utc

    db.subgrupos.documents = [make_subgroup()]
    db.sessoes_presenca.documents = [
        # The student's earlier session is CLOSED: a new check-in must be allowed.
        {"id": "s-1", "aluno_id": "a-1", "subgrupo_id": "sg-1", "turma_id": "t-1", "entrada": now_utc() - timedelta(hours=2), "saida": now_utc() - timedelta(hours=1), "tempo_permanencia_segundos": 3600},
    ]
    result = await router.checkin("sg-1", user=ALUNO)
    assert result["sessao"]["ativa"] is True


# ─── C2: cascade delete ──────────────────────────────────────────────────────
async def test_class_delete_cascades_to_subgroups_and_sessions(db, monkeypatch):
    from datetime import timedelta
    from lib.dates import now_utc

    db.turmas.documents = [{"id": "t-1", "nome": "Judô", "alunos_ids": ["a-1"], "professor_id": "prof-1"}]
    db.subgrupos.documents = [make_subgroup()]
    db.sessoes_presenca.documents = [
        {"id": "s-1", "aluno_id": "a-1", "subgrupo_id": "sg-1", "turma_id": "t-1", "entrada": now_utc(), "saida": None, "tempo_permanencia_segundos": None},
    ]

    await admin_router.delete_class("t-1", user=User(id="root-1", nome="Raiz", email="r@e.com", tipo="admin", status="ativo", is_root_admin=True))

    assert db.subgrupos.documents == []
    assert db.sessoes_presenca.documents == []
    assert db.turmas.documents == []
    assert db.alunos.documents[0]["turma_id"] is None
