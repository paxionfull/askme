"""数据源接入 Agent runtime：Cursor / Askme 可切换。"""

from __future__ import annotations

from onboarding.agent.cursor_provider import load_cursor_api_key, mask_cursor_api_key
from onboarding.agent.runtime import (
    cancel_agent_run,
    emit_status,
    run_skill_task,
)
from onboarding.agent.select import (
    ENGINE_ASKME,
    ENGINE_CURSOR,
    has_agent_credentials,
    require_agent_credentials,
    resolve_onboarding_engine,
)

__all__ = [
    "ENGINE_ASKME",
    "ENGINE_CURSOR",
    "cancel_agent_run",
    "emit_status",
    "has_agent_credentials",
    "load_cursor_api_key",
    "mask_cursor_api_key",
    "require_agent_credentials",
    "resolve_onboarding_engine",
    "run_skill_task",
]
