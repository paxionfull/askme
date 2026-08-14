import sqlite3
import time
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "website_articles.db"


class WebsiteArticleStore:
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
                CREATE TABLE IF NOT EXISTS articles (
                    feed_id TEXT NOT NULL,
                    article_id TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT '',
                    url TEXT NOT NULL DEFAULT '',
                    published_at TEXT NOT NULL DEFAULT '',
                    author TEXT NOT NULL DEFAULT '',
                    image TEXT NOT NULL DEFAULT '',
                    summary TEXT NOT NULL DEFAULT '',
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (feed_id, article_id)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS feed_sync (
                    feed_id TEXT PRIMARY KEY,
                    last_sync_at REAL NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_website_articles_published "
                "ON articles(feed_id, published_at DESC)"
            )

    def upsert_article(
        self,
        feed_id: str,
        article_id: str,
        *,
        title: str,
        url: str,
        published_at: str,
        author: str = "",
        image: str = "",
        summary: str = "",
    ) -> None:
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO articles (
                    feed_id, article_id, title, url, published_at, author,
                    image, summary, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(feed_id, article_id) DO UPDATE SET
                    title = excluded.title,
                    url = excluded.url,
                    published_at = excluded.published_at,
                    author = excluded.author,
                    image = excluded.image,
                    summary = excluded.summary,
                    updated_at = excluded.updated_at
                """,
                (
                    feed_id,
                    article_id,
                    title,
                    url,
                    published_at,
                    author,
                    image,
                    summary,
                    now,
                ),
            )

    def list_articles(self, feed_id: str, limit: int = 20) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT feed_id, article_id, title, url, published_at, author, image, summary
                FROM articles
                WHERE feed_id = ?
                ORDER BY published_at DESC
                LIMIT ?
                """,
                (feed_id, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def count_articles(self, feed_id: str) -> int:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM articles WHERE feed_id = ?",
                (feed_id,),
            ).fetchone()
        return int(row["cnt"]) if row else 0

    def latest_published_at(self, feed_id: str) -> str:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT published_at FROM articles
                WHERE feed_id = ?
                ORDER BY published_at DESC
                LIMIT 1
                """,
                (feed_id,),
            ).fetchone()
        return row["published_at"] if row else ""

    def set_last_sync(self, feed_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO feed_sync (feed_id, last_sync_at) VALUES (?, ?)
                ON CONFLICT(feed_id) DO UPDATE SET last_sync_at = excluded.last_sync_at
                """,
                (feed_id, time.time()),
            )

    def get_last_sync(self, feed_id: str) -> float | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT last_sync_at FROM feed_sync WHERE feed_id = ?",
                (feed_id,),
            ).fetchone()
        return float(row["last_sync_at"]) if row else None
