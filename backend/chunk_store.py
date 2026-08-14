import json
import sqlite3
import time
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "article_chunks.db"


class ChunkStore:
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
                CREATE TABLE IF NOT EXISTS article_chunks (
                    id TEXT PRIMARY KEY,
                    feed_id TEXT NOT NULL,
                    article_id TEXT NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    char_start INTEGER NOT NULL DEFAULT 0,
                    title TEXT NOT NULL DEFAULT '',
                    feed_name TEXT NOT NULL DEFAULT '',
                    published_at TEXT NOT NULL DEFAULT '',
                    url TEXT NOT NULL DEFAULT '',
                    embedding TEXT NOT NULL DEFAULT '[]',
                    content_hash TEXT NOT NULL DEFAULT '',
                    updated_at REAL NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_article_chunks_feed_article ON article_chunks(feed_id, article_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_article_chunks_published_at ON article_chunks(published_at)"
            )

    def delete_by_article(self, feed_id: str, article_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM article_chunks WHERE feed_id = ? AND article_id = ?",
                (feed_id, article_id),
            )

    def get_content_hash(self, feed_id: str, article_id: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT content_hash FROM article_chunks
                WHERE feed_id = ? AND article_id = ?
                LIMIT 1
                """,
                (feed_id, article_id),
            ).fetchone()
        if row is None:
            return None
        return row["content_hash"]

    def upsert_chunks(self, chunks: list[dict]) -> None:
        if not chunks:
            return
        now = time.time()
        with self._connect() as conn:
            for chunk in chunks:
                conn.execute(
                    """
                    INSERT INTO article_chunks (
                        id, feed_id, article_id, chunk_index, text, char_start,
                        title, feed_name, published_at, url, embedding, content_hash, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        text = excluded.text,
                        char_start = excluded.char_start,
                        title = excluded.title,
                        feed_name = excluded.feed_name,
                        published_at = excluded.published_at,
                        url = excluded.url,
                        embedding = excluded.embedding,
                        content_hash = excluded.content_hash,
                        updated_at = excluded.updated_at
                    """,
                    (
                        chunk["id"],
                        chunk["feed_id"],
                        chunk["article_id"],
                        chunk["chunk_index"],
                        chunk["text"],
                        chunk["char_start"],
                        chunk.get("title", ""),
                        chunk.get("feed_name", ""),
                        chunk.get("published_at", ""),
                        chunk.get("url", ""),
                        json.dumps(chunk.get("embedding", [])),
                        chunk.get("content_hash", ""),
                        now,
                    ),
                )

    def list_in_scope(
        self,
        cutoff_iso: str,
        feed_ids: list[str] | None = None,
    ) -> list[dict]:
        query = """
            SELECT id, feed_id, article_id, chunk_index, text, char_start,
                   title, feed_name, published_at, url, embedding
            FROM article_chunks
            WHERE published_at >= ? AND embedding != '[]' AND embedding != ''
        """
        params: list[str | list[str]] = [cutoff_iso]
        if feed_ids:
            placeholders = ",".join("?" for _ in feed_ids)
            query += f" AND feed_id IN ({placeholders})"
            params.extend(feed_ids)
        query += " ORDER BY published_at DESC"
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        result: list[dict] = []
        for row in rows:
            item = dict(row)
            item["embedding"] = json.loads(item.get("embedding") or "[]")
            result.append(item)
        return result

    def count_in_scope(self, cutoff_iso: str, feed_ids: list[str] | None = None) -> int:
        query = """
            SELECT COUNT(*) AS cnt FROM article_chunks
            WHERE published_at >= ? AND embedding != '[]' AND embedding != ''
        """
        params: list[str] = [cutoff_iso]
        if feed_ids:
            placeholders = ",".join("?" for _ in feed_ids)
            query += f" AND feed_id IN ({placeholders})"
            params.extend(feed_ids)
        with self._connect() as conn:
            row = conn.execute(query, params).fetchone()
        return int(row["cnt"]) if row else 0

    def get_by_id(self, chunk_id: str) -> dict | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, feed_id, article_id, chunk_index, text, char_start,
                       title, feed_name, published_at, url, embedding
                FROM article_chunks WHERE id = ?
                """,
                (chunk_id,),
            ).fetchone()
        if row is None:
            return None
        item = dict(row)
        item["embedding"] = json.loads(item.get("embedding") or "[]")
        return item
