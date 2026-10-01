"""Regression tests for the Cloud Logging / Secret Manager optional-dependency fallback.

Both integrations are optional: the library may be absent, and even when it is
installed the process may have no Application Default Credentials (every local dev
environment). Neither case may prevent the API from starting.

The original code imported the library inside try/except but then called
`google.cloud.logging.Client()` *outside* it, so installing the library replaced a
harmless `ModuleNotFoundError` with a fatal `DefaultCredentialsError` at import time.
These tests pin the fix.
"""

from __future__ import annotations

import importlib
import logging
import sys
import types

import pytest


@pytest.fixture
def fresh_db(monkeypatch):
    """Import lib.db from scratch so module-level logging setup runs again.

    The logging module caches loggers by name process-wide, so handlers installed by a
    previous test would still be attached and make the assertions lie. Clear them first.
    """

    def _load():
        existing = logging.getLogger("lib.db")
        for handler in list(existing.handlers):
            existing.removeHandler(handler)
        for name in [m for m in sys.modules if m == "lib.db" or m.startswith("lib.db.")]:
            del sys.modules[name]
        return importlib.import_module("lib.db")

    return _load


def test_missing_library_falls_back_to_local_handler(monkeypatch, fresh_db):
    """Simulate google.cloud.logging not being installed at all."""
    import google.cloud.logging as gl

    monkeypatch.setattr(
        sys.modules["builtins"],
        "__import__",
        _import_raising("google.cloud.logging"),
    )
    module = fresh_db()
    assert module._HAS_CLOUD_LOGGING is False
    assert module.logger.handlers, "a local stdout handler must be installed"
    assert isinstance(gl, object)  # keeps the import referenced for linters


def test_missing_credentials_falls_back_instead_of_raising(monkeypatch, fresh_db):
    """The library is installed but Client() cannot authenticate: must not crash."""
    import google.cloud.logging as gl

    def _boom(*_args, **_kwargs):
        from google.auth.exceptions import DefaultCredentialsError

        raise DefaultCredentialsError("Your default credentials were not found")

    monkeypatch.setattr(gl, "Client", _boom)
    module = fresh_db()

    assert module._HAS_CLOUD_LOGGING is False
    assert module.logger.handlers, "a local stdout handler must be installed"


def test_working_credentials_keep_cloud_logging(monkeypatch, fresh_db):
    """With usable credentials Cloud Logging stays on and the local handler is skipped."""
    import google.cloud.logging as gl

    captured: dict[str, object] = {}

    def _fake_client(*_args, **_kwargs):
        return types.SimpleNamespace(
            setup_logging=lambda **kwargs: captured.update(kwargs)
        )

    monkeypatch.setattr(gl, "Client", _fake_client)
    module = fresh_db()

    assert module._HAS_CLOUD_LOGGING is True
    assert module.logger.handlers == [], "must not install a competing local handler"
    assert captured.get("log_level") is not None


def test_secret_manager_client_error_becomes_runtime_error(monkeypatch):
    """get_secret must raise RuntimeError (which callers catch) when the client cannot
    authenticate, instead of leaking DefaultCredentialsError from client construction."""
    module = importlib.import_module("lib.db")

    from google.auth.exceptions import DefaultCredentialsError

    class _Boom:
        def __init__(self, *_a, **_k):
            raise DefaultCredentialsError("no ADC")

    secretmanager = types.ModuleType("google.cloud.secretmanager")
    secretmanager.SecretManagerServiceClient = _Boom
    monkeypatch.setitem(sys.modules, "google.cloud.secretmanager", secretmanager)
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "fake-project")
    monkeypatch.delenv("MONGO_URI_SECRET_ID", raising=False)

    import asyncio

    loop = asyncio.new_event_loop()
    try:
        with pytest.raises(RuntimeError) as excinfo:
            loop.run_until_complete(module.get_secret("some-secret"))
    finally:
        loop.close()
    assert "Secret Manager indisponivel" in str(excinfo.value)


def _import_raising(blocked: str):
    """Return an __import__ replacement that refuses one module path."""
    import builtins

    real_import = builtins.__import__

    def _patched(name, *args, **kwargs):
        if name == blocked or name.startswith(blocked + "."):
            raise ModuleNotFoundError(f"No module named '{name}'")
        return real_import(name, *args, **kwargs)

    return _patched
