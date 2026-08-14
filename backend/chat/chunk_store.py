from paths import DATA_DIR

import json
import logging
import sqlite3
import struct
import time
from urllib.parse import urlparse, urlunparse

DB_PATH = DATA_DIR / "article_chunks.db"
logger = logging.getLogger(__name__)

# 有有效 embedding：float32 BLOB（≥1 维）或旧版 JSON 文本数组
_HAS_EMBEDDING_SQL = (
    "(typeof(embedding) = 'blob' AND length(embedding) >= 4)"
    " OR (typeof(embedding) = 'text' AND length(embedding) > 2 AND embedding != '[]')"
)


def encode_embedding(values: list[float] | None) -> bytes:
    """list[float] → little-endian float32 bytes。"""
    if not values:
        return b""
    return struct.pack(f"<{len(values)}f", *[float(x) for x in values])


def decode_embedding(raw: object) -> list[float]:
    """兼容 float32 BLOB 与旧版 JSON 文本。"""
    if raw is None:
        return []
    if isinstance(raw, memoryview):
        raw = raw.tobytes()
    if isinstance(raw, bytearray):
        raw = bytes(raw)
    if isinstance(raw, bytes):
        if not raw:
            return []
        # 旧数据偶发以 UTF-8 JSON bytes 存入
        if raw[:1] in (b"[", b" ") or raw[:1] == b"\t":
            try:
                data = json.loads(raw.decode("utf-8"))
                if isinstance(data, list):
                    return [float(x) for x in data]
            except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
                pass
        if len(raw) % 4 != 0:
            return []
        n = len(raw) // 4
        return list(struct.unpack(f"<{n}f", raw))
    if isinstance(raw, str):
        text = raw.strip()
        if not text or text == "[]":
            return []
        try:
            data = json.loads(text)
            if isinstance(data, list):
                return [float(x) for x in data]
        except (json.JSONDecodeError, TypeError, ValueError):
            return []
    return []


def _normalize_url(url: str) -> str:
    raw = url.strip()
    if not raw:
        return ""
    try:
        parsed = urlparse(raw)
        host = parsed.hostname.lower().removeprefix("www.") if parsed.hostname else ""
        path = parsed.path.rstrip("/") or "/"
        return urlunparse((parsed.scheme.lower(), host, path, "", parsed.query, ""))
    except Exception:
        return raw.lower()


