# View As only permits an active target and a root actor on read-only routes.
import asyncio
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from lib import impersonation
from models.models import User

def request(path: str, method: str = "GET") -> Request:
    return Request({"type": "http", "method": method, "path": path, "headers": [], "query_string": b"", "server": ("localhost", 80), "scheme": "http"})


def actor(tipo: str = "admin", root: bool = True) -> User:
    return User(id="root", nome="Raiz", email="root@example.com", tipo=tipo, is_root_admin=root)

def test_view_as_authorizes_root_and_uses_real_target(monkeypatch):
    class Users:
        async def find_one(self, query, projection):
            assert query == {"id": "teacher-id", "tipo": "professor", "status": "ativo"}
            return {"id": "teacher-id", "nome": "Professora", "email": "teacher@example.com", "tipo": "professor", "status": "ativo"}

    monkeypatch.setattr(impersonation, "db", SimpleNamespace(users=Users()))
    original = actor()
    target = asyncio.run(impersonation.get_current_user_with_impersonation(
        request("/api/professor/dashboard"), role="professor", target_id="teacher-id", actor=original
    ))
    assert target.id == "teacher-id" and target.tipo == "professor"
    assert original.id == "root" and original.tipo == "admin"


def test_view_as_rejects_inactive_or_missing_target(monkeypatch):
    class Users:
        async def find_one(self, query, projection):
            assert query["status"] == "ativo"
            return None
    monkeypatch.setattr(impersonation, "db", SimpleNamespace(users=Users()))
    with pytest.raises(HTTPException) as error:
        asyncio.run(impersonation.get_current_user_with_impersonation(
            request("/api/student/portal"), role="aluno", target_id="inactive", actor=actor()
        ))
    assert error.value.status_code == 404
@pytest.mark.parametrize("role,target_id,method,path,original,expected", [
    ("aluno", "student-id", "GET", "/api/student/portal", actor("professor", False), 403),
    ("admin", "student-id", "GET", "/api/student/portal", actor(), 400),
    ("aluno", None, "GET", "/api/student/portal", actor(), 400),
    ("aluno", "student-id", "POST", "/api/student-id/questions", actor(), 403),
    ("aluno", "student-id", "GET", "/api/admin/summary", actor(), 403),
])
def test_view_as_rejects_unauthorized(role, target_id, method, path, original, expected):
    with pytest.raises(HTTPException) as error:
        asyncio.run(impersonation.get_current_user_with_impersonation(
            request(path, method), role=role, target_id=target_id, actor=original
        ))
    assert error.value.status_code == expected

def test_view_path_allowlist():
    assert impersonation.allowed_view_path("/api/professor/dashboard", "professor")
    assert impersonation.allowed_view_path("/api/student/abc/ranking", "aluno")
    assert not impersonation.allowed_view_path("/api/student/portal", "professor")
    assert not impersonation.allowed_view_path("/api/student/me/ranking-preference", "aluno")
    assert not impersonation.allowed_view_path("/api/admin/students", "aluno")
    # Enrollment: read-only views are allowed, each for its own role only.
    assert impersonation.allowed_view_path("/api/enrollment/requests/me", "aluno")
    assert impersonation.allowed_view_path("/api/enrollment/teacher/requests", "professor")
    assert not impersonation.allowed_view_path("/api/enrollment/teacher/invites", "aluno")
    assert not impersonation.allowed_view_path("/api/enrollment/join", "aluno")
