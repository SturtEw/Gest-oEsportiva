"""Rate limiting and account lockout utilities."""


import time


from pymongo import ReturnDocument
from lib.db import db


RATE_LIMIT_WINDOW = 60 * 15
RATE_LIMIT_MAX_ATTEMPTS = 10


LOCKOUT_DURATION = 60 * 30


MAX_FAILED_ATTEMPTS = 5



async def check_rate_limit(identifier: str) -> dict:
    """Check rate limit counter for identifier (email or IP).

    Only FAILED attempts are counted so successful logins never trigger rate limiting.
    """
    key = f"ratelimit:{identifier}"
    now = time.time()

    window_start = now - RATE_LIMIT_WINDOW

    # Remove old entries
    await db.auth_attempts.delete_many({"key": key, "timestamp": {"$lt": window_start}})

    attempts = await db.auth_attempts.count_documents({"key": key, "success": False})

    remaining = max(0, RATE_LIMIT_MAX_ATTEMPTS - attempts)

    blocked = attempts >= RATE_LIMIT_MAX_ATTEMPTS

    return {"blocked": blocked, "attempts": attempts, "remaining": remaining}



async def record_auth_attempt(identifier: str, success: bool) -> None:
    """Record an authentication attempt."""
    await db.auth_attempts.insert_one({
        "key": f"ratelimit:{identifier}",

        "identifier": identifier,

        "success": success,

        "timestamp": time.time(),

    })



async def check_account_lockout(email: str) -> dict:
    """Check if account is locked due to failed attempts."""
    user = await db.users.find_one({"email": email.lower()}, {"_id": 0, "id": 1, "locked_until": 1})
    if not user:
        return {"locked": False}

    locked_until = user.get("locked_until")

    if locked_until and locked_until > time.time():
        minutes = int((locked_until - time.time()) / 60) + 1

        return {"locked": True, "minutes": minutes}

    # Unlock if lockout expired
    if locked_until and locked_until <= time.time():
        await db.users.update_one({"id": user["id"]}, {"$unset": {"locked_until": 1}})

    return {"locked": False}



async def increment_failed_attempts(email: str) -> dict:
    """Atomically increment failed login attempts and lock account if threshold reached."""
    user = await db.users.find_one({"email": email.lower()}, {"_id": 0, "id": 1})
    if not user:
        return {"locked": False}

    result = await db.users.find_one_and_update(

        {"id": user["id"]},

        {"$inc": {"failed_attempts": 1}},

        return_document=ReturnDocument.AFTER,

    )

    if result is None:
        return {"locked": False}

    failed = result.get("failed_attempts", 1)

    if failed >= MAX_FAILED_ATTEMPTS:
        await db.users.update_one({"id": user["id"]}, {"$set": {"locked_until": time.time() + LOCKOUT_DURATION}})

        return {"locked": True, "minutes": LOCKOUT_DURATION // 60}

    return {"locked": False, "attempts": failed}



async def reset_failed_attempts(email: str) -> None:
    """Reset failed attempts on successful login."""
    await db.users.update_one(
        {"email": email.lower()},

        {"$unset": {"failed_attempts": 1}, "$set": {"locked_until": None}},

    )
