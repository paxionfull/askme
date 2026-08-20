from paths import DATA_DIR

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

DB_PATH = DATA_DIR / "digest_summaries.db"


def _cache_key(days: int, feed_ids: list[str] | None, group_ids: list[str] | None = None) -> str:
    if group_ids:
        return f"{days}:groups:{','.join(sorted(group_ids))}"
    ids = ",".join(sorted(feed_ids or []))
    return f"{days}:{ids}"


def _parse_cache_key(cache_key: str) -> dict[str, Any]:
    parts = cache_key.split(":", 2)
    days = int(parts[0]) if parts and parts[0].isdigit() else 1
    if len(parts) >= 3 and parts[1] == "groups":
        group_ids = [gid for gid in parts[2].split(",") if gid]
        return {"days": days, "feed_ids": [], "group_ids": group_ids}
    feed_ids = [fid for fid in (parts[1].split(",") if len(parts) > 1 else []) if fid]
    return {"days": days, "feed_ids": feed_ids, "group_ids": []}


class DigestSummaryStore:
    def __init__(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS digest_summaries (
                    cache_key TEXT PRIMARY KEY,
                    days INTEGER NOT NULL,
                    summary TEXT NOT NULL,
                    article_count INTEGER NOT NULL DEFAULT 0,
                    truncated INTEGER NOT NULL DEFAULT 0,
                    updated_at REAL NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_digest_summaries_days ON digest_summaries(days)"
            )
            columns = {
                row["name"]
                for row in conn.execute("PRAGMA table_info(digest_summaries)").fetchall()
            }
            if "article_refs" not in columns:
                conn.execute(
                    "ALTER TABLE digest_summaries ADD COLUMN article_refs TEXT NOT NULL DEFAULT '[]'"
                )
            if "digest_tree" not in columns:
                conn.execute(
                    "ALTER TABLE digest_summaries ADD COLUMN digest_tree TEXT NOT NULL DEFAULT ''"
                )

    def save(
        self,
        days: int,
        summary: str,
        feed_ids: list[str] | None = None,
        *,
        group_ids: list[str] | None = None,
        article_count: int = 0,
        truncated: bool = False,
        article_refs: list[dict[str, str]] | None = None,
        digest_tree: dict[str, Any] | None = None,
    ) -> None:
        text = summary.strip()
        if not text:
            return
        key = _cache_key(days, feed_ids, group_ids)
        now = time.time()
        refs_json = json.dumps(article_refs or [], ensure_ascii=False)
        tree_json = json.dumps(digest_tree, ensure_ascii=False) if digest_tree else ""
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO digest_summaries (
                    cache_key, days, summary, article_count, truncated, updated_at,
                    article_refs, digest_tree
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    summary = excluded.summary,
                    article_count = excluded.article_count,
                    truncated = excluded.truncated,
                    updated_at = excluded.updated_at,
                    article_refs = excluded.article_refs,
                    digest_tree = excluded.digest_tree
                """,
                (key, days, text, article_count, 1 if truncated else 0, now, refs_json, tree_json),
            )

    def get(self, days: int, feed_ids: list[str] | None = None, group_ids: list[str] | None = None) -> dict | None:
        key = _cache_key(days, feed_ids, group_ids)
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT summary, article_count, truncated, updated_at, article_refs, digest_tree
                FROM digest_summaries
                WHERE cache_key = ?
                """,
                (key,),
            ).fetchone()
        if row is None:
            return None
        keys = set(row.keys())
        refs_raw = row["article_refs"] if "article_refs" in keys else "[]"
        try:
            article_refs = json.loads(refs_raw or "[]")
        except json.JSONDecodeError:
            article_refs = []

        digest_tree = None
        tree_raw = row["digest_tree"] if "digest_tree" in keys else ""
        if tree_raw:
            try:
                parsed = json.loads(tree_raw)
                if isinstance(parsed, dict):
                    digest_tree = parsed
            except json.JSONDecodeError:
                digest_tree = None

        return {
            "summary": row["summary"],
            "article_count": int(row["article_count"]),
            "truncated": bool(row["truncated"]),
            "updated_at": float(row["updated_at"]),
            "article_refs": article_refs if isinstance(article_refs, list) else [],
            "digest_tree": digest_tree,
        }

    def delete(self, days: int, feed_ids: list[str] | None = None, group_ids: list[str] | None = None) -> None:
        key = _cache_key(days, feed_ids, group_ids)
        with self._connect() as conn:
            conn.execute("DELETE FROM digest_summaries WHERE cache_key = ?", (key,))

    def delete_older_than(self, cutoff_ts: float) -> int:
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM digest_summaries WHERE updated_at < ?",
                (float(cutoff_ts),),
            )
            return int(cur.rowcount or 0)

    def list_entries(self, *, limit: int = 100, offset: int = 0) -> tuple[list[dict[str, Any]], int]:
        safe_limit = max(1, min(int(limit), 200))
        safe_offset = max(0, int(offset))
        with self._connect() as conn:
            total_row = conn.execute("SELECT COUNT(*) AS c FROM digest_summaries").fetchone()
            total = int(total_row["c"] if total_row else 0)
            rows = conn.execute(
                """
                SELECT cache_key, days, summary, article_count, truncated, updated_at, article_refs
                FROM digest_summaries
                ORDER BY updated_at DESC
                LIMIT ? OFFSET ?
                """,
                (safe_limit, safe_offset),
            ).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            keys = set(row.keys())
            refs_raw = row["article_refs"] if "article_refs" in keys else "[]"
            try:
                article_refs = json.loads(refs_raw or "[]")
            except json.JSONDecodeError:
                article_refs = []
            if not isinstance(article_refs, list):
                article_refs = []
            scope = _parse_cache_key(str(row["cache_key"]))
            items.append(
                {
                    "cache_key": row["cache_key"],
                    "days": int(row["days"]),
                    "summary": row["summary"],
                    "article_count": int(row["article_count"]),
                    "truncated": bool(row["truncated"]),
                    "updated_at": float(row["updated_at"]),
                    "article_refs": article_refs,
                    "feed_ids": scope["feed_ids"],
                    "group_ids": scope["group_ids"],
                }
            )
        return items, total


_store = DigestSummaryStore()


def set_summary(
    days: int,
    summary: str,
    feed_ids: list[str] | None = None,
    *,
    group_ids: list[str] | None = None,
    article_count: int = 0,
    truncated: bool = False,
    article_refs: list[dict[str, str]] | None = None,
    digest_tree: dict[str, Any] | None = None,
) -> None:
    _store.save(
        days,
        summary,
        feed_ids,
        group_ids=group_ids,
        article_count=article_count,
        truncated=truncated,
        article_refs=article_refs,
        digest_tree=digest_tree,
    )


def get_summary(days: int, feed_ids: list[str] | None = None, group_ids: list[str] | None = None) -> str:
    entry = _store.get(days, feed_ids, group_ids)
    return entry["summary"] if entry else ""


def get_summary_entry(
    days: int,
    feed_ids: list[str] | None = None,
    group_ids: list[str] | None = None,
) -> dict | None:
    return _store.get(days, feed_ids, group_ids)


def delete_summary(
    days: int,
    feed_ids: list[str] | None = None,
    group_ids: list[str] | None = None,
) -> None:
    _store.delete(days, feed_ids, group_ids)


def list_summary_entries(*, limit: int = 100, offset: int = 0) -> tuple[list[dict[str, Any]], int]:
    return _store.list_entries(limit=limit, offset=offset)
