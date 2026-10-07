# Self-service account management: profile, avatar, deactivation (reversible)
# and permanent deletion (e-mail freed). Destructive actions require the password.
import pytest
from fastapi import HTTPException

from lib.security import hash_password
from models.models import User
from routers import account as router
from tests.fake_mongo import FakeCollection, enrollment_db

ALUNO = User(id="a-1", nome="Carlos Alves", email="carlos@escola.com", tipo="aluno", status="ativo",
             aluno_id="a-1", senha_hash=hash_password("SenhaForte#2026"))
PROF = User(id="prof-1", nome="Ana Souza", email="ana@escola.com", tipo="professor", status="ativo",
            senha_hash=hash_password("SenhaForte#2026"))
ROOT = User(id="root-1", nome="Raiz", email="raiz@escola.com", tipo="admin", status="ativo",
            is_root_admin=True, senha_hash=hash_password("SenhaForte#2026"))


@pytest.fixture
def db(monkeypatch):
    fake = enrollment_db(
        users=FakeCollection([
            {"id": "a-1", "nome": "Carlos Alves", "email": "carlos@escola.com", "tipo": "aluno", "status": "ativo",
             "email_verified": True, "senha_hash": hash_password("SenhaForte#2026")},
            {"id": "prof-1", "nome": "Ana Souza", "email": "ana@escola.com", "tipo": "professor", "status": "ativo",
             "email_verified": True, "senha_hash": hash_password("SenhaForte#2026")},
            {"id": "root-1", "nome": "Raiz", "email": "raiz@escola.com", "tipo": "admin", "status": "ativo",
             "is_root_admin": True, "senha_hash": hash_password("SenhaForte#2026")},
        ]),
        alunos=FakeCollection([{"id": "a-1", "nome": "Carlos Alves", "turma_id": "t-1"}]),
        turmas=FakeCollection([{"id": "t-1", "nome": "Futsal", "alunos_ids": ["a-1"], "professor_id": "prof-1"}]),
    )
    events = []

    async def record(*args):
        events.append(args)

    monkeypatch.setattr(router, "db", fake)
    monkeypatch.setattr("lib.security.db", fake)  # revoke_user_tokens reads revocations
    monkeypatch.setattr(router, "publish_user_event", record)
    monkeypatch.setattr(router, "publish_admin_event", record)
    monkeypatch.setattr(router, "publish_class_event", record)
    fake.events = events
    return fake


async def test_get_and_update_profile(db):
    conta = (await router.get_account(user=ALUNO))["conta"]
    assert conta["nome"] == "Carlos Alves" and conta["email"] == "carlos@escola.com"

    updated = await router.update_account(router.ProfileUpdate(nome="Carlos A. Souza", telefone="31999990000"), user=ALUNO)
    assert updated["conta"]["nome"] == "Carlos A. Souza" and updated["conta"]["telefone"] == "31999990000"
    assert (await db.users.find_one({"id": "a-1"}))["nome"] == "Carlos A. Souza"


async def test_preset_avatar_lifecycle(db):
    result = await router.set_preset_avatar(router.AvatarPresetInput(avatar_id="monster-3"), user=ALUNO)
    assert result["conta"]["avatar"] == {"tipo": "preset", "avatar_id": "monster-3"}

    await router.remove_avatar(user=ALUNO)
    assert (await router.get_account(user=ALUNO))["conta"]["avatar"] is None


def test_upload_avatar_validates_size_and_type():
    tiny = "data:image/png;base64," + "A" * 60
    with pytest.raises(Exception):
        router.AvatarUploadInput(image_base64=tiny)  # payload under 100 bytes after decode
    with pytest.raises(Exception):
        router.AvatarUploadInput(image_base64="data:image/gif;base64," + "A" * 400)  # unsupported type
    with pytest.raises(Exception):
        router.AvatarUploadInput(image_base64="not-a-data-url")


async def test_deactivate_requires_correct_password_and_unlinks(db):
    with pytest.raises(HTTPException) as error:
        await router.deactivate_account(router.PasswordConfirmInput(senha="errada"), user=ALUNO)
    assert error.value.status_code == 401

    result = await router.deactivate_account(router.PasswordConfirmInput(senha="SenhaForte#2026"), user=ALUNO)
    assert result["status"] == "inativo" and result["turmas_desvinculadas"] == 1
    assert (await db.users.find_one({"id": "a-1"}))["status"] == "inativo"
    assert (await db.alunos.find_one({"id": "a-1"}))["turma_id"] is None
    assert db.turmas.documents[0]["alunos_ids"] == []


async def test_deactivated_account_reactivates_on_login(monkeypatch, db):
    await db.users.update_one({"id": "a-1"}, {"$set": {"status": "inativo"}})

    # Simulate the login path: successful credential check flips status back.
    from routers import auth as auth_router
    monkeypatch.setattr(auth_router, "db", db)
    monkeypatch.setattr(auth_router, "check_account_lockout", lambda email: _async({"locked": False}))
    monkeypatch.setattr(auth_router, "check_rate_limit", lambda email: _async({"blocked": False}))
    monkeypatch.setattr(auth_router, "record_auth_attempt", lambda email, ok: _async(None))
    monkeypatch.setattr(auth_router, "increment_failed_attempts", lambda email: _async(None))
    monkeypatch.setattr(auth_router, "reset_failed_attempts", lambda email: _async(None))

    class FakeResponse:
        def set_cookie(self, *args, **kwargs):
            pass

    from starlette.responses import Response
    result = await auth_router.login(auth_router.LoginInput(login="carlos@escola.com", senha="SenhaForte#2026"), Response())
    assert result["user"]["status"] == "ativo"
    assert (await db.users.find_one({"id": "a-1"}))["status"] == "ativo"


async def _async(value):
    return value


async def test_delete_is_permanent_and_frees_email(db):
    with pytest.raises(HTTPException):
        await router.delete_account(router.PasswordConfirmInput(senha="errada"), user=ALUNO)

    result = await router.delete_account(router.PasswordConfirmInput(senha="SenhaForte#2026"), user=ALUNO)
    assert result["status"] == "excluida" and result["email_liberado"] == "carlos@escola.com"
    assert await db.users.find_one({"id": "a-1"}) is None
    assert await db.alunos.find_one({"id": "a-1"}) is None
    assert db.turmas.documents[0]["alunos_ids"] == []


async def test_root_admin_cannot_self_destruct(db):
    for call in (
        lambda: router.deactivate_account(router.PasswordConfirmInput(senha="SenhaForte#2026"), user=ROOT),
        lambda: router.delete_account(router.PasswordConfirmInput(senha="SenhaForte#2026"), user=ROOT),
    ):
        with pytest.raises(HTTPException) as error:
            await call()
        assert error.value.status_code == 403
