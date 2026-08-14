"""接入完成后的首拉（refresh），失败时自动走 Cursor 修复再重试。"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from auth.auth_signals import auth_error_should_skip_repair, account_missing_should_skip_repair
from feed.feed_errors import FeedError
from core.llm import LLMError
from onboarding.source_onboarding_cursor import load_cursor_api_key
from onboarding.source_onboarding_log import OnboardingCancelled, OnboardingSession
from onboarding.source_skill_repair import (
    build_refresh_failure_feedback,
    iter_auto_repair_agent,
)

logger = logging.getLogger(__name__)

# 接入完成后首拉默认时间窗（与前端「今天 / 近 3 天」对齐，可由请求覆盖）
ONBOARD_REFRESH_DAYS = 3
# 仅用于显式 proof 调用（非接入主流程；skill 验证在 discovery_validate 内完成）
ONBOARD_PROOF_PER = 5
ONBOARD_PROOF_MAX_PAGES = 1


async def refresh_onboarded_feed(
    feed_client,
    feed_id: str,
    *,
    days: int = ONBOARD_REFRESH_DAYS,
    proof: bool = False,
) -> dict[str, Any]:
    """接入成功后的自动更新：按时间窗刷新列表，并拉取该范围内全部正文。

    proof=True 时仅拉最近一页列表 + 1 篇正文（调试用）；正常接入应 proof=False。
    """
    fid = str(feed_id or "").strip()
    if not fid:
        raise FeedError("缺少 feed_id", status_code=400)

    feed_client.ensure_feed_visible(fid)
    if proof:
        result = await feed_client.refresh_feed(
            fid,
            days=0,
            max_pages=ONBOARD_PROOF_MAX_PAGES,
            per=ONBOARD_PROOF_PER,
        )
        body_days = 0
        body_list_limit = 1
    else:
        result = await feed_client.refresh_feed(fid, days=days)
        body_days = days
        body_list_limit = 0
    if not isinstance(result, dict):
        result = {"message": str(result or "列表已更新"), "ok": True}

    try:
        from feed.feed_scheduler import feed_scheduler

        bodies_status = await feed_scheduler._pull_bodies_for_feeds(
            [fid],
            days=body_days,
            list_limit=body_list_limit,
        )
    except Exception as bodies_exc:
        logger.exception("接入后拉取正文异常: feed_id=%s", fid)
        return {
            **result,
            "message": f"{result.get('message') or '列表已更新'}；正文拉取失败：{bodies_exc}",
            "bodies_ok": False,
            "bodies_error": str(bodies_exc),
        }

    status = str(bodies_status.get("status") or "")
    if status == "error":
        err = (
            bodies_status.get("error")
            or bodies_status.get("message")
            or "拉取正文失败"
        )
        return {
            **result,
            "message": f"{result.get('message') or '列表已更新'}；正文拉取失败：{err}",
            "bodies_ok": False,
            "bodies_error": str(err),
        }

    if status == "done":
        body_result = bodies_status.get("result") or {}
        with_body = (
            body_result.get("article_count")
            if isinstance(body_result, dict)
            else None
        )
        suffix = (
            f"；正文已拉取 {with_body} 篇"
            if with_body is not None
            else "；正文已拉取"
        )
        return {
            **result,
            "message": f"{result.get('message') or '列表已更新'}{suffix}",
            "bodies_ok": True,
            "bodies_article_count": with_body,
        }

    # 未启动 / 跳过等：列表成功仍算接入成功
    skip_msg = bodies_status.get("message") or status or "已跳过"
    return {
        **result,
        "message": f"{result.get('message') or '列表已更新'}；正文：{skip_msg}",
        "bodies_ok": None,
    }


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
        if auth_error_should_skip_repair(first_error) or account_missing_should_skip_repair(
            first_error
        ):
            raise
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
