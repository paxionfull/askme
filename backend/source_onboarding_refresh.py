"""接入完成后的首拉（refresh），失败时自动走 Cursor 修复再重试。"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from feed_errors import FeedError
from llm import LLMError
from source_onboarding_cursor import load_cursor_api_key
from source_onboarding_log import OnboardingCancelled, OnboardingSession
from source_skill_repair import (
    build_refresh_failure_feedback,
    iter_auto_repair_agent,
)


async def refresh_with_auto_repair(
    *,
    slug: str,
    do_refresh: Callable[[], Awaitable[dict[str, Any]]],
    reload_skills: Callable[[], Any],
    session: OnboardingSession | None = None,
    auto_validate: bool = True,
    auto_repair: bool = True,
) -> AsyncIterator[dict[str, Any]]:
    """执行 refresh；失败时自动修复 skill 并重试一次。

    Yields status events for UI progress, then a final event:
      {"event": "refresh_done", "data": {..., "auto_repaired": bool, ...}}

    On unrecoverable failure raises FeedError (or LLMError from repair).
    """
    first_error = ""
    try:
        refresh_result = await do_refresh()
        yield {
            "event": "refresh_done",
            "data": {
                **refresh_result,
                "auto_repaired": False,
            },
        }
        return
    except FeedError as first_exc:
        first_error = str(first_exc)
        if not auto_repair:
            raise
        if not load_cursor_api_key():
            raise FeedError(
                f"skill 已写入，但拉取失败（未配置 Cursor API Key，无法自动修复）: {first_error}",
                status_code=getattr(first_exc, "status_code", 502) or 502,
            ) from first_exc

    try:
        async for event in iter_auto_repair_agent(
            slug=slug,
            feedback=build_refresh_failure_feedback(first_error, slug=slug),
            error=first_error,
            issue_types=["wrong_fields", "other"],
            auto_validate=auto_validate,
            session=session,
        ):
            if event.get("event") == "auto_repair_succeeded":
                continue
            yield event
    except OnboardingCancelled:
        raise
    except LLMError as repair_exc:
        raise FeedError(str(repair_exc), status_code=502) from repair_exc
    except Exception as repair_exc:
        if session:
            session.log("auto_repair_error", error=str(repair_exc))
        raise FeedError(
            f"首拉失败且自动修复异常: {repair_exc}（首次错误: {first_error}）",
            status_code=502,
        ) from repair_exc

    reload_skills()

    try:
        refresh_result = await do_refresh()
    except FeedError as second_exc:
        if session:
            session.log(
                "auto_repair_refresh_failed",
                first_error=first_error[:500],
                second_error=str(second_exc)[:500],
            )
        raise FeedError(
            f"自动修复后仍拉取失败: {second_exc}（首次错误: {first_error}）",
            status_code=getattr(second_exc, "status_code", 502) or 502,
        ) from second_exc

    if session:
        session.log("auto_repair_success", slug=slug)

    yield {
        "event": "refresh_done",
        "data": {
            **refresh_result,
            "auto_repaired": True,
            "first_refresh_error": first_error,
        },
    }
