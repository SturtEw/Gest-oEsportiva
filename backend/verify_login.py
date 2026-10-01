import asyncio
import os
from lib.db import db, MongoManager
from lib.security import hash_password, verify_password


async def check():
    email = os.environ.get("ROOT_ADMIN_EMAIL", "").strip().lower()

    if not email:
        print("Configure ROOT_ADMIN_EMAIL antes de verificar.")

        return

    result = await db.users.find_one({"is_root_admin": True}, {"_id": 0, "email": 1, "senha_hash": 1, "tipo": 1, "is_root_admin": 1, "status": 1})

    print("Admin found in DB:", result)

    if result and result.get("senha_hash"):
        test_password = os.environ.get("ROOT_ADMIN_TEST_PASSWORD", "")

        if test_password:
            match = verify_password(test_password, result["senha_hash"])

            print(f"Test password matches hash: {match}")

        else:
            print("Configure ROOT_ADMIN_TEST_PASSWORD para testar.")

    hashed = hash_password(os.environ.get("ROOT_ADMIN_TEST_PASSWORD", ""))

    print(f"Fresh hash of test password: {hashed}")

    print(f"Verify test against fresh: {verify_password(os.environ.get('ROOT_ADMIN_TEST_PASSWORD', ''), hashed)}")

    await MongoManager.get_instance().close()


asyncio.run(check())
