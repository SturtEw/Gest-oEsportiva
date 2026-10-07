# Teacher onboarding by invite link: only the root admin issues links, a link is
# single use and time-limited, only its hash is stored, and using it creates an
# active, signed-in teacher (optionally already in charge of a class).
from datetime import timedelta

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.responses import Response

from lib.dates import now_utc
from models.models import User
from routers import admin as admin_router
from routers import teacher_invites as router
from services import teacher_invites as service
from tests.fake_mongo import FakeCollection, enrollment_db

ROOT = User(id="root-1", nome="Admin Raiz", email="raiz@escola.com", tipo="admin", status="ativo", is_root_admin=True)
TEACHER = User(id="prof-1", nome="Ana Souza", email="ana@escola.com", tipo="professor", status="ativo")


@pytest.fixture
def db(monkeypatch):
    fake = enrollment_db(
        users=FakeCollection(
            [{"id": "prof-1", "nome": "Ana Souza", "email": "ana@escola.com", "tipo": "professor", "status": "ativo"}],
            unique=[("email", None), ("documento_hash", {"documento_hash": {"$exists": True}})],
        ),
        turmas=FakeCollection([
            {"id": "t-livre", "nome": "Basquete Sub-15", "modalidade": "Basquete", "ano": 2026, "capacidade": 20, "alunos_ids": []},
            {"id": "t-ocupada", "nome": "Futsal Sub-13", "modalidade": "Futsal", "ano": 2026, "capacidade": 20, "alunos_ids": [], "professor_id": "prof-1"},
        ]),
        professor_convites=FakeCollection(unique=[("token_hash", None)]),
        admin_audit=FakeCollection(),
        admin_notifications=FakeCollection(),
    )
    events = []

    async def record(*args):
        events.append(args)

    async def no_email(**_kwargs):
        raise RuntimeError("EMERGENT_EMAIL_KEY não configurado")

    for module in (service, router, admin_router):
        monkeypatch.setattr(module, "db", fake)
    monkeypatch.setattr(router, "publish_admin_event", record)
    monkeypatch.setattr(router, "publish_user_event", record)
    monkeypatch.setattr(router, "send_email", no_email)
    fake.events = events
    return fake


def signup(token: str, **overrides):
    data = {"token": token, "nome": "Marina Costa", "senha": "senha-forte-123", "documento_tipo": "cpf",
            "documento_numero": "529.982.247-25", "formacao_academica": "Educação Física", "area_atuacao": "Vôlei"}
    data.update(overrides)
    return router.TeacherInviteRegisterInput(**data)


async def new_invite(email="marina@escola.com", **extra):
    payload = router.TeacherInviteCreate(email=email, **extra)
    return await router.create_teacher_invite(payload, user=ROOT)


# ─── Issuing ──────────────────────────────────────────────────────────────────
async def test_admin_creates_invite_and_only_the_hash_is_stored(db):
    created = await new_invite(nome="Marina Costa", validade_dias=3)

    token = created["token"]
    assert len(token) >= 40 and created["path"] == f"/convite-professor?token={token}"
    stored = db.professor_convites.documents[0]
    assert stored["token_hash"] == service.hash_token(token) and token not in str(stored)
    assert created["invite"]["status"] == "pendente" and created["invite"]["email"] == "marina@escola.com"
    assert timedelta(days=2, hours=23) < stored["expira_em"] - stored["criado_em"] <= timedelta(days=3)
    # E-mail delivery failed (no provider in tests): the admin still gets the link.
    assert created["email_enviado"] is False
    assert created["email_erro"]  # the real reason, not a generic failure
    assert db.admin_audit.documents[-1]["action"] == "teacher_invite_created"


async def test_only_root_admin_manages_invites(db):
    for call in (
        lambda: router.create_teacher_invite(router.TeacherInviteCreate(email="x@escola.com"), user=TEACHER),
        lambda: router.list_teacher_invites(user=TEACHER),
        lambda: router.revoke_teacher_invite("qualquer", user=TEACHER),
    ):
        with pytest.raises(HTTPException) as error:
            await call()
        assert error.value.status_code == 403


async def test_new_invite_for_same_email_replaces_the_previous_one(db):
    first = await new_invite()
    second = await new_invite(email="MARINA@escola.com")

    with pytest.raises(HTTPException) as error:
        await router.preview_teacher_invite(token=first["token"])
    assert error.value.status_code == 410
    assert (await router.preview_teacher_invite(token=second["token"]))["email"] == "marina@escola.com"
    statuses = [item["status"] for item in (await router.list_teacher_invites(user=ROOT))["invites"]]
    assert sorted(statuses) == ["pendente", "revogado"]


async def test_cannot_invite_an_existing_account_or_into_a_taken_class(db):
    with pytest.raises(HTTPException) as error:
        await new_invite(email="ana@escola.com")
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error:
        await new_invite(turma_id="t-ocupada")
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error:
        await new_invite(turma_id="nao-existe")
    assert error.value.status_code == 404


