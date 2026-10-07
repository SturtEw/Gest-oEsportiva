# Regression tests for the two email-delivery bugs:
# 1. "Forgot password" must NOT answer 200 when the e-mail never left —
#    the frontend's success screen was shown on a silent failure.
# 2. The teacher-invite route must surface the real email error (`email_erro`)
#    while still returning the link, so the admin can copy it.
import pytest
from fastapi import HTTPException

import lib.emailx as emailx
from models.models import User
from routers import auth as auth_router
from routers import teacher_invites as invites_router
from services import teacher_invites as invites_service
from tests.fake_mongo import FakeCollection, enrollment_db

ROOT = User(id="root-1", nome="Admin Raiz", email="raiz@escola.com", tipo="admin", status="ativo", is_root_admin=True)


@pytest.fixture
def auth_db(monkeypatch):
    fake = enrollment_db(
        users=FakeCollection([{"id": "u-1", "nome": "Carlos", "email": "carlos@escola.com", "tipo": "aluno", "status": "ativo"}]),
        password_resets=FakeCollection(),
        email_queue=FakeCollection(),
    )
    monkeypatch.setattr(auth_router, "db", fake)
    monkeypatch.setattr(auth_router, "check_rate_limit", _rate_ok)
    monkeypatch.setattr(auth_router, "record_auth_attempt", _no_op)
    return fake


async def _rate_ok(_key):
    return {"blocked": False}


async def _no_op(*_args, **_kwargs):
    return None


@pytest.fixture
def invite_db(monkeypatch):
    fake = enrollment_db(
        users=FakeCollection([]),
        turmas=FakeCollection([]),
        professor_convites=FakeCollection(unique=[("token_hash", None)]),
        admin_audit=FakeCollection(),
        admin_notifications=FakeCollection(),
    )
    async def record(*args):
        pass
    for module in (invites_service, invites_router):
        monkeypatch.setattr(module, "db", fake)
    monkeypatch.setattr("routers.admin.db", fake)
    monkeypatch.setattr(invites_router, "publish_admin_event", record)
    return fake


# ─── 1. Forgot password: no more silent success ──────────────────────────────
async def test_forgot_password_returns_200_when_email_is_sent(auth_db, monkeypatch):
    sent = []

    async def ok_send(**kwargs):
        sent.append(kwargs)
        return "prov-1"

    monkeypatch.setattr(auth_router, "send_email", ok_send)
    result = await auth_router.forgot_password(auth_router.ForgotPasswordInput(email="carlos@escola.com"))
    assert "link" in result["message"]
    assert len(sent) == 1
    assert auth_db.email_queue.documents[0]["status"] == "sent"
    # The token is stored hashed (sha256 hex), never in plain text in the queue.
    token_hash = auth_db.password_resets.documents[0]["token_hash"]
    assert token_hash and len(token_hash) == 64 and token_hash.isalnum()
    assert auth_db.password_resets.documents[0]["used"] is False


async def test_forgot_password_fails_loudly_when_email_fails(auth_db, monkeypatch):
    async def broken_send(**_kwargs):
        raise emailx.EmailSendError("Nenhum provedor de e-mail configurado")

    monkeypatch.setattr(auth_router, "send_email", broken_send)
    with pytest.raises(HTTPException) as error:
        await auth_router.forgot_password(auth_router.ForgotPasswordInput(email="carlos@escola.com"))
    assert error.value.status_code == 502
    # The token is persisted for the background worker's retry even though the
    # sync send failed — the user can still be served once delivery recovers.
    assert len(auth_db.password_resets.documents) == 1


# ─── 2. Teacher invite: real error surfaced, link still returned ─────────────
async def test_invite_returns_link_and_real_email_error(invite_db, monkeypatch):
    async def broken_send(**_kwargs):
        raise emailx.EmailSendError("Falha SMTP ao enviar")

    monkeypatch.setattr(invites_router, "send_email", broken_send)
    payload = invites_router.TeacherInviteCreate(email="nova@escola.com", enviar_email=True)
    result = await invites_router.create_teacher_invite(payload, user=ROOT)

    assert result["email_enviado"] is False
    assert "SMTP" in result["email_erro"] or "Falha" in result["email_erro"]
    assert result["token"]  # the link exists regardless — the admin can copy it
    assert len(result["token"]) >= 40


async def test_invite_marks_email_sent_on_success(invite_db, monkeypatch):
    async def ok_send(**_kwargs):
        return "prov-1"

    monkeypatch.setattr(invites_router, "send_email", ok_send)
    payload = invites_router.TeacherInviteCreate(email="ok@escola.com", enviar_email=True)
    result = await invites_router.create_teacher_invite(payload, user=ROOT)

    assert result["email_enviado"] is True
    assert result["email_erro"] is None
    stored = invite_db.professor_convites.documents[0]
    assert stored["email_enviado"] is True


# ─── 3. Resend provider (RESEND_API_KEY) ─────────────────────────────────────
async def test_resend_is_used_when_api_key_is_set(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.delenv("EMERGENT_EMAIL_KEY", raising=False)
    import lib.emailx as emailx
    assert emailx.provider_name() == "resend"

    sent = {}

    async def fake_post(self, url, **kwargs):
        sent["url"] = url
        sent["json"] = kwargs["json"]
        sent["auth"] = kwargs["headers"]["Authorization"]

        class R:
            status_code = 200
            headers = {"content-type": "application/json"}
            def json(self):
                return {"id": "res_123"}
        return R()

    monkeypatch.setattr("httpx.AsyncClient.post", fake_post)
    monkeypatch.setenv("EMAIL_FROM", "onboarding@resend.dev")
    monkeypatch.setenv("EMAIL_FROM_NAME", "Gestão Esportiva Escolar")
    result = await emailx.send_email(to="pessoa@gmail.com", subject="Teste", html="<b>Olá</b>")
    assert result == "res_123"
    assert sent["url"] == "https://api.resend.com/emails"
    assert sent["auth"] == "Bearer re_test_key"
    # Resend requires the full From header (name + address).
    assert sent["json"]["from"] == "Gestão Esportiva Escolar <onboarding@resend.dev>"
    assert sent["json"]["to"] == ["pessoa@gmail.com"]


async def test_resend_without_from_address_fails_clearly(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.delenv("EMAIL_FROM", raising=False)
    monkeypatch.delenv("RESEND_FROM", raising=False)
    import lib.emailx as emailx
    from fastapi import HTTPException  # noqa: F401 — not used here, EmailSendError is
    with pytest.raises(emailx.EmailSendError) as error:
        await emailx.send_email(to="pessoa@gmail.com", subject="T", html="<b>x</b>")
    assert "EMAIL_FROM" in str(error.value)


async def test_resend_api_error_surfaces_the_reason(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
    monkeypatch.setenv("EMAIL_FROM", "onboarding@resend.dev")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    import lib.emailx as emailx

    async def fake_post(self, url, **kwargs):
        class R:
            status_code = 403
            headers = {"content-type": "application/json"}
            text = '{"message":"You can only send from a verified domain"}'
            def json(self):
                return {"message": "You can only send from a verified domain"}
        return R()

    monkeypatch.setattr("httpx.AsyncClient.post", fake_post)
    with pytest.raises(emailx.EmailSendError) as error:
        await emailx.send_email(to="pessoa@gmail.com", subject="T", html="<b>x</b>")
    assert "verified domain" in str(error.value)
