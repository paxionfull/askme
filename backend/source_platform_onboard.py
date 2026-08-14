"""已知平台的确定性接入（不走从零写代码）；失败时用 Cursor Agent 按报错迭代修复。"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from llm import LLMError
from source_onboarding_log import OnboardingSession
from source_platform_scaffold import (
    fetch_zhihu_profile_name,
    probe_jin10_api,
    probe_zhihu_api,
    scaffold_jin10_files,
    scaffold_zhihu_files,
)
from source_skill_repair import (
    build_probe_failure_feedback,
    build_validation_failure_feedback,
    iter_auto_repair_agent,
)
from source_skill_writer import skill_dir_for, write_skill_files
from skill_validate import run_validation

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
    if platform.platform == "zhihu":
        return scaffold_zhihu_files(platform, display_name=display_name)
    if platform.platform == "jin10":
        return scaffold_jin10_files(platform, display_name=display_name)
    raise LLMError(f"不支持的平台脚手架: {platform.platform}", status_code=400)


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
                    "知乎接入需要先在设置页配置 ZHIHU_COOKIE",
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
            write_skill_files(slug, _write_scaffold(platform, display_name=display_name))
            if session:
                session.mark_files_written()

            feedback = build_probe_failure_feedback(
                detail,
                slug=slug,
                platform=platform.platform,
                user_type=platform.user_type,
                user_id=platform.user_id,
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

            yield _emit_status(session, phase="recon", message="自动修复完成，重新探测 API…")
            probe = probe_zhihu_api(platform)
            yield _emit_analysis(session, {"platform": "zhihu", "probe": probe, "reprobed": True})
            if not probe.get("ok"):
                raise LLMError(
                    f"自动修复后知乎 API 探测仍失败: {probe.get('error') or detail}",
                    status_code=502,
                )

        display_name = probe.get("display_name") or fetch_zhihu_profile_name(platform) or display_name
        if not skill_dir_for(slug).exists():
            yield _emit_status(
                session,
                phase="scaffold",
                message=f"使用 {platform.platform} 模板生成 skill…",
            )
            write_skill_files(slug, _write_scaffold(platform, display_name=display_name))
            if session:
                session.mark_files_written()
        else:
            # 探测阶段已写入脚手架；用探测到的显示名刷新元数据
            write_skill_files(slug, _write_scaffold(platform, display_name=display_name))

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
            write_skill_files(slug, _write_scaffold(platform, display_name=display_name))
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
            write_skill_files(slug, _write_scaffold(platform, display_name=display_name))
            if session:
                session.mark_files_written()
    else:
        return

    yield _emit_status(session, phase="write", message="skill 文件已就绪")

    validation: dict[str, Any] | None = None
    if auto_validate:
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
                validation = run_validation(slug)
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
                    # 无 Cursor 时退回确定性重写脚手架再试
                    write_skill_files(slug, _write_scaffold(platform, display_name=display_name))
                    continue
                feedback = build_validation_failure_feedback(last_error, slug=slug)
                async for event in _run_repair_and_forward(
                    slug=slug,
                    feedback=feedback,
                    error=last_error,
                    auto_validate=False,
                    session=session,
                ):
                    yield event

    result_data = {
        "ok": True,
        "slug": slug,
        "feed_id": platform.feed_id,
        "skill_dir": f"{slug}-discovery",
        "analysis": {"platform": platform.platform, "scaffold": True, "probe": probe},
        "validation": validation,
    }
    if session:
        session.log("result", data=result_data)
    yield {"event": "result", "data": result_data, **({"job_id": session.job_id} if session else {})}
