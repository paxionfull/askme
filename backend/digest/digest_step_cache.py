"""简报流水线中间结果缓存：同输入指纹 → 同 classify/cluster JSON。"""

from __future__ import annotations

from paths import DATA_DIR

import hashlib
import json
import sqlite3
import time
from pathlib import Path
from typing import Any

DB_PATH = DATA_DIR / "digest_step_cache.db"

STEP_CLASSIFY = "classify"
STEP_CLUSTER = "cluster"


def fingerprint_digest_input(
    profile: dict[str, Any],
    articles: list[dict[str, str]],
    *,
    step: str,
    extra: dict[str, Any] | None = None,
) -> str:
    """稳定指纹：profile + 文章列表（已排序）+ 步骤 + 额外上下文。"""
    payload = {
        "step": step,
        "profile": profile,
        "articles": articles,
        "extra": extra or {},
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class DigestStepCache:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or DB_PATH
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS digest_steps (
                    fingerprint TEXT PRIMARY KEY,
                    step TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at REAL NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_digest_steps_step ON digest_steps(step)"
            )

    def get(self, fingerprint: str) -> dict[str, Any] | None:
        key = (fingerprint or "").strip()
        if not key:
            return None
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload FROM digest_steps WHERE fingerprint = ?",
                (key,),
            ).fetchone()
        if row is None:
            return None
        try:
            data = json.loads(row["payload"] or "")
        except json.JSONDecodeError:
            return None
        return data if isinstance(data, dict) else None

    def set(self, fingerprint: str, step: str, payload: dict[str, Any]) -> None:
        key = (fingerprint or "").strip()
        if not key or not isinstance(payload, dict):
            return
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO digest_steps (fingerprint, step, payload, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(fingerprint) DO UPDATE SET
                    step = excluded.step,
                    payload = excluded.payload,
                    updated_at = excluded.updated_at
                """,
                (key, step, json.dumps(payload, ensure_ascii=False), time.time()),
            )

    def delete_older_than(self, cutoff_ts: float) -> int:
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM digest_steps WHERE updated_at < ?",
                (float(cutoff_ts),),
            )
            return int(cur.rowcount or 0)


_store = DigestStepCache()


def get_step(fingerprint: str) -> dict[str, Any] | None:
    return _store.get(fingerprint)


def set_step(fingerprint: str, step: str, payload: dict[str, Any]) -> None:
    _store.set(fingerprint, step, payload)
