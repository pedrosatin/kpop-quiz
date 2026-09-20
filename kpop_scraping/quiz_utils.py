"""Deterministic hashing helpers shared by quiz modules."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from .storage import canonical_json


def hash_payload(payload: Any) -> str:
    return hashlib.sha256(canonical_json(payload)).hexdigest()


def digest(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


def reference_date_today() -> str:
    """Return today as ISO YYYY-MM-DD in America/Sao_Paulo, falling back to UTC."""
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo("America/Sao_Paulo")).date().isoformat()
    except Exception:
        return datetime.now(timezone.utc).date().isoformat()

