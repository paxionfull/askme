import os
from typing import Any

import asyncio
import litellm

from llm import LLMError, normalize_model_name, resolve_llm_config

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
# 多数兼容 OpenAI 的国内 embedding（如通义）限制单次 batch ≤ 10
EMBED_BATCH_SIZE = max(1, int(os.getenv("EMBED_BATCH_SIZE", "10")))
EMBED_CONCURRENCY = max(1, int(os.getenv("EMBED_CONCURRENCY", "4")))


def resolve_embedding_model(llm_config: dict[str, Any] | None = None) -> str:
    if llm_config:
        configured = str(llm_config.get("embedding_model") or "").strip()
        if configured:
            return configured
    env_model = os.getenv("EMBEDDING_MODEL", "").strip()
    return env_model or EMBEDDING_MODEL


def _embedding_kwargs(config, model: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "model": normalize_model_name(model),
        "api_key": config.api_key,
    }
    if config.api_base:
        kwargs["api_base"] = config.api_base
    return kwargs


def _is_batch_size_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "batch size" in text or ("batch" in text and "larger than" in text)


def _extract_vectors(response: Any, batch_len: int) -> list[list[float]]:
    data = response.data if hasattr(response, "data") else response.get("data", [])
    vectors: list[list[float]] = []
    for item in data:
        if hasattr(item, "embedding"):
            vectors.append(list(item.embedding))
        elif isinstance(item, dict):
            vectors.append(list(item.get("embedding", [])))
    if len(vectors) != batch_len:
        raise LLMError("Embedding 返回数量与输入不一致", status_code=502)
    return vectors


async def _embed_batch(batch: list[str], kwargs: dict[str, Any]) -> list[list[float]]:
    """单批 embedding；若服务端拒绝 batch 过大则拆半重试。"""
    if not batch:
        return []
    try:
        response = await litellm.aembedding(input=batch, **kwargs)
        return _extract_vectors(response, len(batch))
    except Exception as exc:
        if _is_batch_size_error(exc) and len(batch) > 1:
            mid = max(1, len(batch) // 2)
            left = await _embed_batch(batch[:mid], kwargs)
            right = await _embed_batch(batch[mid:], kwargs)
            return left + right
        raise LLMError(f"Embedding 请求失败: {exc}") from exc


async def embed_texts(texts: list[str], llm_config: dict[str, Any] | None = None) -> list[list[float]]:
    if not texts:
        return []

    config = resolve_llm_config(llm_config)
    if not config.api_key:
        raise LLMError("LLM 未配置，无法生成 embedding", status_code=503)

    model = resolve_embedding_model(llm_config)
    kwargs = _embedding_kwargs(config, model)
    batches = [texts[start : start + EMBED_BATCH_SIZE] for start in range(0, len(texts), EMBED_BATCH_SIZE)]
    results: list[list[list[float]] | None] = [None] * len(batches)
    sem = asyncio.Semaphore(EMBED_CONCURRENCY)

    async def embed_one(batch_index: int, batch: list[str]) -> None:
        async with sem:
            results[batch_index] = await _embed_batch(batch, kwargs)

    try:
        await asyncio.gather(*(embed_one(i, batch) for i, batch in enumerate(batches)))
    except LLMError:
        raise
    except Exception as exc:
        raise LLMError(f"Embedding 请求失败: {exc}") from exc

    vectors: list[list[float]] = []
    for batch_vectors in results:
        if not batch_vectors:
            raise LLMError("Embedding 返回为空", status_code=502)
        vectors.extend(batch_vectors)
    if len(vectors) != len(texts):
        raise LLMError("Embedding 返回数量与输入不一致", status_code=502)
    return vectors


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
