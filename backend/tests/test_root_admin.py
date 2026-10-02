# The root account follows ADMIN_USER / ADMIN_PASSWORD from the environment, and
# the real /login accepts those credentials afterwards.
import time

import pytest
from fastapi import HTTPException, Response

from lib import rate_limit
from lib.security import hash_password
from models.models import LoginInput
from routers import auth as auth_router
from services import root_admin
from tests.fake_mongo import FakeCollection, enrollment_db

EMAIL = "dono@escolamodelo.com.br"
PASSWORD = "SenhaDoRender#2026"


@pytest.fixture
def db(monkeypatch):
    fake = enrollment_db(auth_attempts=FakeCollection())
    for module in (root_admin, auth_router, rate_limit):
        monkeypatch.setattr(module, "db", fake)
    monkeypatch.setenv("ADMIN_USER", EMAIL)
    monkeypatch.setenv("ADMIN_PASSWORD", PASSWORD)
    monkeypatch.delenv("ADMIN_NAME", raising=False)
    return fake


def root_doc(**overrides):
    doc = {"id": "root-1", "nome": "Admin", "email": EMAIL, "senha_hash": hash_password("SenhaAntiga#2025"),
           "tipo": "admin", "status": "ativo", "is_root_admin": True, "email_verified": True, "google_sub": "g-1"}
    doc.update(overrides)
    return doc


async def login(email=EMAIL, password=PASSWORD):
    return await auth_router.login(LoginInput(login=email, senha=password), Response())


async def test_creates_root_admin_and_login_works(db):
    assert await root_admin.ensure_root_admin() == "created"

    [doc] = db.users.documents
    assert doc["is_root_admin"] is True and doc["tipo"] == "admin" and doc["status"] == "ativo" and doc["email_verified"] is True
    assert doc["senha_hash"] != PASSWORD
    result = await login()
    assert result["user"]["tipo"] == "admin"
    assert await root_admin.ensure_root_admin() == "unchanged"


async def test_existing_root_gets_env_password_and_is_unlocked(db):
    db.users.documents.append(root_doc(locked_until=time.time() + 900, failed_attempts=5))
    db.auth_attempts.documents.extend(
        {"key": f"ratelimit:{EMAIL}", "identifier": EMAIL, "success": False, "timestamp": time.time()} for _ in range(10)
    )
    with pytest.raises(HTTPException) as locked:
        await login()
    assert locked.value.status_code == 423

    assert await root_admin.ensure_root_admin() == "updated"

    doc = db.users.documents[0]
    assert "locked_until" not in doc and "failed_attempts" not in doc
    assert doc["token_valid_after"] is not None
    assert doc["google_sub"] == "g-1"  # same e-mail keeps the Google link
    assert (await login())["user"]["email"] == EMAIL
    with pytest.raises(HTTPException) as old:
        await login(password="SenhaAntiga#2025")
    assert old.value.status_code == 401


async def test_root_moves_to_new_email(db):
    db.users.documents.append(root_doc(email="antigo@gmail.com"))

    assert await root_admin.ensure_root_admin() == "updated"

    [doc] = db.users.documents
    assert doc["id"] == "root-1" and doc["email"] == EMAIL and doc["google_sub"] is None
    assert (await login())["user"]["id"] == "root-1"


async def test_values_pasted_with_whitespace_are_trimmed(db, monkeypatch):
    monkeypatch.setenv("ADMIN_USER", f"  {EMAIL.upper()}\n")
    monkeypatch.setenv("ADMIN_PASSWORD", f"{PASSWORD}\n")

    assert await root_admin.ensure_root_admin() == "created"
    assert (await login())["user"]["email"] == EMAIL


async def test_ordinary_account_is_never_promoted(db):
    db.users.documents.append({"id": "u-1", "email": EMAIL, "tipo": "aluno", "status": "ativo", "senha_hash": hash_password("x" * 12)})

    assert await root_admin.ensure_root_admin() == "conflict"
    assert db.users.documents[0]["tipo"] == "aluno" and "is_root_admin" not in db.users.documents[0]


@pytest.mark.parametrize("user, password", [("admin", PASSWORD), (EMAIL, "curta")])
async def test_invalid_configuration_changes_nothing(db, monkeypatch, user, password):
    monkeypatch.setenv("ADMIN_USER", user)
    monkeypatch.setenv("ADMIN_PASSWORD", password)

    assert await root_admin.ensure_root_admin() == "invalid"
    assert db.users.documents == []


async def test_without_variables_nothing_is_managed(db, monkeypatch):
    monkeypatch.delenv("ADMIN_USER")
    monkeypatch.delenv("ADMIN_PASSWORD")
    original = root_doc()
    db.users.documents.append(dict(original))

    assert await root_admin.ensure_root_admin() == "skipped"
    assert db.users.documents[0] == original
