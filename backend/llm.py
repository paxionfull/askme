import json
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal

import httpx
import litellm

LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-4o-mini")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_API_BASE = os.getenv("LLM_API_BASE", "")
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "4096"))
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "120"))
DEFAULT_API_BASE = "https://api.openai.com/v1"


class LLMError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class LlmConfig:
    model: str
    api_key: str
    api_base: str = ""


@dataclass
class LlmStreamPart:
    kind: Literal["content", "thinking"]
    text: str


def normalize_model_name(model: str) -> str:
    model = model.strip()
    if not model or "/" in model:
        return model
    return f"openai/{model}"


def resolve_llm_config(override: dict[str, Any] | None = None) -> LlmConfig:
    if override and override.get("api_key"):
        raw_model = (override.get("model") or LLM_MODEL).strip() or LLM_MODEL
        return LlmConfig(
            model=normalize_model_name(raw_model),
            api_key=override["api_key"].strip(),
            api_base=(override.get("api_base") or "").strip(),
        )
    return LlmConfig(
        model=normalize_model_name(LLM_MODEL),
        api_key=LLM_API_KEY,
        api_base=LLM_API_BASE,
    )


def get_llm_status(override: dict[str, Any] | None = None) -> dict[str, Any]:
    config = resolve_llm_config(override)
    source = "client" if override and override.get("api_key") else "env"
    return {
        "configured": bool(config.api_key),
        "model": config.model,
        "source": source,
    }


def _completion_kwargs(config: LlmConfig, *, enable_thinking: bool = False) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "model": config.model,
        "max_tokens": LLM_MAX_TOKENS,
        "timeout": LLM_TIMEOUT,
        "api_key": config.api_key,
    }
    if config.api_base:
        kwargs["api_base"] = config.api_base
    kwargs.update(_thinking_kwargs(config, enable_thinking))
    return kwargs


def _is_glm_model(model: str) -> bool:
    return any(token in model for token in ("glm", "zhipu", "bigmodel", "chatglm"))


def _is_kimi_model(model: str) -> bool:
    return any(token in model for token in ("kimi", "moonshot"))


def _is_kimi_forced_thinking(model: str) -> bool:
    return _is_kimi_model(model) and "k2.7" in model and "code" in model


def _thinking_type_kwargs(enabled: bool, *, extra_body_only: bool = False) -> dict[str, Any]:
    """GLM / Kimi 使用 thinking.type。OpenAI 兼容网关只能走 extra_body。"""
    thinking = {"type": "enabled" if enabled else "disabled"}
    if extra_body_only:
        return {"extra_body": {"thinking": thinking}}
    return {"thinking": thinking, "extra_body": {"thinking": thinking}}


def _thinking_kwargs(config: LlmConfig, enable_thinking: bool) -> dict[str, Any]:
    model = config.model.lower()

    if _is_kimi_model(model):
        if not enable_thinking and _is_kimi_forced_thinking(model):
            # kimi-k2.7-code 无法关闭思考，仅在后端过滤 reasoning 流
            return {}
        return _thinking_type_kwargs(enable_thinking, extra_body_only=True)

    if _is_glm_model(model):
        # 经 OpenAI 兼容接口调用时，顶层 thinking 会被 LiteLLM 拒绝
        extra_body_only = config.api_base or model.startswith("openai/")
        return _thinking_type_kwargs(enable_thinking, extra_body_only=extra_body_only)

    if enable_thinking:
        if any(token in model for token in ("o1", "o3", "o4")):
            return {"reasoning_effort": "medium"}
        if "anthropic/" in model or "claude" in model:
            return {"thinking": {"type": "enabled", "budget_tokens": 1024}}
        return {"extra_body": {"enable_thinking": True}}

    if "deepseek" in model or "qwen" in model:
        return {"extra_body": {"enable_thinking": False}}
    return {}


def ensure_configured(config: LlmConfig) -> None:
    if not config.api_key:
        raise LLMError("LLM 未配置，请在设置页填写 API Key 或在 .env 中设置 LLM_API_KEY", status_code=503)


def _delta_get(delta: Any, name: str) -> str | None:
    if delta is None:
        return None
    value = delta.get(name) if isinstance(delta, dict) else getattr(delta, name, None)
    if value is None:
        return None
    text = str(value)
    return text if text else None


def _delta_as_dict(delta: Any) -> dict[str, Any]:
    if isinstance(delta, dict):
        return delta
    if hasattr(delta, "model_dump"):
        return delta.model_dump(exclude_unset=True)
    return {}


