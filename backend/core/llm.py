import json
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal

import httpx
import litellm

from paths import DATA_DIR

LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-4o-mini")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_API_BASE = os.getenv("LLM_API_BASE", "")
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "8192"))
LLM_EMBEDDING_MODEL = os.getenv("LLM_EMBEDDING_MODEL", "")
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "120"))
DEFAULT_API_BASE = "https://api.openai.com/v1"
MIN_MAX_TOKENS = 256
MAX_MAX_TOKENS = 128_000
# 简报流水线：尽量降低随机性（厂商未必保证确定性，中间结果另有缓存）
DIGEST_LLM_TEMPERATURE = 0.0
DIGEST_LLM_TOP_P = 1.0
DIGEST_LLM_SEED = 42

_INTEGRATIONS_PATH = DATA_DIR / "integrations.json"
_LLM_SETTINGS_KEY = "llm"


class LLMError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class LlmConfig:
    model: str
    api_key: str
    api_base: str = ""
    max_tokens: int = LLM_MAX_TOKENS
    thinking_style: str = ""  # 用户配置的 thinking 参数风格，空则自动推断
    embedding_api_key: str = ""   # embedding 专用 key，空则回退到 api_key
    embedding_api_base: str = ""  # embedding 专用 base，空则回退到 api_base


@dataclass
class LlmStreamPart:
    kind: Literal["content", "thinking"]
    text: str


def clamp_max_tokens(value: Any, *, default: int = LLM_MAX_TOKENS) -> int:
    try:
        tokens = int(value)
    except (TypeError, ValueError):
        return default
    if tokens <= 0:
        return default
    return min(MAX_MAX_TOKENS, max(MIN_MAX_TOKENS, tokens))


def normalize_model_name(model: str, api_base: str = "") -> str:
    """将裸模型名加上 litellm provider 前缀。

    规则（按优先级）：
    1. 已含 '/' → 用户或前端已指定 provider，直接返回
    2. Anthropic 官方端点（无自定义 api_base）→ 加 anthropic/ 前缀
    3. 其他所有情况（含自定义 OpenAI 兼容端点）→ 加 openai/ 前缀
    """
    model = model.strip()
    if not model or "/" in model:
        return model
    # Anthropic 官方 API 不走 OpenAI 兼容层，需要 native provider 前缀
    base = (api_base or "").strip().lower()
    if not base and "claude" in model.lower():
        return f"anthropic/{model}"
    return f"openai/{model}"


