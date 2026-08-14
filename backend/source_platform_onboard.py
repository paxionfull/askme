"""已知平台的确定性接入（不走从零写代码）；失败时用 Cursor Agent 按报错迭代修复。"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from llm import LLMError
from platform_accounts import ensure_platform_skill, register_platform_account
from skill_registry import platform_skill_slug
from source_onboarding_log import OnboardingSession
from source_platform_scaffold import (
    fetch_zhihu_profile_name,
    format_reddit_source_name,
    format_weixin_source_name,
    format_x_source_name,
    format_zhihu_source_name,
    probe_jin10_api,
    probe_reddit_subreddit,
    probe_weixin_account,
    probe_xiaohongshu_profile,
    probe_x_profile,
    probe_zhihu_api,
    scaffold_jin10_files,
)
from source_skill_repair import (
    build_probe_failure_feedback,
    build_validation_failure_feedback,
    iter_auto_repair_agent,
)
from source_skill_writer import write_skill_files
from skill_validate import run_validation_for_account


MAX_REPAIR_ATTEMPTS = 3


def _has_cursor_api_key() -> bool:
    from source_onboarding_cursor import load_cursor_api_key

    return bool(load_cursor_api_key())


def _emit_status(
    session: OnboardingSession | None,
    *,
    phase: str,
    message: str,
) -> dict[str, Any]:
    if session:
        session.check_cancelled()
        session.log("status", phase=phase, message=message)
    event: dict[str, Any] = {"event": "status", "phase": phase, "message": message}
    if session:
        event["job_id"] = session.job_id
    return event


def _emit_analysis(session: OnboardingSession | None, data: dict[str, Any]) -> dict[str, Any]:
    if session:
        session.check_cancelled()
        session.log("analysis", data=data)
    return {"event": "analysis", "data": data, **({"job_id": session.job_id} if session else {})}


def _write_scaffold(platform, *, display_name: str) -> dict[str, str]:
    # 仅金十等单例站仍写独立 skill；多账号平台改走 platform_accounts
    if platform.platform == "jin10":
        return scaffold_jin10_files(platform, display_name=display_name)
    raise LLMError(f"不支持的平台脚手架: {platform.platform}", status_code=400)


def _ensure_platform_registered(platform, *, display_name: str) -> dict:
    """登记账号到 feed_registry，并确保平台级 skill 存在（供 validate / auto_repair）。"""
    if platform.platform == "jin10":
        files = scaffold_jin10_files(platform, display_name=display_name)
        write_skill_files(platform.slug, files)
        return {
            "feed_id": platform.feed_id,
            "platform": "jin10",
            "account_key": "jin10",
            "display_name": display_name,
            "slug": platform.slug,
        }
    ensure_platform_skill(platform.platform)
    return register_platform_account(platform, display_name=display_name)


def _platform_repair_slug(platform) -> str:
    if platform.platform == "jin10":
        return platform.slug
    return platform_skill_slug(platform.platform)


async def _run_repair_and_forward(
    *,
    slug: str,
    feedback: str,
    error: str,
    auto_validate: bool,
    session: OnboardingSession | None,
) -> AsyncIterator[dict[str, Any]]:
    async for event in iter_auto_repair_agent(
        slug=slug,
        feedback=feedback,
        error=error,
        auto_validate=auto_validate,
        session=session,
    ):
        if event.get("event") == "auto_repair_succeeded":
            continue
        yield event


async def run_platform_onboarding(
    *,
    platform,
    slug: str,
    name: str,
    auto_validate: bool,
    session: OnboardingSession | None = None,
    auto_repair: bool = True,
) -> AsyncIterator[dict[str, Any]]:
    yield _emit_status(
        session,
        phase="detect",
        message=f"识别为已知平台：{platform.platform}",
    )

    yield _emit_status(session, phase="recon", message="正在探测平台 API…")
    if session:
        session.check_cancelled()

    probe: dict[str, Any] = {}
    display_name = (name or "").strip() or platform.user_id or platform.platform

    if platform.platform == "zhihu":
        probe = probe_zhihu_api(platform)
        yield _emit_analysis(session, {"platform": "zhihu", "probe": probe})
        if not probe.get("ok"):
            detail = probe.get("error") or "平台 API 探测失败"
            if "ZHIHU_COOKIE" in detail or not probe.get("cookie_configured"):
                raise LLMError(
                    "知乎接入需要登录授权：请先添加知乎 Cookie 凭证",
                    status_code=400,
                )
            # 探测失败：先落脚手架，再让 Agent 按报错修，而不是直接中止
            if not auto_repair:
                raise LLMError(f"知乎 API 探测失败: {detail}", status_code=502)
            if not _has_cursor_api_key():
                raise LLMError(
                    f"知乎 API 探测失败（未配置 Cursor API Key，无法自动修复）: {detail}",
                    status_code=502,
                )

            yield _emit_status(
                session,
                phase="scaffold",
                message=f"探测失败，先写入脚手架再自动修复（{display_name}）…",
            )
            _ensure_platform_registered(platform, display_name=display_name)
            if session:
                session.mark_files_written()

            repair_slug = _platform_repair_slug(platform)
            feedback = build_probe_failure_feedback(
                detail,
                slug=repair_slug,
                platform=platform.platform,
                user_type=platform.user_type,
                user_id=platform.user_id,
                entry_url=platform.entry_url,
                list_api_path=platform.list_api_path,
            )
            async for event in _run_repair_and_forward(
                slug=repair_slug,
                feedback=feedback,
                error=detail,
                auto_validate=auto_validate,
                session=session,
            ):
                yield event

            yield _emit_status(session, phase="recon", message="自动修复完成，重新探测 API…")
            probe = probe_zhihu_api(platform)
            yield _emit_analysis(session, {"platform": "zhihu", "probe": probe, "reprobed": True})
            if not probe.get("ok"):
                raise LLMError(
                    f"自动修复后知乎 API 探测仍失败: {probe.get('error') or detail}",
                    status_code=502,
                )

        display_name = probe.get("display_name") or fetch_zhihu_profile_name(platform) or display_name
        display_name = format_zhihu_source_name(str(display_name)) or str(display_name)
        yield _emit_status(
            session,
            phase="scaffold",
            message=f"登记知乎账号到平台 skill（{display_name}）…",
        )
        _ensure_platform_registered(platform, display_name=display_name)
        if session:
            session.mark_files_written()

    elif platform.platform == "jin10":
        probe = probe_jin10_api()
        yield _emit_analysis(session, {"platform": "jin10", "probe": probe})
        if not probe.get("ok"):
            detail = probe.get("error") or "unknown"
            if not auto_repair:
                raise LLMError(f"金十 API 探测失败: {detail}", status_code=502)
            if not _has_cursor_api_key():
                raise LLMError(
                    f"金十 API 探测失败（未配置 Cursor API Key，无法自动修复）: {detail}",
                    status_code=502,
                )
            display_name = "金十数据"
            yield _emit_status(
                session,
                phase="scaffold",
                message="探测失败，先写入脚手架再自动修复…",
            )
            _ensure_platform_registered(platform, display_name=display_name)
            if session:
                session.mark_files_written()
            feedback = build_probe_failure_feedback(
                detail,
                slug=slug,
                platform="jin10",
                entry_url=platform.entry_url,
                list_api_path=platform.list_api_path,
            )
            async for event in _run_repair_and_forward(
                slug=slug,
                feedback=feedback,
                error=detail,
                auto_validate=auto_validate,
                session=session,
            ):
                yield event
            probe = probe_jin10_api()
            if not probe.get("ok"):
                raise LLMError(
                    f"自动修复后金十 API 探测仍失败: {probe.get('error') or detail}",
                    status_code=502,
                )
        else:
            display_name = "金十数据"
            yield _emit_status(
                session,
                phase="scaffold",
                message=f"使用 {platform.platform} 模板生成 skill…",
            )
            _ensure_platform_registered(platform, display_name=display_name)
            if session:
                session.mark_files_written()
    elif platform.platform == "xiaohongshu":
        probe = probe_xiaohongshu_profile(platform)
        yield _emit_analysis(session, {"platform": "xiaohongshu", "probe": probe})
        if not probe.get("cookie_configured"):
            raise LLMError(
                "小红书接入需要登录授权：请先在设置页完成小红书 Cookie 授权",
                status_code=400,
            )
        display_name = probe.get("display_name") or display_name or platform.user_id
        yield _emit_status(
            session,
            phase="scaffold",
            message=f"登记小红书账号到平台 skill（{display_name}）…",
        )
        _ensure_platform_registered(platform, display_name=display_name)
        if session:
            session.mark_files_written()
        if not probe.get("ok"):
            detail = probe.get("error") or "小红书主页探测失败"
            if not auto_repair:
                raise LLMError(f"小红书探测失败: {detail}", status_code=502)
            if not _has_cursor_api_key():
                # 无 Cursor 时仍保留脚手架，交由后续 validate / 用户反馈修复
                yield _emit_status(
                    session,
                    phase="recon",
                    message=f"探测告警：{detail}（已写入脚手架，继续验证）",
                )
            else:
                repair_slug = _platform_repair_slug(platform)
                feedback = build_probe_failure_feedback(
                    detail,
                    slug=repair_slug,
                    platform="xiaohongshu",
                    user_type=platform.user_type,
                    user_id=platform.user_id,
                    entry_url=platform.entry_url,
                    list_api_path=platform.list_api_path,
                )
                async for event in _run_repair_and_forward(
                    slug=repair_slug,
                    feedback=feedback,
                    error=detail,
                    auto_validate=auto_validate,
                    session=session,
                ):
                    yield event
                probe = probe_xiaohongshu_profile(platform)
                yield _emit_analysis(
                    session,
                    {"platform": "xiaohongshu", "probe": probe, "reprobed": True},
                )
                if probe.get("display_name"):
                    display_name = probe["display_name"]
                    _ensure_platform_registered(platform, display_name=display_name)
    elif platform.platform == "reddit":
        probe = probe_reddit_subreddit(platform)
        yield _emit_analysis(session, {"platform": "reddit", "probe": probe})
        display_name = (
            probe.get("display_name")
            or format_reddit_source_name(platform.user_id)
            or display_name
        )
        display_name = format_reddit_source_name(str(display_name)) or str(display_name)
        yield _emit_status(
            session,
            phase="scaffold",
            message=f"登记 Reddit 账号到平台 skill（{display_name}）…",
        )
        _ensure_platform_registered(platform, display_name=display_name)
        if session:
            session.mark_files_written()
        if not probe.get("ok"):
            detail = probe.get("error") or "Reddit 列表探测失败"
            if not auto_repair:
                raise LLMError(f"Reddit 探测失败: {detail}", status_code=502)
            if not _has_cursor_api_key():
                yield _emit_status(
                    session,
                    phase="recon",
                    message=f"探测告警：{detail}（已写入脚手架，继续验证）",
                )
            else:
                repair_slug = _platform_repair_slug(platform)
                feedback = build_probe_failure_feedback(
                    detail,
                    slug=repair_slug,
                    platform="reddit",
                    user_type=platform.user_type,
                    user_id=platform.user_id,
                    entry_url=platform.entry_url,
                    list_api_path=platform.list_api_path,
                )
                async for event in _run_repair_and_forward(
                    slug=repair_slug,
                    feedback=feedback,
                    error=detail,
                    auto_validate=auto_validate,
                    session=session,
                ):
                    yield event
    elif platform.platform == "x":
        probe = probe_x_profile(platform)
        yield _emit_analysis(session, {"platform": "x", "probe": probe})
        display_name = (
            probe.get("display_name")
            or format_x_source_name(platform.user_id)
            or display_name
        )
        display_name = format_x_source_name(str(display_name)) or str(display_name)
        yield _emit_status(
            session,
            phase="scaffold",
            message=f"登记 X 账号到平台 skill（{display_name}）…",
        )
        _ensure_platform_registered(platform, display_name=display_name)
        if session:
            session.mark_files_written()
        # 用列表作者名刷新显示名（探测阶段常拿不到昵称）
        from source_platform_scaffold import refresh_x_display_name_from_list

        refreshed = refresh_x_display_name_from_list(_platform_repair_slug(platform), platform)
        if refreshed and refreshed != display_name:
            display_name = refreshed
            _ensure_platform_registered(platform, display_name=display_name)
            yield _emit_status(
                session,
                phase="scaffold",
                message=f"已更新显示名为 {display_name}",
            )
        if probe.get("error") and probe.get("soft_fail"):
            yield _emit_status(
                session,
                phase="recon",
                message=f"{probe.get('error')}（已写入脚手架，继续验证）",
            )
    elif platform.platform == "weixin":
        probe = probe_weixin_account(platform)
        yield _emit_analysis(session, {"platform": "weixin", "probe": probe})
        if not probe.get("cookie_configured") or (
            not probe.get("ok") and "ASKME_AUTH_REQUIRED" in str(probe.get("error") or "")
        ):
            raise LLMError(
                "微信接入需要公众号后台登录授权：请在设置页用【公众号】扫码登录"
                "（不要选小程序），保存凭证后再接入",
                status_code=400,
            )
        from source_platform_scaffold import weixin_name_hint_from_url

        name_hint = weixin_name_hint_from_url(platform.entry_url)
        display_name = (
            (name.strip() if name and name.strip() else "")
            or probe.get("display_name")
            or format_weixin_source_name(str(probe.get("nickname") or ""))
            or format_weixin_source_name(name_hint)
            or format_weixin_source_name(platform.user_id)
            or display_name
        )
        display_name = format_weixin_source_name(str(display_name)) or str(display_name)
        yield _emit_status(
            session,
            phase="scaffold",
            message=f"登记微信账号到平台 skill（{display_name}）…",
        )
        _ensure_platform_registered(platform, display_name=display_name)
        if session:
            session.mark_files_written()
        if not probe.get("ok"):
            detail = probe.get("error") or "微信公众号列表探测失败"
            if not auto_repair:
                raise LLMError(f"微信探测失败: {detail}", status_code=502)
            if not _has_cursor_api_key():
                yield _emit_status(
                    session,
                    phase="recon",
                    message=f"探测告警：{detail}（已写入脚手架，继续验证）",
                )
            else:
                repair_slug = _platform_repair_slug(platform)
                feedback = build_probe_failure_feedback(
                    detail,
                    slug=repair_slug,
                    platform="weixin",
                    user_type=platform.user_type,
                    user_id=platform.user_id,
                    entry_url=platform.entry_url,
                    list_api_path=platform.list_api_path,
                )
                async for event in _run_repair_and_forward(
                    slug=repair_slug,
                    feedback=feedback,
                    error=detail,
                    auto_validate=auto_validate,
                    session=session,
                ):
                    yield event
                probe = probe_weixin_account(platform)
                yield _emit_analysis(
                    session, {"platform": "weixin", "probe": probe, "reprobed": True}
                )
    else:
        return

    yield _emit_status(session, phase="write", message="平台账号已登记")

    validation: dict[str, Any] | None = None
    if auto_validate:
        # 微信：probe 已成功打过 list_ex（短缓存可复用），轻量校验即可，避免再打正文+列表
        if platform.platform == "weixin" and probe.get("ok"):
            yield _emit_status(session, phase="validate", message="探测已通过，跳过完整 list 复验…")
            account = _ensure_platform_registered(platform, display_name=display_name)
            validation = {
                "ok": True,
                "list_count": int(probe.get("list_count") or 0),
                "sample_title": (probe.get("sample_titles") or [None])[0],
                "feed_id": account.get("feed_id") or platform.feed_id,
                "skipped_full_validate": True,
                "reason": "probe already confirmed list_ex",
            }
            if session:
                session.log("validation", ok=True, result=validation)
        else:
            for attempt in range(MAX_REPAIR_ATTEMPTS):
                yield _emit_status(
                    session,
                    phase="validate" if attempt == 0 else "repair",
                    message="正在验证 skill…"
                    if attempt == 0
                    else f"验证失败，自动修复中（{attempt}/{MAX_REPAIR_ATTEMPTS - 1}）…",
                )
                if session:
                    session.check_cancelled()
                try:
                    account = _ensure_platform_registered(platform, display_name=display_name)
                    validation = run_validation_for_account(account)
                    if session:
                        session.log("validation", ok=True, result=validation)
                    break
                except Exception as exc:
                    last_error = str(exc)
                    if session:
                        session.log("validation", ok=False, error=last_error, attempt=attempt + 1)
                    if attempt >= MAX_REPAIR_ATTEMPTS - 1:
                        raise LLMError(
                            f"skill 验证失败: {last_error}",
                            status_code=502,
                        ) from exc
                    if not auto_repair or not _has_cursor_api_key():
                        _ensure_platform_registered(platform, display_name=display_name)
                        continue
                    repair_slug = _platform_repair_slug(platform)
                    feedback = build_validation_failure_feedback(last_error, slug=repair_slug)
                    async for event in _run_repair_and_forward(
                        slug=repair_slug,
                        feedback=feedback,
                        error=last_error,
                        auto_validate=False,
                        session=session,
                    ):
                        yield event

    repair_slug = _platform_repair_slug(platform)
    result_data = {
        "ok": True,
        "slug": slug,
        "feed_id": platform.feed_id,
        "skill_dir": f"{repair_slug}-discovery",
        "platform_skill": repair_slug,
        "analysis": {
            "platform": platform.platform,
            "scaffold": True,
            "platform_account": True,
            "probe": probe,
        },
        "validation": validation,
    }
    if session:
        session.log("result", data=result_data)
    yield {"event": "result", "data": result_data, **({"job_id": session.job_id} if session else {})}
