# Deleting a class is reserved to the root admin: members keep their accounts
# and become unassigned, the teacher is simply released, and the action is audited.
import pytest
from fastapi import HTTPException

from models.models import User
from routers import admin as admin_router
from tests.fake_mongo import FakeCollection, enrollment_db

ROOT = User(id="root-1", nome="Admin Raiz", email="raiz@escola.com", tipo="admin", status="ativo", is_root_admin=True)
TEACHER = User(id="prof-1", nome="Ana Souza", email="ana@escola.com", tipo="professor", status="ativo")


@pytest.fixture
def db(monkeypatch):
    fake = enrollment_db(
        turmas=FakeCollection([
            {"id": "t-1", "nome": "Futsal Sub-13", "modalidade": "Futsal", "ano": 2026,
             "capacidade": 20, "alunos_ids": ["a-1", "a-2"], "professor_id": "prof-1"},
            {"id": "t-2", "nome": "Basquete Sub-15", "modalidade": "Basquete", "ano": 2026,
             "capacidade": 20, "alunos_ids": [], "professor_id": "prof-1"},
        ]),
        alunos=FakeCollection([
            {"id": "a-1", "nome": "Aluno Um", "turma_id": "t-1"},
            {"id": "a-2", "nome": "Aluno Dois", "turma_id": "t-1"},
        ]),
        admin_audit=FakeCollection(),
    )
    events = []

    async def record(*args):
        events.append(args)

    monkeypatch.setattr(admin_router, "db", fake)
    monkeypatch.setattr(admin_router, "publish_admin_event", record)
    monkeypatch.setattr(admin_router, "publish_user_event", record)
    monkeypatch.setattr(admin_router, "publish_event", record)
    fake.events = events
    return fake


async def test_only_root_admin_can_delete(db):
    with pytest.raises(HTTPException) as error:
        await admin_router.delete_class("t-1", user=TEACHER)
    assert error.value.status_code == 403
    assert await db.turmas.find_one({"id": "t-1"})


async def test_delete_removes_class_and_unlinks_members(db):
    result = await admin_router.delete_class("t-1", user=ROOT)

    assert result["status"] == "excluida" and result["students_unlinked"] == 2
    assert await db.turmas.find_one({"id": "t-1"}) is None
    for student in db.alunos.documents:
        assert student["turma_id"] is None
    assert db.admin_audit.documents[-1]["action"] == "class_deleted"
    # Realtime invalidations for admin, teacher and each released student.
    assert {("classes",), ("unassigned_students",), ("prof-1", "classes")} <= set(db.events)
    assert {(member, "portal") for member in ("a-1", "a-2")} <= set(db.events)


async def test_delete_unknown_class_returns_404(db):
    with pytest.raises(HTTPException) as error:
        await admin_router.delete_class("missing", user=ROOT)
    assert error.value.status_code == 404
