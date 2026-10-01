"""Server-side date helpers. The pod clock is UTC — anchor "today" here, never in the browser.

Invariants enforced by this module (the rest of the backend must go through it):

1. Every instant is stored/read as an **aware** UTC ``datetime``. Naive datetimes are

   the root cause of the cascading timestamp bugs: a naive value serialised by FastAPI

   carries no offset, and ``new Date()`` in the browser reads it as *local* time,

   shifting every timestamp by the APP_TZ offset.

2. Every **calendar date** ("today", class day, date of birth) is resolved in APP_TZ,

   never in UTC and never in the browser. At 21:00 in São Paulo UTC has already rolled

   over to the next day, so ``date.today()`` on a UTC pod rejects valid births and

   hides the current day's attendance.

3. Wire format is always ISO-8601 **with** the ``Z``/offset suffix.

"""

from __future__ import annotations


import os
from datetime import date, datetime, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


UTC = timezone.utc
_FALLBACK_TZ = "UTC"


_TZ_CACHE: dict[str, tzinfo] = {}



def _load_zone(name: str) -> tzinfo | None:
    """Resolve an IANA zone, or None when the platform has no tz database.

    Slim containers and Windows installs without the ``tzdata`` package raise here
    instead of returning UTC. Callers must treat None as "no local zone available"

    rather than letting a timezone error become a 500.

    """
    if name in _TZ_CACHE:
        return _TZ_CACHE[name]

    try:
        zone: tzinfo = ZoneInfo(name)

    except (ZoneInfoNotFoundError, ValueError, KeyError, OSError):
        return None

    _TZ_CACHE[name] = zone

    return zone



def app_tz() -> tzinfo:
    """The school timezone from APP_TZ, falling back to UTC when unavailable.

    Never raises: a missing tz database must degrade to UTC, not break the API.
    """
    configured = os.environ.get("APP_TZ") or _FALLBACK_TZ
    return _load_zone(configured) or _load_zone(_FALLBACK_TZ) or UTC



def now_utc() -> datetime:
    """Current instant as an aware UTC datetime. Use this instead of datetime.now()."""
    return datetime.now(UTC)


def ensure_aware(value: datetime) -> datetime:
    """Attach UTC to naive datetimes from the driver; convert aware ones.

    BSON dates are stored as UTC. When the driver hands them back naive, every later
    ``.isoformat()`` silently drops the offset — normalise at the boundary instead of

    guessing at each call site.

    """
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)

    return value.astimezone(UTC)



def to_iso(value: datetime | None) -> str | None:
    """Aware-UTC ISO-8601 string (or None) — the only shape we put on the wire."""
    return ensure_aware(value).isoformat() if isinstance(value, datetime) else None


def today_in_app_tz() -> date:
    """Today's calendar date as seen by the school, not by the UTC pod."""
    return datetime.now(app_tz()).date()


def today_iso(tz: str | None = None) -> str:
    """Today's date as YYYY-MM-DD in `tz` (default: APP_TZ env, else UTC)."""
    if tz is None:
        return today_in_app_tz().isoformat()

    zone = _load_zone(tz) or app_tz()

    return datetime.now(zone).date().isoformat()