def test_validity_is_bounded():
    with pytest.raises(ValidationError):
        router.TeacherInviteCreate(email="a@escola.com", validade_dias=0)
    with pytest.raises(ValidationError):
        router.TeacherInviteCreate(email="a@escola.com", validade_dias=31)


# ─── Preview ──────────────────────────────────────────────────────────────────
async def test_preview_shows_email_and_class(db):
    created = await new_invite(nome="Marina", turma_id="t-livre")

    preview = await router.preview_teacher_invite(token=created["token"])

    assert preview["email"] == "marina@escola.com" and preview["nome"] == "Marina"
    assert preview["turma"]["nome"] == "Basquete Sub-15"


async def test_unknown_expired_or_revoked_links_are_rejected(db):
    with pytest.raises(HTTPException) as error:
        await router.preview_teacher_invite(token="x" * 43)
    assert error.value.status_code == 404

    expired = await new_invite(email="velho@escola.com")
    await db.professor_convites.update_one({"email": "velho@escola.com"}, {"$set": {"expira_em": now_utc() - timedelta(minutes=1)}})
    with pytest.raises(HTTPException) as error:
        await router.preview_teacher_invite(token=expired["token"])
    assert error.value.status_code == 410 and "expirou" in error.value.detail

    revoked = await new_invite(email="cancelado@escola.com")
    assert (await router.revoke_teacher_invite(revoked["invite"]["id"], user=ROOT))["status"] == "revogado"
    with pytest.raises(HTTPException) as error:
        await router.register_teacher(signup(revoked["token"]), Response())
    assert error.value.status_code == 410 and "cancelado" in error.value.detail


# ─── Registration ─────────────────────────────────────────────────────────────
async def test_registration_creates_active_signed_in_teacher_with_class(db):
    created = await new_invite(turma_id="t-livre")
    response = Response()

    result = await router.register_teacher(signup(created["token"]), response)

    user = result["user"]
    assert user["tipo"] == "professor" and user["status"] == "ativo" and user["email"] == "marina@escola.com"
    stored = await db.users.find_one({"id": user["id"]})
    assert stored["email_verified"] is True and stored["senha_hash"] and stored["documento_final"] == "4725"
    assert "gesp_session=" in response.headers.get("set-cookie", "")
    assert result["turma"]["id"] == "t-livre" and result["aviso"] is None
    assert (await db.turmas.find_one({"id": "t-livre"}))["professor_id"] == user["id"]
    assert (await db.professor_convites.find_one({"id": created["invite"]["id"]}))["usado_por"] == user["id"]
    assert db.admin_notifications.documents[-1]["tipo"] == "professor_convite_aceito"


async def test_link_is_single_use(db):
    created = await new_invite()
    await router.register_teacher(signup(created["token"]), Response())

    with pytest.raises(HTTPException) as error:
        await router.register_teacher(signup(created["token"], documento_numero="11144477735"), Response())

    assert error.value.status_code == 410 and "já foi usado" in error.value.detail
    assert len([doc for doc in db.users.documents if doc.get("tipo") == "professor"]) == 2


async def test_class_taken_meanwhile_keeps_the_account_and_warns(db):
    created = await new_invite(turma_id="t-livre")
    await db.turmas.update_one({"id": "t-livre"}, {"$set": {"professor_id": "prof-1"}})

    result = await router.register_teacher(signup(created["token"]), Response())

    assert result["turma"] is None and "já tem outro professor" in result["aviso"]
    assert (await db.turmas.find_one({"id": "t-livre"}))["professor_id"] == "prof-1"


async def test_failed_registration_leaves_the_link_usable(db):
    await db.users.insert_one({"id": "outro", "nome": "Outra", "email": "outra@escola.com", "tipo": "aluno",
                               "documento_hash": router._document_digest("52998224725")})
    created = await new_invite()

    with pytest.raises(HTTPException) as error:
        await router.register_teacher(signup(created["token"]), Response())
    assert error.value.status_code == 409

    result = await router.register_teacher(signup(created["token"], documento_numero="11144477735"), Response())
    assert result["user"]["tipo"] == "professor"


async def test_google_account_must_match_invited_email(db, monkeypatch):
    created = await new_invite()

    async def claims_for(email):
        async def fake(_credential):
            return {"email": email, "sub": "google-123", "email_verified": True, "name": "Marina"}
        return fake

    monkeypatch.setattr(router, "_google_claims", await claims_for("outra@gmail.com"))
    with pytest.raises(HTTPException) as error:
        await router.register_teacher(signup(created["token"], provider="google", senha=None, credential="c" * 30), Response())
    assert error.value.status_code == 400

    monkeypatch.setattr(router, "_google_claims", await claims_for("marina@escola.com"))
    result = await router.register_teacher(signup(created["token"], provider="google", senha=None, credential="c" * 30), Response())
    stored = await db.users.find_one({"id": result["user"]["id"]})
    assert stored["google_sub"] == "google-123" and stored["senha_hash"] == ""


def test_password_or_google_is_required():
    with pytest.raises(ValidationError):
        signup("t" * 43, senha=None)
    with pytest.raises(ValidationError):
        signup("t" * 43, provider="google", senha=None)
