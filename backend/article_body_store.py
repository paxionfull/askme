import sqlite3
import time
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
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

    def get(self, feed_id: str, article_id: str) -> dict | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT feed_id, article_id, content_html, plain_text, title, url,
                       published_at, feed_name, cached_at
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
        title: str = "",
        url: str = "",
        published_at: str = "",
        feed_name: str = "",
    ) -> None:
        if not plain_text.strip() and not content_html.strip():
            return
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO article_bodies (
                    feed_id, article_id, content_html, plain_text, title, url,
                    published_at, feed_name, cached_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(feed_id, article_id) DO UPDATE SET
                    content_html = excluded.content_html,
                    plain_text = excluded.plain_text,
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
                    title,
                    url,
                    published_at,
                    feed_name,
                    time.time(),
                ),
            )
