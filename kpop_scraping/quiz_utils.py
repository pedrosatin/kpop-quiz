"""Deterministic hashing helpers shared by quiz modules."""

from __future__ import annotations

import hashlib
from typing import Any

from .storage import canonical_json


def hash_payload(payload: Any) -> str:
    return hashlib.sha256(canonical_json(payload)).hexdigest()


def digest(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()

