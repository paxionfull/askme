from paths import DATA_DIR

import sqlite3
import time
from pathlib import Path

DB_PATH = DATA_DIR / "article_bodies.db"


class ArticleBodyStore:
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
                CREATE TABLE IF NOT EXISTS article_bodies (
                    feed_id TEXT NOT NULL,
                    article_id TEXT NOT NULL,
                    content_html TEXT NOT NULL DEFAULT '',
                    plain_text TEXT NOT NULL DEFAULT '',
                    body_status TEXT NOT NULL DEFAULT 'ok',
                    body_detail TEXT NOT NULL DEFAULT '',
                    title TEXT NOT NULL DEFAULT '',
                    url TEXT NOT NULL DEFAULT '',
                    published_at TEXT NOT NULL DEFAULT '',
                    feed_name TEXT NOT NULL DEFAULT '',
                    cached_at REAL NOT NULL,
                    PRIMARY KEY (feed_id, article_id)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_article_bodies_cached_at ON article_bodies(cached_at)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_article_bodies_url ON article_bodies(url)"
            )
            columns = {
                row["name"] for row in conn.execute("PRAGMA table_info(article_bodies)").fetchall()
            }
            if "body_status" not in columns:
                conn.execute(
                    "ALTER TABLE article_bodies ADD COLUMN body_status TEXT NOT NULL DEFAULT 'ok'"
                )
            if "body_detail" not in columns:
                conn.execute(
                    "ALTER TABLE article_bodies ADD COLUMN body_detail TEXT NOT NULL DEFAULT ''"
                )

    def find_by_url(self, url: str) -> dict | None:
        raw = url.strip()
        if not raw:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT feed_id, article_id, content_html, plain_text, title, url,
                       published_at, feed_name, body_status, body_detail, cached_at
                FROM article_bodies
                WHERE url = ? AND plain_text != ''
                LIMIT 1
                """,
                (raw,),
            ).fetchone()
            if row:
                return dict(row)
            row = conn.execute(
                """
                SELECT feed_id, article_id, content_html, plain_text, title, url,
                       published_at, feed_name, body_status, body_detail, cached_at
                FROM article_bodies
                WHERE plain_text != '' AND (
                    lower(replace(replace(url, '://www.', '://'), 'https://', 'http://')) =
                    lower(replace(replace(?, '://www.', '://'), 'https://', 'http://'))
                )
                LIMIT 1
                """,
                (raw,),
            ).fetchone()
        return dict(row) if row else None

    def find_by_title(self, title: str) -> dict | None:
        text = title.strip()
        if not text:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT feed_id, article_id, content_html, plain_text, title, url,
                       published_at, feed_name, body_status, body_detail, cached_at
                FROM article_bodies
                WHERE title = ? AND plain_text != ''
                LIMIT 1
                """,
                (text,),
            ).fetchone()
        return dict(row) if row else None

    def get(self, feed_id: str, article_id: str) -> dict | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT feed_id, article_id, content_html, plain_text, title, url,
                       published_at, feed_name, body_status, body_detail, cached_at
                FROM article_bodies
                WHERE feed_id = ? AND article_id = ?
                """,
                (feed_id, article_id),
            ).fetchone()
        if row is None:
            return None
        return dict(row)

    def has_body(self, feed_id: str, article_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT 1 FROM article_bodies
                WHERE feed_id = ? AND article_id = ? AND plain_text != ''
                """,
                (feed_id, article_id),
            ).fetchone()
        return row is not None

    def body_ids_with_text(self, feed_id: str) -> set[str]:
        """一次取出该源已有正文的 article_id，供批量 enrich 跳过网络请求。"""
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT article_id FROM article_bodies
                WHERE feed_id = ? AND plain_text != ''
                """,
                (feed_id,),
            ).fetchall()
        return {str(row["article_id"]) for row in rows if row["article_id"]}

    def delete(self, feed_id: str, article_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM article_bodies WHERE feed_id = ? AND article_id = ?",
                (feed_id, article_id),
            )

    def delete_feed(self, feed_id: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM article_bodies WHERE feed_id = ?", (feed_id,))

    def save(
        self,
        feed_id: str,
        article_id: str,
        *,
        content_html: str,
        plain_text: str,
        body_status: str = "ok",
        body_detail: str = "",
        title: str = "",
        url: str = "",
        published_at: str = "",
        feed_name: str = "",
    ) -> None:
        if not plain_text.strip() and not content_html.strip() and body_status == "ok":
            return
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO article_bodies (
                    feed_id, article_id, content_html, plain_text, body_status, body_detail, title, url,
                    published_at, feed_name, cached_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(feed_id, article_id) DO UPDATE SET
                    content_html = excluded.content_html,
                    plain_text = excluded.plain_text,
                    body_status = excluded.body_status,
                    body_detail = excluded.body_detail,
                    title = excluded.title,
                    url = excluded.url,
                    published_at = excluded.published_at,
                    feed_name = excluded.feed_name,
                    cached_at = excluded.cached_at
                """,
                (
                    feed_id,
                    article_id,
                    content_html,
                    plain_text,
                    body_status,
                    body_detail,
                    title,
                    url,
                    published_at,
                    feed_name,
                    time.time(),
                ),
            )
