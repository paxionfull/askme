import os
from typing import Any

import litellm

from llm import LLMError, normalize_model_name, resolve_llm_config

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
EMBED_BATCH_SIZE = max(1, int(os.getenv("EMBED_BATCH_SIZE", "10")))


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


async def embed_texts(texts: list[str], llm_config: dict[str, Any] | None = None) -> list[list[float]]:
    if not texts:
        return []

    config = resolve_llm_config(llm_config)
    if not config.api_key:
        raise LLMError("LLM 未配置，无法生成 embedding", status_code=503)

    model = resolve_embedding_model(llm_config)
    kwargs = _embedding_kwargs(config, model)
    vectors: list[list[float]] = []

    try:
        for start in range(0, len(texts), EMBED_BATCH_SIZE):
            batch = texts[start : start + EMBED_BATCH_SIZE]
            response = await litellm.aembedding(input=batch, **kwargs)
            data = response.data if hasattr(response, "data") else response.get("data", [])
            for item in data:
                if hasattr(item, "embedding"):
                    vectors.append(list(item.embedding))
                elif isinstance(item, dict):
                    vectors.append(list(item.get("embedding", [])))
        if len(vectors) != len(texts):
            raise LLMError("Embedding 返回数量与输入不一致", status_code=502)
        return vectors
    except LLMError:
        raise
    except Exception as exc:
        raise LLMError(f"Embedding 请求失败: {exc}") from exc


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
