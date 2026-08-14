"""已知平台的确定性接入（不走从零写代码）；失败时用 Cursor Agent 按报错迭代修复。"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from auth.auth_signals import auth_error_should_skip_repair
from core.llm import LLMError
from feed.platform_accounts import ensure_platform_skill, register_platform_account
from onboarding.platform_registry import PlatformSpec, get_platform_spec
from onboarding.source_onboarding_log import OnboardingSession
from onboarding.source_platform_scaffold import scaffold_jin10_files
from onboarding.source_skill_repair import (
    build_probe_failure_feedback,
    build_validation_failure_feedback,
    iter_auto_repair_agent,
)
from onboarding.source_skill_writer import write_skill_files
from skills.skill_registry import platform_skill_slug
from skills.skill_validate import run_validation_for_account


MAX_REPAIR_ATTEMPTS = 3


def _raise_if_auth_gate(detail: str, *, slot: str) -> None:
    """缺 Cookie / 登录墙：抛 AUTH_REQUIRED，禁止走 auto_repair。"""
    text = str(detail or "")
    if not auth_error_should_skip_repair(text) and "未登录" not in text and "请先登录" not in text:
        return
    if text.upper().startswith("ASKME_AUTH_REQUIRED"):
        raise LLMError(text, status_code=400)
    raise LLMError(
        f"ASKME_AUTH_REQUIRED:slot={slot} {text}",
        status_code=400,
    )


def _has_cursor_api_key() -> bool:
    from onboarding.source_onboarding_cursor import load_cursor_api_key

    return bool(load_cursor_api_key())


def _emit_status(
    session: OnboardingSession | None,
    *,
    phase: str,
    message: str,
) -> dict[str, Any]:
    if session:
        session.check_cancelled()
        session.log_status(phase, message)
    event: dict[str, Any] = {"event": "status", "phase": phase, "message": message}
    if session:
        event["job_id"] = session.job_id
    return event


def _emit_analysis(session: OnboardingSession | None, data: dict[str, Any]) -> dict[str, Any]:
    if session:
        session.check_cancelled()
        session.log("analysis", data=data)
    return {"event": "analysis", "data": data, **({"job_id": session.job_id} if session else {})}


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


async def _repair_probe_failure(
    *,
    platform,
    spec: PlatformSpec,
    probe: dict[str, Any],
    display_name: str,
    detail: str,
    auto_validate: bool,
    auto_repair: bool,
    session: OnboardingSession | None,
    soft_without_key: bool,
) -> AsyncIterator[dict[str, Any] | tuple[str, dict[str, Any]]]:
    """修复探测失败。最后 yield ``("done", probe)``；中间 yield 事件 dict。"""
    slot = spec.auth_slot or platform.platform
    if spec.auth_slot:
        _raise_if_auth_gate(detail, slot=slot)

    if not auto_repair:
        raise LLMError(f"{spec.label}探测失败: {detail}", status_code=502)

    if not _has_cursor_api_key():
        if soft_without_key:
            yield _emit_status(
                session,
                phase="recon",
                message=f"探测告警：{detail}（已写入脚手架，继续验证）",
            )
            yield ("done", probe)
            return
        raise LLMError(
            f"{spec.label} API 探测失败（未配置 Cursor API Key，无法自动修复）: {detail}",
            status_code=502,
        )

    repair_slug = _platform_repair_slug(platform)
    feedback = build_probe_failure_feedback(
        detail,
        slug=repair_slug,
        platform=platform.platform,
        user_type=getattr(platform, "user_type", None),
        user_id=getattr(platform, "user_id", None),
        entry_url=platform.entry_url,
        list_api_path=getattr(platform, "list_api_path", None),
    )
    async for event in _run_repair_and_forward(
        slug=repair_slug,
        feedback=feedback,
        error=detail,
        auto_validate=auto_validate,
        session=session,
    ):
        yield event

    if not spec.reprobe_after_repair:
        yield ("done", probe)
        return

    if spec.reprobe_must_succeed:
        yield _emit_status(session, phase="recon", message="自动修复完成，重新探测 API…")

    probe = spec.probe(platform)
    yield _emit_analysis(
        session,
        {"platform": platform.platform, "probe": probe, "reprobed": True},
    )
    if spec.reprobe_must_succeed and not probe.get("ok"):
        raise LLMError(
            f"自动修复后{spec.label} API 探测仍失败: {probe.get('error') or detail}",
            status_code=502,
        )
    yield ("done", probe)


async def run_platform_onboarding(
    *,
    platform,
    slug: str,
    name: str,
    auto_validate: bool,
    session: OnboardingSession | None = None,
    auto_repair: bool = True,
) -> AsyncIterator[dict[str, Any]]:
    spec = get_platform_spec(platform.platform)
    if not spec:
        return

    yield _emit_status(
        session,
        phase="detect",
        message=f"识别为已知平台：{platform.platform}",
    )
    yield _emit_status(session, phase="recon", message="正在探测平台 API…")
    if session:
        session.check_cancelled()

    fallback_name = (name or "").strip() or platform.user_id or platform.platform
    probe = spec.probe(platform)
    yield _emit_analysis(session, {"platform": platform.platform, "probe": probe})

    if spec.check_early_auth:
        auth_msg = spec.check_early_auth(probe)
        if auth_msg:
            raise LLMError(auth_msg, status_code=400)

    display_name = fallback_name
    registered = False

    if spec.fail_mode == "hard_repair":
        if not probe.get("ok"):
            detail = str(probe.get("error") or "平台 API 探测失败")
            if spec.auth_slot:
                _raise_if_auth_gate(detail, slot=spec.auth_slot)
            # 失败路径先用占位名落脚手架；成功后再 resolve 真实显示名
            display_name = (
                spec.resolve_display_name(platform, probe, fallback_name, name or "")
                if spec.singleton_skill
                else fallback_name
            )
            yield _emit_status(
                session,
                phase="scaffold",
                message=(
                    "探测失败，先写入脚手架再自动修复…"
                    if spec.singleton_skill
                    else f"探测失败，先写入脚手架再自动修复（{display_name}）…"
                ),
            )
            _ensure_platform_registered(platform, display_name=display_name)
            registered = True
            if session:
                session.mark_files_written()

            soft = False  # hard_repair：无 key 直接失败
            async for item in _repair_probe_failure(
                platform=platform,
                spec=spec,
                probe=probe,
                display_name=display_name,
                detail=detail,
                auto_validate=auto_validate,
                auto_repair=auto_repair,
                session=session,
                soft_without_key=soft,
            ):
                if isinstance(item, tuple) and item[0] == "done":
                    probe = item[1]
                else:
                    yield item  # type: ignore[misc]

        display_name = spec.resolve_display_name(
            platform, probe, fallback_name, name or ""
        )
        yield _emit_status(
            session,
            phase="scaffold",
            message=(
                f"使用 {platform.platform} 模板生成 skill…"
                if spec.singleton_skill
                else f"登记{spec.label}账号到平台 skill（{display_name}）…"
            ),
        )
        _ensure_platform_registered(platform, display_name=display_name)
        registered = True
        if session:
            session.mark_files_written()

    elif spec.fail_mode in ("register_then_repair", "soft"):
        display_name = spec.resolve_display_name(
            platform, probe, fallback_name, name or ""
        )
        yield _emit_status(
            session,
            phase="scaffold",
            message=f"登记{spec.label}账号到平台 skill（{display_name}）…",
        )
        _ensure_platform_registered(platform, display_name=display_name)
        registered = True
        if session:
            session.mark_files_written()

        if spec.after_register_refresh_display:
            refreshed = (
                spec.after_register_refresh_display(
                    platform, _platform_repair_slug(platform), display_name
                )
                or ""
            ).strip()
            if refreshed and refreshed != display_name:
                display_name = refreshed
                _ensure_platform_registered(platform, display_name=display_name)
                yield _emit_status(
                    session,
                    phase="scaffold",
                    message=f"已更新显示名为 {display_name}",
                )

        if spec.fail_mode == "soft":
            if probe.get("error") and probe.get("soft_fail"):
                yield _emit_status(
                    session,
                    phase="recon",
                    message=f"{probe.get('error')}（已写入脚手架，继续验证）",
                )
        elif not probe.get("ok"):
            detail = str(probe.get("error") or f"{spec.label}探测失败")
            async for item in _repair_probe_failure(
                platform=platform,
                spec=spec,
                probe=probe,
                display_name=display_name,
                detail=detail,
                auto_validate=auto_validate,
                auto_repair=auto_repair,
                session=session,
                soft_without_key=True,
            ):
                if isinstance(item, tuple) and item[0] == "done":
                    probe = item[1]
                    if probe.get("display_name"):
                        display_name = str(probe["display_name"])
                        _ensure_platform_registered(platform, display_name=display_name)
                else:
                    yield item  # type: ignore[misc]

    if not registered:
        return

    yield _emit_status(session, phase="write", message="平台账号已登记")

    validation: dict[str, Any] | None = None
    if auto_validate:
        if spec.skip_full_validate_when_probe_ok and probe.get("ok"):
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
