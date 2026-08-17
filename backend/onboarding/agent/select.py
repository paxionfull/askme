"""选择接入 Agent 引擎：askme（用户 LLM）优先，其次 cursor。"""

from __future__ import annotations

import os
from typing import Any, Literal

from core.llm import LLMError, get_llm_status

ENGINE_ASKME = "askme"
ENGINE_CURSOR = "cursor"
OnboardingEngine = Literal["askme", "cursor"]


def has_cursor_credentials() -> bool:
    from onboarding.agent.cursor_provider import load_cursor_api_key

    return bool(load_cursor_api_key())


def has_askme_llm(llm_config: dict[str, Any] | None = None) -> bool:
    return bool(get_llm_status(llm_config).get("configured"))


def has_agent_credentials(llm_config: dict[str, Any] | None = None) -> bool:
    return has_askme_llm(llm_config) or has_cursor_credentials()


def resolve_onboarding_engine(
    llm_config: dict[str, Any] | None = None,
    *,
    preferred: str | None = None,
) -> OnboardingEngine:
    """解析实际使用的引擎。

    优先级：
    1. preferred / 环境变量 ASKME_ONBOARDING_ENGINE（若该引擎有凭证）
    2. 已配置用户 LLM → askme
    3. 已配置 Cursor API Key → cursor
    """
    forced = (preferred or os.getenv("ASKME_ONBOARDING_ENGINE", "")).strip().lower()
    if forced in {ENGINE_ASKME, ENGINE_CURSOR}:
        if forced == ENGINE_ASKME and has_askme_llm(llm_config):
            return ENGINE_ASKME
        if forced == ENGINE_CURSOR and has_cursor_credentials():
            return ENGINE_CURSOR

    if has_askme_llm(llm_config):
        return ENGINE_ASKME
    if has_cursor_credentials():
        return ENGINE_CURSOR
    raise LLMError(
        "请先在设置页配置对话模型 API Key，或配置 Cursor API Key（未知站接入需要其一）",
        status_code=400,
    )


def require_agent_credentials(
    llm_config: dict[str, Any] | None = None,
    *,
    action: str = "自动修复",
) -> OnboardingEngine:
    """确保至少有一种可用引擎，并返回将使用的引擎。"""
    try:
        return resolve_onboarding_engine(llm_config)
    except LLMError as exc:
        raise LLMError(
            f"{action}需要 Agent：请配置对话模型 API Key 或 Cursor API Key",
            status_code=400,
        ) from exc