def _extract_thinking_from_delta(delta: Any) -> str:
    delta_dict = _delta_as_dict(delta)
    for field in ("reasoning_content", "reasoning", "thinking"):
        text = _delta_get(delta_dict, field) or _delta_get(delta, field)
        if text:
            return text

    blocks = delta_dict.get("thinking_blocks")
    if blocks is None and not isinstance(delta, dict):
        blocks = getattr(delta, "thinking_blocks", None)
    if blocks:
        parts: list[str] = []
        for block in blocks:
            if isinstance(block, dict):
                text = block.get("thinking") or block.get("text") or ""
            else:
                text = getattr(block, "thinking", None) or getattr(block, "text", None) or ""
            if text:
                parts.append(str(text))
        if parts:
            return "".join(parts)

    provider_fields = delta_dict.get("provider_specific_fields")
    if isinstance(provider_fields, dict):
        for field in ("reasoning_content", "reasoning", "thinking"):
            text = provider_fields.get(field)
            if text:
                return str(text)

    return ""


def _extract_content_from_delta(delta: Any) -> str:
    return _delta_get(delta, "content") or ""


def _extract_stream_parts_from_chunk(chunk: Any) -> list[LlmStreamPart]:
    parts: list[LlmStreamPart] = []
    choices = getattr(chunk, "choices", None) or []
    if not choices:
        return parts

    delta = choices[0].delta
    thinking = _extract_thinking_from_delta(delta)
    content = _extract_content_from_delta(delta)

    if thinking:
        parts.append(LlmStreamPart(kind="thinking", text=thinking))
    if content:
        parts.append(LlmStreamPart(kind="content", text=content))
    return parts


async def complete(
    messages: list[dict[str, str]],
    llm_config: dict[str, Any] | None = None,
    *,
    temperature: float | None = None,
    enable_thinking: bool = False,
) -> str:
    config = resolve_llm_config(llm_config)
    ensure_configured(config)
    kwargs = _completion_kwargs(config, enable_thinking=enable_thinking)
    if temperature is not None:
        kwargs["temperature"] = temperature
    try:
        response = await litellm.acompletion(
            messages=messages,
            stream=False,
            **kwargs,
        )
        message = response.choices[0].message
        return message.content or ""
    except LLMError:
        raise
    except Exception as exc:
        raise LLMError(f"LLM 请求失败: {exc}") from exc


async def stream_llm(
    messages: list[dict[str, str]],
    llm_config: dict[str, Any] | None = None,
    *,
    temperature: float | None = None,
    enable_thinking: bool = False,
) -> AsyncIterator[LlmStreamPart]:
    config = resolve_llm_config(llm_config)
    ensure_configured(config)
    kwargs = _completion_kwargs(config, enable_thinking=enable_thinking)
    if temperature is not None:
        kwargs["temperature"] = temperature
    try:
        response = await litellm.acompletion(
            messages=messages,
            stream=True,
            **kwargs,
        )
        async for chunk in response:
            for part in _extract_stream_parts_from_chunk(chunk):
                if part.kind == "thinking" and not enable_thinking:
                    continue
                yield part
    except LLMError:
        raise
    except Exception as exc:
        raise LLMError(f"LLM 请求失败: {exc}") from exc


def sse_event(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def normalize_api_base(api_base: str) -> str:
    base = (api_base or DEFAULT_API_BASE).strip().rstrip("/")
    return base or DEFAULT_API_BASE


def build_models_url(api_base: str) -> str:
    base = normalize_api_base(api_base)
    if base.endswith("/v1"):
        return f"{base}/models"
    return f"{base}/v1/models"


async def fetch_available_models(api_base: str, api_key: str) -> list[str]:
    if not api_key.strip():
        raise LLMError("请先填写 API Key", status_code=400)

    url = build_models_url(api_base)
    headers = {"Authorization": f"Bearer {api_key.strip()}"}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers)
            if response.status_code == 401:
                raise LLMError("API Key 无效", status_code=401)
            if response.status_code >= 400:
                raise LLMError(f"获取模型列表失败 (HTTP {response.status_code})", status_code=502)
            payload = response.json()
    except LLMError:
        raise
    except Exception as exc:
        raise LLMError(f"获取模型列表失败: {exc}") from exc

    models: list[str] = []
    if isinstance(payload, dict):
        items = payload.get("data", payload.get("models", []))
        if isinstance(items, list):
            for item in items:
                if isinstance(item, str):
                    models.append(item)
                elif isinstance(item, dict):
                    model_id = item.get("id") or item.get("name")
                    if model_id:
                        models.append(str(model_id))

    models = sorted(set(models))
    if not models:
        raise LLMError("未从接口解析到可用模型", status_code=502)
    return models