class ChunkStore:
    def __init__(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

    def _migrate_embeddings_to_blob(self, conn: sqlite3.Connection) -> int:
        """把仍为 JSON 文本的 embedding 转成 float32 BLOB。返回转换行数。"""
        rows = conn.execute(
            """
            SELECT id, embedding FROM article_chunks
            WHERE typeof(embedding) = 'text'
               OR (typeof(embedding) = 'blob' AND length(embedding) > 0
                   AND substr(embedding, 1, 1) = X'5B')
            """
        ).fetchall()
        if not rows:
            return 0

        converted = 0
        for row in rows:
            values = decode_embedding(row["embedding"])
            blob = encode_embedding(values)
            conn.execute(
                "UPDATE article_chunks SET embedding = ? WHERE id = ?",
                (blob, row["id"]),
            )
            converted += 1
        logger.info("article_chunks: migrated %s embeddings to float32 blob", converted)
        return converted

    def _vacuum(self) -> None:
        """VACUUM 须在事务外执行。"""
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute("VACUUM")
        except sqlite3.Error as exc:
            logger.warning("article_chunks VACUUM skipped: %s", exc)
        finally:
            conn.close()

    def _init_db(self) -> None:
        converted = 0
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
                    embedding BLOB NOT NULL DEFAULT X'',
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
            converted = self._migrate_embeddings_to_blob(conn)
        if converted:
            self._vacuum()

    def delete_by_article(self, feed_id: str, article_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM article_chunks WHERE feed_id = ? AND article_id = ?",
                (feed_id, article_id),
            )

    def delete_older_than(self, cutoff) -> int:
        """删除早于 cutoff 的分块与 embedding（优先 published_at，否则 updated_at）。"""
        from core.time_scope import parse_publish_time

        cutoff_ts = cutoff.timestamp()
        deleted = 0
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, published_at, updated_at FROM article_chunks"
            ).fetchall()
            stale_ids: list[str] = []
            for row in rows:
                pub = parse_publish_time(str(row["published_at"] or ""))
                if pub is not None:
                    stale = pub < cutoff
                else:
                    updated = float(row["updated_at"] or 0)
                    stale = updated > 0 and updated < cutoff_ts
                if stale:
                    stale_ids.append(str(row["id"]))
            for chunk_id in stale_ids:
                conn.execute("DELETE FROM article_chunks WHERE id = ?", (chunk_id,))
            deleted = len(stale_ids)
        return deleted

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
                        encode_embedding(chunk.get("embedding") or []),
                        chunk.get("content_hash", ""),
                        now,
                    ),
                )

    def list_in_scope(
        self,
        cutoff_iso: str,
        feed_ids: list[str] | None = None,
        article_pairs: list[tuple[str, str]] | None = None,
    ) -> list[dict]:
        scoped = bool(article_pairs)
        if scoped:
            query = f"""
                SELECT id, feed_id, article_id, chunk_index, text, char_start,
                       title, feed_name, published_at, url, embedding
                FROM article_chunks
                WHERE {_HAS_EMBEDDING_SQL}
            """
            params: list[str] = []
        else:
            query = f"""
                SELECT id, feed_id, article_id, chunk_index, text, char_start,
                       title, feed_name, published_at, url, embedding
                FROM article_chunks
                WHERE published_at >= ? AND {_HAS_EMBEDDING_SQL}
            """
            params = [cutoff_iso]
        if feed_ids:
            placeholders = ",".join("?" for _ in feed_ids)
            query += f" AND feed_id IN ({placeholders})"
            params.extend(feed_ids)
        if article_pairs:
            pair_clauses = " OR ".join("(feed_id = ? AND article_id = ?)" for _ in article_pairs)
            query += f" AND ({pair_clauses})"
            for feed_id, article_id in article_pairs:
                params.extend([feed_id, article_id])
        query += " ORDER BY published_at DESC"
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        result: list[dict] = []
        for row in rows:
            item = dict(row)
            item["embedding"] = decode_embedding(item.get("embedding"))
            result.append(item)
        return result

    def count_in_scope(
        self,
        cutoff_iso: str,
        feed_ids: list[str] | None = None,
        article_pairs: list[tuple[str, str]] | None = None,
    ) -> int:
        scoped = bool(article_pairs)
        if scoped:
            query = f"""
                SELECT COUNT(*) AS cnt FROM article_chunks
                WHERE {_HAS_EMBEDDING_SQL}
            """
            params: list[str] = []
        else:
            query = f"""
                SELECT COUNT(*) AS cnt FROM article_chunks
                WHERE published_at >= ? AND {_HAS_EMBEDDING_SQL}
            """
            params = [cutoff_iso]
        if feed_ids:
            placeholders = ",".join("?" for _ in feed_ids)
            query += f" AND feed_id IN ({placeholders})"
            params.extend(feed_ids)
        if article_pairs:
            pair_clauses = " OR ".join("(feed_id = ? AND article_id = ?)" for _ in article_pairs)
            query += f" AND ({pair_clauses})"
            for feed_id, article_id in article_pairs:
                params.extend([feed_id, article_id])
        with self._connect() as conn:
            row = conn.execute(query, params).fetchone()
        return int(row["cnt"]) if row else 0

    def find_article_pair_by_url(self, url: str) -> tuple[str, str] | None:
        raw = url.strip()
        if not raw:
            return None
        candidates = [raw, _normalize_url(raw)]
        seen: set[str] = set()
        with self._connect() as conn:
            for candidate in candidates:
                if not candidate or candidate in seen:
                    continue
                seen.add(candidate)
                row = conn.execute(
                    f"""
                    SELECT feed_id, article_id FROM article_chunks
                    WHERE url = ? AND {_HAS_EMBEDDING_SQL}
                    LIMIT 1
                    """,
                    (candidate,),
                ).fetchone()
                if row:
                    return row["feed_id"], row["article_id"]
            normalized = _normalize_url(raw)
            if normalized:
                row = conn.execute(
                    f"""
                    SELECT feed_id, article_id FROM article_chunks
                    WHERE {_HAS_EMBEDDING_SQL}
                      AND lower(replace(replace(url, '://www.', '://'), 'https://', 'http://')) =
                          lower(replace(replace(?, '://www.', '://'), 'https://', 'http://'))
                    LIMIT 1
                    """,
                    (normalized,),
                ).fetchone()
                if row:
                    return row["feed_id"], row["article_id"]
        return None

    def article_has_chunks(self, feed_id: str, article_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                f"""
                SELECT 1 FROM article_chunks
                WHERE feed_id = ? AND article_id = ?
                  AND {_HAS_EMBEDDING_SQL}
                LIMIT 1
                """,
                (feed_id, article_id),
            ).fetchone()
        return row is not None

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
        item["embedding"] = decode_embedding(item.get("embedding"))
        return item
