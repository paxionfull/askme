import os
import time
from dataclasses import dataclass

from chunk_store import ChunkStore
from embedding_service import cosine_similarity, embed_texts

RAG_TOP_K = int(os.getenv("RAG_TOP_K", "10"))


@dataclass
class RagChunk:
    id: str
    index: int
    text: str
    title: str
    feed_name: str
    published_at: str
    url: str
    feed_id: str
    article_id: str
    chunk_index: int
    char_start: int
    score: float


class RagService:
    def __init__(self, store: ChunkStore | None = None):
        self.store = store or ChunkStore()

    async def retrieve(
        self,
        queries: list[str],
        cutoff_iso: str,
        feed_ids: list[str] | None = None,
        top_k: int = RAG_TOP_K,
        llm_config: dict | None = None,
    ) -> list[RagChunk]:
        if not queries:
            return []

        candidates = self.store.list_in_scope(cutoff_iso, feed_ids)
        if not candidates:
            return []

        query_vectors = await embed_texts(queries, llm_config)
        scored: dict[str, tuple[dict, float]] = {}

        for candidate in candidates:
            embedding = candidate.get("embedding") or []
            if not embedding:
                continue
            best_score = max(cosine_similarity(qv, embedding) for qv in query_vectors)
            chunk_id = candidate["id"]
            prev = scored.get(chunk_id)
            if prev is None or best_score > prev[1]:
                scored[chunk_id] = (candidate, best_score)

        ranked = sorted(scored.values(), key=lambda item: item[1], reverse=True)

        selected: list[RagChunk] = []
        used_articles: set[str] = set()
        for candidate, score in ranked:
            article_key = f"{candidate['feed_id']}:{candidate['article_id']}"
            if article_key in used_articles and len(selected) >= top_k // 2:
                continue
            used_articles.add(article_key)
            selected.append(
                RagChunk(
                    id=candidate["id"],
                    index=0,
                    text=candidate["text"],
                    title=candidate.get("title", ""),
                    feed_name=candidate.get("feed_name", ""),
                    published_at=candidate.get("published_at", ""),
                    url=candidate.get("url", ""),
                    feed_id=candidate["feed_id"],
                    article_id=candidate["article_id"],
                    chunk_index=int(candidate.get("chunk_index", 0)),
                    char_start=int(candidate.get("char_start", 0)),
                    score=score,
                )
            )
            if len(selected) >= top_k:
                break

        for idx, chunk in enumerate(selected, start=1):
            chunk.index = idx
        return selected

    def count_in_scope(self, cutoff_iso: str, feed_ids: list[str] | None = None) -> int:
        return self.store.count_in_scope(cutoff_iso, feed_ids)

    def get_chunk(self, chunk_id: str) -> dict | None:
        return self.store.get_by_id(chunk_id)
