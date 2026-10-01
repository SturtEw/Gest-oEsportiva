"""Smoke-test: valida a configuração de produção do Render sem subir o servidor.

Simula o ambiente do Render (APP_ENV=production) e importa o server para
garantir que:
  1. _validate_env_security() não aborta;
  2. CORS e o WebSocket aceitam a origem do front e recusam origens estranhas;
  3. o cookie de sessão sai com o SameSite esperado e Secure.

As três constantes abaixo espelham o render.yaml. `scripts/custom-domain.mjs`
as atualiza junto com o resto ao migrar para domínio próprio.
"""

import os
import sys

FRONTEND_ORIGIN = "https://gestaoesportiva-9d8fa.web.app"
EXTRA_FRONTEND_ORIGINS = ["https://gestaoesportiva-9d8fa.firebaseapp.com"]
EXPECTED_SAMESITE = "none"

os.environ.update({
    "APP_ENV": "production",
    "COOKIE_SECURE": "true",
    "SESSION_SAMESITE": EXPECTED_SAMESITE,
    "STATELESS_CSRF": "true",
    "JWT_SECRET": "x" * 48,
    "CSRF_HMAC_SECRET": "y" * 48,
    "DOCUMENT_HMAC_SECRET": "z" * 48,
    "FRONTEND_ORIGINS": ",".join([FRONTEND_ORIGIN, *EXTRA_FRONTEND_ORIGINS]),
    "FRONTEND_URL": FRONTEND_ORIGIN,
    "GOOGLE_CLIENT_ID": "991003885757-855fmfqkh2mo6t73jf0ni1fmg4q1sqpr.apps.googleusercontent.com",
    "MONGO_URL": "mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority",
    "DB_NAME": "gestao_esportiva_escolar",
})

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

failures = []

try:
    import server
except SystemExit as exc:
    print(f"FALHOU no _validate_env_security: {exc}")
    raise SystemExit(1)

from lib.realtime import allowed_websocket_origin
from lib.security import COOKIE_SECURE, CSRF_SAMESITE, SESSION_SAMESITE

expected_csrf_samesite = "none" if EXPECTED_SAMESITE == "none" else "strict"

checks = [
    (f"SESSION_SAMESITE == '{EXPECTED_SAMESITE}'", SESSION_SAMESITE == EXPECTED_SAMESITE),
    (f"CSRF_SAMESITE == '{expected_csrf_samesite}'", CSRF_SAMESITE == expected_csrf_samesite),
    ("COOKIE_SECURE is True", COOKIE_SECURE is True),
    ("WS aceita origem do front", allowed_websocket_origin(FRONTEND_ORIGIN)),
    ("WS recusa origem desconhecida", not allowed_websocket_origin("https://evil.example.com")),
]

cors = [m for m in server.app.user_middleware if "CORS" in str(m.cls)]
if cors:
    origins = cors[0].kwargs.get("allow_origins", [])
    checks.append(("CORS inclui a origem do front", FRONTEND_ORIGIN in origins))
    checks.append(("CORS com credentials", cors[0].kwargs.get("allow_credentials") is True))
    checks.append(("CORS expõe X-CSRF-Token", "X-CSRF-Token" in cors[0].kwargs.get("expose_headers", [])))
else:
    checks.append(("CORS middleware presente", False))

def collect_paths(app) -> set[str]:
    """Rotas incluidas via include_router ficam em _IncludedRouter.original_router,
    nao em .path nem em .router. Nessa versao do FastAPI o path interno ja
    inclui o prefixo."""
    found: set[str] = set()
    for route in getattr(app, "routes", []):
        path = getattr(route, "path", None)
        if isinstance(path, str):
            found.add(path)
        nested = getattr(route, "original_router", None) or getattr(route, "router", None)
        for inner in getattr(nested, "routes", []) if nested is not None else []:
            inner_path = getattr(inner, "path", None)
            if isinstance(inner_path, str):
                # Nesta versao do FastAPI o caminho interno ja vem com o prefixo
                # aplicado ('/api/auth/login'), entao apenas o coletamos.
                found.add(inner_path)
    return found


routes = collect_paths(server.app)
for path in ("/api/health", "/api/auth/login", "/api/auth/google-login", "/api/auth/me"):
    checks.append((f"rota {path}", path in routes))

for label, ok in checks:
    print(f"{'OK  ' if ok else 'FALHA'} {label}")
    if not ok:
        failures.append(label)

print(f"\n{len(checks) - len(failures)}/{len(checks)} verificacoes passaram")
raise SystemExit(1 if failures else 0)
