"""One-time root-admin bootstrap. Read secrets only from the process environment.

Run with the backend environment loaded after installing requirements. The script
will refuse to change an existing root account; rotate credentials separately.

"""

import asyncio
import os
import sys
import uuid

# O diretorio do script (/app/scripts) e o unico que o Python poe no sys.path ao
# rodar `python scripts/bootstrap_root_admin.py`, deixando `lib` (em /app/lib)
# inacessivel e abortando com ModuleNotFoundError. Inserir o pai do script torna
# as duas formas de invocacao validas (script direto e `python -m scripts.…`).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lib.dates import now_utc
from lib.db import db, MongoManager
from lib.security import hash_password

async def main() -> None:
    email = os.environ.get("ROOT_ADMIN_EMAIL", "").strip().lower()

    password = os.environ.get("ROOT_ADMIN_PASSWORD") or os.environ.get("ROOT_ADMIN_INITIAL_PASSWORD", "")

    if not email or len(password) < 12:
        raise SystemExit("Configure ROOT_ADMIN_EMAIL and ROOT_ADMIN_PASSWORD (minimum 12 characters) privately.")

    if not os.environ.get("JWT_SECRET") or os.environ.get("JWT_SECRET") == "dev-insecure-secret":
        raise SystemExit("Configure a unique JWT_SECRET before bootstrapping the root administrator.")

    existing = await db.users.find_one({"$or": [{"is_root_admin": True}, {"email": email}]}, {"_id": 0, "id": 1})

    if existing:
        raise SystemExit("An admin account already exists for this identity; refusing to overwrite it.")

    await db.users.insert_one({

        "id": str(uuid.uuid4()),

        "nome": os.environ.get("ROOT_ADMIN_NAME", "Administrador raiz"),

        "email": email,

        "senha_hash": hash_password(password),

        "google_sub": None,

        "tipo": "admin",

        "aluno_id": None,

        "status": "ativo",

        "telefone": None,

        "filhos_ids": [],

        "is_root_admin": True,

        "email_verified": True,

        "dataCriacao": now_utc(),

    })

    print("Root administrator created with a password hash. Remove the bootstrap secrets from the environment after use.")

    await MongoManager.get_instance().close()

    # Remove root credentials from process environment after use
    if "ROOT_ADMIN_PASSWORD" in os.environ:
        del os.environ["ROOT_ADMIN_PASSWORD"]

    if "ROOT_ADMIN_INITIAL_PASSWORD" in os.environ:
        del os.environ["ROOT_ADMIN_INITIAL_PASSWORD"]


if __name__ == "__main__":
    asyncio.run(main())
