"""Disk cache for director results.

A storyboard costs minutes of GPU on a T4, and re-running the same script
during development is the common case. Keyed on everything that changes the
answer, so a schema or model change misses rather than serving a stale shape.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from typing import Any, Optional

CACHE_DIR = os.environ.get("DIRECTOR_CACHE_DIR", "/tmp/director_cache")


def init_cache() -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)


def get_cache_key(script: str, style: str, model_id: str, schema_version: str, extra: str = "") -> str:
    payload = "|".join([script, style, model_id, schema_version, extra])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _path(cache_key: str) -> str:
    return os.path.join(CACHE_DIR, f"{cache_key}.json")


def get_cached_result(cache_key: str) -> Optional[Any]:
    try:
        with open(_path(cache_key), encoding="utf-8") as handle:
            return json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        # A half-written file from an interrupted run should miss, not crash.
        return None


def set_cached_result(cache_key: str, data: Any) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    # Write-then-rename so a reader never sees a partial file.
    fd, tmp = tempfile.mkstemp(dir=CACHE_DIR, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        os.replace(tmp, _path(cache_key))
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
