import os
from dataclasses import dataclass

from chat.chunk_store import ChunkStore
from chat.embedding_service import cosine_similarity, embed_texts

RAG_MAX_CHUNKS = int(os.getenv("RAG_MAX_CHUNKS", os.getenv("RAG_TOP_K", "10")))
RAG_MAX_ARTICLES = int(os.getenv("RAG_MAX_ARTICLES", "5"))
RAG_MAX_CHUNKS_PER_ARTICLE = int(os.getenv("RAG_MAX_CHUNKS_PER_ARTICLE", "3"))
RAG_MIN_SCORE = float(os.getenv("RAG_MIN_SCORE", "0.35"))
RAG_SCORE_RATIO = float(os.getenv("RAG_SCORE_RATIO", "0.75"))


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


def _article_key(candidate: dict) -> str:
    return f"{candidate['feed_id']}:{candidate['article_id']}"


def _score_threshold(best_score: float) -> float:
    if best_score <= 0:
        return 1.0
    return max(RAG_MIN_SCORE, best_score * RAG_SCORE_RATIO)


class RagService:
    def __init__(self, store: ChunkStore | None = None):
        self.store = store or ChunkStore()

    async def retrieve(
        self,
        queries: list[str],
        cutoff_iso: str,
        feed_ids: list[str] | None = None,
        article_pairs: list[tuple[str, str]] | None = None,
        max_chunks: int = RAG_MAX_CHUNKS,
        llm_config: dict | None = None,
    ) -> list[RagChunk]:
        if not queries:
            return []

        candidates = self.store.list_in_scope(cutoff_iso, feed_ids, article_pairs)
        if not candidates:
            return []

        query_vectors = await embed_texts(queries, llm_config)
        scored_chunks: list[tuple[dict, float]] = []

        for candidate in candidates:
            embedding = candidate.get("embedding") or []
            if not embedding:
                continue
            best_score = max(cosine_similarity(qv, embedding) for qv in query_vectors)
            scored_chunks.append((candidate, best_score))

        if not scored_chunks:
            return []

        article_scores: dict[str, float] = {}
        article_chunks: dict[str, list[tuple[dict, float]]] = {}
        for candidate, score in scored_chunks:
            key = _article_key(candidate)
            article_scores[key] = max(article_scores.get(key, 0.0), score)
            article_chunks.setdefault(key, []).append((candidate, score))

        best_article_score = max(article_scores.values())
        article_threshold = _score_threshold(best_article_score)

        relevant_articles: list[str] = []
        for key, score in sorted(article_scores.items(), key=lambda item: item[1], reverse=True):
            if score < article_threshold:
                break
            relevant_articles.append(key)
            if len(relevant_articles) >= RAG_MAX_ARTICLES:
                break

        if not relevant_articles:
            return []

        pool: list[tuple[dict, float]] = []
        for key in relevant_articles:
            chunks_for_article = sorted(article_chunks[key], key=lambda item: item[1], reverse=True)
            pool.extend(chunks_for_article[:RAG_MAX_CHUNKS_PER_ARTICLE])

        pool.sort(key=lambda item: item[1], reverse=True)
        best_chunk_score = pool[0][1]
        chunk_threshold = _score_threshold(best_chunk_score)

        selected: list[RagChunk] = []
        for candidate, score in pool:
            if score < chunk_threshold:
                continue
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
            if len(selected) >= max_chunks:
                break

        for idx, chunk in enumerate(selected, start=1):
            chunk.index = idx
        return selected

    def count_in_scope(
        self,
        cutoff_iso: str,
        feed_ids: list[str] | None = None,
        article_pairs: list[tuple[str, str]] | None = None,
    ) -> int:
        return self.store.count_in_scope(cutoff_iso, feed_ids, article_pairs)

    def get_chunk(self, chunk_id: str) -> dict | None:
        return self.store.get_by_id(chunk_id)
