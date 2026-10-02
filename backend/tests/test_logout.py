# Regression: POST /api/auth/logout returned the injected `response: Response`
# (status_code=None) and crashed in uvicorn with KeyError: None → HTTP 500.
# Exercised through the ASGI stack, where the bad status actually surfaced.
from fastapi import FastAPI
from fastapi.testclient import TestClient

from lib.security import SESSION_COOKIE, get_current_user
from models.models import User
from routers import auth as auth_router

USER = User(id="user-1", nome="Caio Alves", email="caio@aluno.com", tipo="aluno", status="ativo")


def client(monkeypatch, revoked):
    async def fake_revoke(user_id):
        revoked.append(user_id)

    monkeypatch.setattr(auth_router, "revoke_user_tokens", fake_revoke)
    app = FastAPI()
    app.include_router(auth_router.router)
    app.dependency_overrides[get_current_user] = lambda: USER
    return TestClient(app)


def test_logout_returns_204_and_clears_session_cookie(monkeypatch):
    revoked = []
    response = client(monkeypatch, revoked).post("/api/auth/logout")

    assert response.status_code == 204
    assert response.content == b""
    assert revoked == ["user-1"]
    cleared = [header for header in response.headers.get_list("set-cookie") if header.startswith(f"{SESSION_COOKIE}=")]
    assert cleared, "session cookie must be expired on logout"
    assert "Max-Age=0" in cleared[0]