def _read_integrations() -> dict[str, Any]:
    if not _INTEGRATIONS_PATH.is_file():
        return {}
    try:
        data = json.loads(_INTEGRATIONS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_integrations(data: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _INTEGRATIONS_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def normalize_stored_llm_config(raw: dict[str, Any] | None) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    return {
        "model": str(raw.get("model") or "").strip(),
        "embedding_model": str(raw.get("embedding_model") or "").strip(),
        "api_key": str(raw.get("api_key") or "").strip(),
        "api_base": str(raw.get("api_base") or "").strip(),
        "max_tokens": clamp_max_tokens(raw.get("max_tokens")),
        "thinking_style": str(raw.get("thinking_style") or "").strip(),
        "embedding_api_key": str(raw.get("embedding_api_key") or "").strip(),
        "embedding_api_base": str(raw.get("embedding_api_base") or "").strip(),
    }


def has_stored_llm_settings() -> bool:
    """integrations.json 是否已有 llm 段（含用户主动清空后的空配置）。"""
    return _LLM_SETTINGS_KEY in _read_integrations()


def load_stored_llm_config() -> dict[str, Any]:
    data = _read_integrations()
    return normalize_stored_llm_config(data.get(_LLM_SETTINGS_KEY))


def save_stored_llm_config(config: dict[str, Any]) -> dict[str, Any]:
    item = normalize_stored_llm_config(config)
    if not item["api_key"]:
        raise LLMError("请填写 API Key", status_code=400)
    if not item["model"]:
        raise LLMError("请选择对话模型", status_code=400)
    data = _read_integrations()
    data[_LLM_SETTINGS_KEY] = item
    _write_integrations(data)
    apply_stored_llm_config(item)
    return item


def clear_stored_llm_config() -> dict[str, Any]:
    """清空持久化 LLM 配置（对话 + Embedding），并卸掉运行时覆盖。"""
    item = normalize_stored_llm_config({})
    data = _read_integrations()
    data[_LLM_SETTINGS_KEY] = item
    _write_integrations(data)
    apply_cleared_llm_config(item)
    return item


def apply_cleared_llm_config(item: dict[str, Any] | None = None) -> dict[str, Any]:
    """将模块级 LLM 运行时置空（用户重置配置后调用）。"""
    global LLM_MODEL, LLM_API_KEY, LLM_API_BASE, LLM_MAX_TOKENS, LLM_EMBEDDING_MODEL
    cleared = normalize_stored_llm_config(item)
    LLM_MODEL = ""
    LLM_API_KEY = ""
    LLM_API_BASE = ""
    LLM_EMBEDDING_MODEL = ""
    LLM_MAX_TOKENS = cleared["max_tokens"]
    for key in (
        "LLM_MODEL",
        "LLM_API_KEY",
        "LLM_API_BASE",
        "LLM_EMBEDDING_MODEL",
        "LLM_MAX_TOKENS",
    ):
        os.environ.pop(key, None)
    return cleared


def apply_stored_llm_config(config: dict[str, Any] | None = None) -> dict[str, Any]:
    """把持久化配置写入模块级默认值（优先于空的环境变量）。"""
    global LLM_MODEL, LLM_API_KEY, LLM_API_BASE, LLM_MAX_TOKENS, LLM_EMBEDDING_MODEL
    item = normalize_stored_llm_config(config if config is not None else load_stored_llm_config())
    if item["api_key"]:
        LLM_API_KEY = item["api_key"]
        os.environ["LLM_API_KEY"] = item["api_key"]
    if item["model"]:
        LLM_MODEL = item["model"]
        os.environ["LLM_MODEL"] = item["model"]
    if item["api_base"]:
        LLM_API_BASE = item["api_base"]
        os.environ["LLM_API_BASE"] = item["api_base"]
    if item["embedding_model"]:
        LLM_EMBEDDING_MODEL = item["embedding_model"]
        os.environ["LLM_EMBEDDING_MODEL"] = item["embedding_model"]
    else:
        LLM_EMBEDDING_MODEL = ""
        os.environ.pop("LLM_EMBEDDING_MODEL", None)
    LLM_MAX_TOKENS = item["max_tokens"]
    os.environ["LLM_MAX_TOKENS"] = str(item["max_tokens"])
    return item


def resolve_llm_config(override: dict[str, Any] | None = None) -> LlmConfig:
    if override and override.get("api_key"):
        raw_model = (override.get("model") or LLM_MODEL).strip() or LLM_MODEL
        api_base = (override.get("api_base") or "").strip()
        return LlmConfig(
            model=normalize_model_name(raw_model, api_base),
            api_key=override["api_key"].strip(),
            api_base=api_base,
            max_tokens=clamp_max_tokens(override.get("max_tokens")),
            thinking_style=str(override.get("thinking_style") or "").strip(),
            embedding_api_key=str(override.get("embedding_api_key") or "").strip(),
            embedding_api_base=str(override.get("embedding_api_base") or "").strip(),
        )
    if LLM_API_KEY:
        stored = load_stored_llm_config()
        return LlmConfig(
            model=normalize_model_name(LLM_MODEL, LLM_API_BASE),
            api_key=LLM_API_KEY,
            api_base=LLM_API_BASE,
            max_tokens=LLM_MAX_TOKENS,
            thinking_style=stored.get("thinking_style") or "",
            embedding_api_key=stored.get("embedding_api_key") or "",
            embedding_api_base=stored.get("embedding_api_base") or "",
        )
    # 启动前或未 apply 时，直接读持久化配置
    stored = load_stored_llm_config()
    if stored.get("api_key"):
        stored_base = stored.get("api_base") or ""
        return LlmConfig(
            model=normalize_model_name(stored.get("model") or LLM_MODEL, stored_base),
            api_key=stored["api_key"],
            api_base=stored_base,
            max_tokens=clamp_max_tokens(stored.get("max_tokens")),
            thinking_style=stored.get("thinking_style") or "",
            embedding_api_key=stored.get("embedding_api_key") or "",
            embedding_api_base=stored.get("embedding_api_base") or "",
        )
    return LlmConfig(
        model=normalize_model_name(LLM_MODEL, LLM_API_BASE),
        api_key="",
        api_base=LLM_API_BASE,
        max_tokens=LLM_MAX_TOKENS,
    )


def get_llm_status(override: dict[str, Any] | None = None) -> dict[str, Any]:
    config = resolve_llm_config(override)
    if override and override.get("api_key"):
        source = "client"
    elif load_stored_llm_config().get("api_key"):
        source = "stored"
    elif os.getenv("LLM_API_KEY", "").strip():
        source = "env"
    else:
        source = "none"
    return {
        "configured": bool(config.api_key and config.model),
        "model": config.model,
        "source": source,
        "max_tokens": config.max_tokens,
    }


def _completion_kwargs(config: LlmConfig, *, enable_thinking: bool = False) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "model": config.model,
        "max_tokens": config.max_tokens,
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


def _thinking_type_kwargs(enabled: bool) -> dict[str, Any]:
    """GLM / Kimi / DeepSeek / MiMo 风格：顶层 thinking.type，通过 extra_body 传递。"""
    thinking = {"type": "enabled" if enabled else "disabled"}
    return {"extra_body": {"thinking": thinking}}


def _infer_thinking_style(model: str) -> str:
    """根据模型名自动推断 thinking 风格，用户未配置时的 fallback。

    返回值与前端 THINKING_STYLES 的 id 对应：
      "thinking_type"   → GLM / Kimi / DeepSeek / MiMo（extra_body.thinking.type）
      "enable_thinking" → Qwen（extra_body.enable_thinking 布尔）
      "claude"          → Anthropic Claude（顶层 thinking.budget_tokens）
      "reasoning_effort"→ OpenAI o 系列（顶层 reasoning_effort）
      "none"            → 不支持 thinking，什么都不传
    """
    m = model.lower()
    if any(t in m for t in ("glm", "zhipu", "bigmodel", "chatglm")):
        return "thinking_type"
    if any(t in m for t in ("kimi", "moonshot")):
        return "thinking_type"
    if "deepseek" in m or "mimo" in m:
        return "thinking_type"
    if "qwen" in m:
        return "enable_thinking"
    if "anthropic/" in m or "claude" in m:
        return "claude"
    if any(t in m for t in ("o1", "o3", "o4")):
        return "reasoning_effort"
    return "none"


def _thinking_kwargs(config: LlmConfig, enable_thinking: bool) -> dict[str, Any]:
    model = config.model.lower()

    # Kimi k2.7-code 强制思考，无法关闭，直接跳过
    if _is_kimi_model(model) and _is_kimi_forced_thinking(model) and not enable_thinking:
        return {}

    style = config.thinking_style or _infer_thinking_style(model)

    if style == "thinking_type":
        return _thinking_type_kwargs(enable_thinking)

    if style == "enable_thinking":
        if enable_thinking:
            return {"extra_body": {"enable_thinking": True}}
        return {"extra_body": {"enable_thinking": False}}

    if style == "claude":
        if enable_thinking:
            return {"thinking": {"type": "enabled", "budget_tokens": 1024}}
        return {}

    if style == "reasoning_effort":
        if enable_thinking:
            return {"reasoning_effort": "medium"}
        return {}

    # "none" 或未知 style：不传任何 thinking 参数
    return {}


def ensure_configured(config: LlmConfig) -> None:
    if not config.api_key:
        raise LLMError("LLM 未配置，请先在「设置 → API Key」页面填写对话模型的 API Key", status_code=503)


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
    top_p: float | None = None,
    seed: int | None = None,
    enable_thinking: bool = False,
) -> str:
    config = resolve_llm_config(llm_config)
    ensure_configured(config)
    kwargs = _completion_kwargs(config, enable_thinking=enable_thinking)
    if temperature is not None:
        kwargs["temperature"] = temperature
    if top_p is not None:
        kwargs["top_p"] = top_p
    if seed is not None:
        kwargs["seed"] = seed
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


async def complete_digest(
    messages: list[dict[str, str]],
    llm_config: dict[str, Any] | None = None,
) -> str:
    """简报专用：固定 temperature / top_p / seed，尽量同输入同输出。"""
    return await complete(
        messages,
        llm_config,
        temperature=DIGEST_LLM_TEMPERATURE,
        top_p=DIGEST_LLM_TOP_P,
        seed=DIGEST_LLM_SEED,
        enable_thinking=False,
    )


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
