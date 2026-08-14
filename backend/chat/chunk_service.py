import hashlib
import os
import re

from chat.chunk_store import ChunkStore
from chat.embedding_service import embed_texts, resolve_embedding_model

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "500"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "80"))

_SENTENCE_SPLIT = re.compile(r"(?<=[。！？!?；;\n])")


def _content_hash(plain_text: str, embedding_model: str = "") -> str:
    payload = f"{embedding_model}\n{plain_text}"
    return hashlib.md5(payload.encode("utf-8")).hexdigest()[:16]


def split_text(plain_text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[tuple[int, str]]:
    text = plain_text.strip()
    if not text:
        return []

    parts = _SENTENCE_SPLIT.split(text)
    sentences = [part.strip() for part in parts if part.strip()]
    if not sentences:
        return [(0, text[:chunk_size])]

    chunks: list[tuple[int, str]] = []
    current = ""
    char_start = 0
    cursor = 0

    for sentence in sentences:
        candidate = f"{current}{sentence}" if current else sentence
        if len(candidate) <= chunk_size:
            current = candidate
            cursor += len(sentence)
            continue

        if current:
            chunks.append((char_start, current))
            overlap_text = current[-overlap:] if overlap > 0 else ""
            char_start = max(0, cursor - len(overlap_text))
            current = f"{overlap_text}{sentence}" if overlap_text else sentence
        else:
            start = cursor
            while start < len(text):
                end = min(start + chunk_size, len(text))
                chunks.append((start, text[start:end]))
                if end >= len(text):
                    break
                start = max(start + 1, end - overlap)
            return chunks
        cursor += len(sentence)

    if current.strip():
        chunks.append((char_start, current.strip()))
    return chunks


class ChunkService:
    def __init__(self, store: ChunkStore | None = None):
        self.store = store or ChunkStore()

    async def index_article(
        self,
        *,
        feed_id: str,
        article_id: str,
        plain_text: str,
        title: str = "",
        feed_name: str = "",
        published_at: str = "",
        url: str = "",
        llm_config: dict | None = None,
    ) -> int:
        plain_text = plain_text.strip()
        if not plain_text:
            self.store.delete_by_article(feed_id, article_id)
            return 0

        content_hash = _content_hash(plain_text, resolve_embedding_model(llm_config))
        existing_hash = self.store.get_content_hash(feed_id, article_id)
        if existing_hash == content_hash:
            return 0

        self.store.delete_by_article(feed_id, article_id)
        splits = split_text(plain_text)
        if not splits:
            return 0

        texts = [chunk_text for _, chunk_text in splits]
        embeddings = await embed_texts(texts, llm_config)

        records: list[dict] = []
        for idx, ((char_start, chunk_text), embedding) in enumerate(zip(splits, embeddings)):
            records.append(
                {
                    "id": f"{feed_id}:{article_id}:{idx}",
                    "feed_id": feed_id,
                    "article_id": article_id,
                    "chunk_index": idx,
                    "text": chunk_text,
                    "char_start": char_start,
                    "title": title,
                    "feed_name": feed_name,
                    "published_at": published_at,
                    "url": url,
                    "embedding": embedding,
                    "content_hash": content_hash,
                }
            )

        self.store.upsert_chunks(records)
        return len(records)
