import json
import sqlite3
import time
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "digest_summaries.db"


def _cache_key(days: int, feed_ids: list[str] | None, group_ids: list[str] | None = None) -> str:
    if group_ids:
        return f"{days}:groups:{','.join(sorted(group_ids))}"
    ids = ",".join(sorted(feed_ids or []))
    return f"{days}:{ids}"


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
    ) -> None:
        text = summary.strip()
        if not text:
            return
        key = _cache_key(days, feed_ids, group_ids)
        now = time.time()
        refs_json = json.dumps(article_refs or [], ensure_ascii=False)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO digest_summaries (
                    cache_key, days, summary, article_count, truncated, updated_at, article_refs
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    summary = excluded.summary,
                    article_count = excluded.article_count,
                    truncated = excluded.truncated,
                    updated_at = excluded.updated_at,
                    article_refs = excluded.article_refs
                """,
                (key, days, text, article_count, 1 if truncated else 0, now, refs_json),
            )

    def get(self, days: int, feed_ids: list[str] | None = None, group_ids: list[str] | None = None) -> dict | None:
        key = _cache_key(days, feed_ids, group_ids)
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT summary, article_count, truncated, updated_at, article_refs
                FROM digest_summaries
                WHERE cache_key = ?
                """,
                (key,),
            ).fetchone()
        if row is None:
            return None
        refs_raw = row["article_refs"] if "article_refs" in row.keys() else "[]"
        try:
            article_refs = json.loads(refs_raw or "[]")
        except json.JSONDecodeError:
            article_refs = []
        return {
            "summary": row["summary"],
            "article_count": int(row["article_count"]),
            "truncated": bool(row["truncated"]),
            "updated_at": float(row["updated_at"]),
            "article_refs": article_refs if isinstance(article_refs, list) else [],
        }

    def delete(self, days: int, feed_ids: list[str] | None = None, group_ids: list[str] | None = None) -> None:
        key = _cache_key(days, feed_ids, group_ids)
        with self._connect() as conn:
            conn.execute("DELETE FROM digest_summaries WHERE cache_key = ?", (key,))


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
) -> None:
    _store.save(
        days,
        summary,
        feed_ids,
        group_ids=group_ids,
        article_count=article_count,
        truncated=truncated,
        article_refs=article_refs,
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
