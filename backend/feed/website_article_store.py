import sqlite3
import time
from pathlib import Path

from paths import DATA_DIR

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
        self.upsert_articles(
            feed_id,
            [
                {
                    "article_id": article_id,
                    "title": title,
                    "url": url,
                    "published_at": published_at,
                    "author": author,
                    "image": image,
                    "summary": summary,
                }
            ],
        )

    def upsert_articles(self, feed_id: str, rows: list[dict]) -> int:
        """同一事务批量写入；返回实际写入条数。"""
        if not rows:
            return 0
        now = time.time()
        values = [
            (
                feed_id,
                str(row.get("article_id") or ""),
                str(row.get("title") or ""),
                str(row.get("url") or ""),
                str(row.get("published_at") or ""),
                str(row.get("author") or ""),
                str(row.get("image") or ""),
                str(row.get("summary") or ""),
                now,
            )
            for row in rows
            if str(row.get("article_id") or "").strip()
        ]
        if not values:
            return 0
        with self._connect() as conn:
            conn.executemany(
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
                values,
            )
        return len(values)

    def article_ids(self, feed_id: str) -> set[str]:
        """一次取出该源全部 article_id，供刷新时内存去重。"""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT article_id FROM articles WHERE feed_id = ?",
                (feed_id,),
            ).fetchall()
        return {str(row["article_id"]) for row in rows if row["article_id"]}

    def has_article(self, feed_id: str, article_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM articles WHERE feed_id = ? AND article_id = ? LIMIT 1",
                (feed_id, article_id),
            ).fetchone()
        return row is not None

    def get_article(self, feed_id: str, article_id: str) -> dict | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT feed_id, article_id, title, url, published_at, author, image, summary
                FROM articles
                WHERE feed_id = ? AND article_id = ?
                LIMIT 1
                """,
                (feed_id, article_id),
            ).fetchone()
        return dict(row) if row else None

    def list_articles(self, feed_id: str, limit: int | None = None) -> list[dict]:
        with self._connect() as conn:
            if limit is None or limit <= 0:
                rows = conn.execute(
                    """
                    SELECT feed_id, article_id, title, url, published_at, author, image, summary
                    FROM articles
                    WHERE feed_id = ?
                    ORDER BY published_at DESC
                    """,
                    (feed_id,),
                ).fetchall()
            else:
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
