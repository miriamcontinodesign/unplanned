"""Single-process task store, JSON-file persisted, plus an in-memory TTL cache.

Deliberately not a database. One uvicorn worker, one file, atomic writes.

The TTL cache is separate from the store on purpose: Stay22's terms forbid
cold-storing their listings, so search payloads live here in memory and never
reach store.json. Only the property details an advisor confirmed get persisted.
"""

from __future__ import annotations

import json
import os
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STORE_PATH = Path(__file__).parent / "store.json"

TASKS: dict[str, dict[str, Any]] = {}


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def new_task_id() -> str:
    return f"t_{secrets.token_hex(3)}"


def load() -> None:
    """Read store.json into TASKS. Missing or corrupt file starts empty."""
    TASKS.clear()
    if not STORE_PATH.exists():
        return
    try:
        raw = STORE_PATH.read_text(encoding="utf-8").lstrip("﻿")
        data = json.loads(raw)
    except (json.JSONDecodeError, OSError) as exc:
        # A corrupt store must not stop the app from booting mid-demo.
        print(f"[store] could not read {STORE_PATH.name}: {exc}. Starting empty.")
        return
    if isinstance(data, dict):
        TASKS.update(data)


def save() -> None:
    """Write TASKS atomically as BOM-less UTF-8."""
    tmp = STORE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(TASKS, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, STORE_PATH)


def get(task_id: str) -> dict[str, Any] | None:
    return TASKS.get(task_id)


def put(task: dict[str, Any]) -> dict[str, Any]:
    TASKS[task["id"]] = task
    save()
    return task


def listed() -> list[dict[str, Any]]:
    """Newest first."""
    return sorted(TASKS.values(), key=lambda t: t.get("created_at", ""), reverse=True)


def set_status(task_id: str, status: str) -> None:
    task = TASKS.get(task_id)
    if task is None:
        return
    task["status"] = status
    save()


def append_transcript(task_id: str, role: str, text: str, ts: float) -> None:
    task = TASKS.get(task_id)
    if task is None:
        return
    task.setdefault("transcript", []).append({"role": role, "text": text, "ts": ts})
    save()


class TTLCache:
    """Tiny in-memory cache. Keeps stale entries so a 429 can still be served."""

    def __init__(self, ttl_seconds: float = 600.0) -> None:
        self._ttl = ttl_seconds
        self._data: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        entry = self._data.get(key)
        if entry is None:
            return None
        stored_at, value = entry
        if time.monotonic() - stored_at > self._ttl:
            return None
        return value

    def get_stale(self, key: str) -> Any | None:
        """Ignore expiry. For serving something rather than nothing on a 429."""
        entry = self._data.get(key)
        return None if entry is None else entry[1]

    def set(self, key: str, value: Any) -> None:
        self._data[key] = (time.monotonic(), value)
