# Regression coverage for independent individual and bulk session revocation.
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import pytest
from lib import security
NOW = datetime.now(timezone.utc)


def check(monkeypatch, *, user=None, revoked=None, payload=None, db_error=False):
    calls = []

    class Users:
        async def find_one(self, query, projection):
            calls.append("user")
            if db_error:
                raise RuntimeError("database unavailable")
            return user
    class Revoked:
        async def find_one(self, query, projection):
            calls.append("jti")
            return revoked
    monkeypatch.setattr(security, "db", SimpleNamespace(users=Users(), revoked_jti=Revoked()))
    claims = {"sub": "user-1", "jti": "token-1", "iat": NOW.timestamp()} if payload is None else payload
    return asyncio.run(security.is_token_revoked(claims)), calls

def test_individual_revocation_without_bulk_stamp(monkeypatch):
    result, calls = check(monkeypatch, user={"id": "user-1"}, revoked={"jti": "token-1"})
    assert result is True
    assert calls == ["user", "jti"]


def test_valid_token_without_bulk_stamp(monkeypatch):
    result, calls = check(monkeypatch, user={"id": "user-1"})
    assert result is False
    assert calls == ["user", "jti"]


def test_bulk_revocation_and_valid_newer_token(monkeypatch):
    assert check(monkeypatch, user={"id": "user-1", "token_valid_after": NOW + timedelta(seconds=1)})[0]
    assert not check(monkeypatch, user={"id": "user-1", "token_valid_after": NOW - timedelta(seconds=1)})[0]

@pytest.mark.parametrize("claims", [
    {"sub": "user-1", "iat": 100},
    {"sub": "user-1", "jti": "token-1"},
    {"sub": "user-1", "jti": "token-1", "iat": "bad"},
    {"sub": "user-1", "jti": "token-1", "iat": float("inf")},
])
def test_malformed_claims_fail_closed(monkeypatch, claims):
    result, _ = check(monkeypatch, user={"id": "user-1", "token_valid_after": NOW}, payload=claims)
    assert result is True

def test_malformed_stamp_fails_closed(monkeypatch):
    assert check(monkeypatch, user={"id": "user-1", "token_valid_after": "invalid"})[0]


def test_missing_user_is_revoked(monkeypatch):
    assert check(monkeypatch)[0]


def test_db_outage_does_not_authorize(monkeypatch):
    with pytest.raises(RuntimeError, match="database unavailable"):
        check(monkeypatch, db_error=True)
