"""已知平台的确定性接入（不走 Cursor / LLM）。"""

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
from source_skill_writer import skill_dir_for, write_skill_files
from skill_validate import run_validation

MAX_REPAIR_ATTEMPTS = 3


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


async def run_platform_onboarding(
    *,
    platform,
    slug: str,
    name: str,
    auto_validate: bool,
    session: OnboardingSession | None = None,
) -> AsyncIterator[dict[str, Any]]:
    yield _emit_status(
        session,
        phase="detect",
        message=f"识别为已知平台：{platform.platform}",
    )

    yield _emit_status(session, phase="recon", message="正在探测平台 API…")
    if session:
        session.check_cancelled()

    if platform.platform == "zhihu":
        probe = probe_zhihu_api(platform)
        if platform.requires_cookie and not probe.get("ok"):
            detail = probe.get("error") or "平台 API 探测失败"
            if "ZHIHU_COOKIE" in detail or not probe.get("cookie_configured"):
                raise LLMError(
                    "知乎接入需要先在设置页配置 ZHIHU_COOKIE",
                    status_code=400,
                )
            raise LLMError(f"知乎 API 探测失败: {detail}", status_code=502)
        display_name = probe.get("display_name") or fetch_zhihu_profile_name(platform)
        file_map = scaffold_zhihu_files(platform, display_name=display_name)
        yield _emit_analysis(session, {"platform": "zhihu", "probe": probe, "scaffold": True})
    elif platform.platform == "jin10":
        probe = probe_jin10_api()
        if not probe.get("ok"):
            raise LLMError(f"金十 API 探测失败: {probe.get('error', 'unknown')}", status_code=502)
        display_name = "金十数据"
        file_map = scaffold_jin10_files(platform, display_name=display_name)
        yield _emit_analysis(session, {"platform": "jin10", "probe": probe, "scaffold": True})
    else:
        return

    yield _emit_status(session, phase="scaffold", message=f"使用 {platform.platform} 模板生成 skill…")
    yield _emit_status(session, phase="write", message="正在写入 skill 文件…")
    write_skill_files(slug, file_map)
    if session:
        session.mark_files_written()

    validation: dict[str, Any] | None = None
    if auto_validate:
        for attempt in range(MAX_REPAIR_ATTEMPTS):
            yield _emit_status(
                session,
                phase="validate" if attempt == 0 else "repair",
                message="正在验证 skill…"
                if attempt == 0
                else f"验证失败，重试中（{attempt}/{MAX_REPAIR_ATTEMPTS - 1}）…",
            )
            if session:
                session.check_cancelled()
            try:
                validation = run_validation(slug)
                if session:
                    session.log("validation", ok=True, result=validation)
                break
            except Exception as exc:
                if session:
                    session.log("validation", ok=False, error=str(exc), attempt=attempt + 1)
                if attempt >= MAX_REPAIR_ATTEMPTS - 1:
                    raise LLMError(
                        f"skill 验证失败: {exc}",
                        status_code=502,
                    ) from exc
                if platform.platform == "zhihu":
                    write_skill_files(slug, scaffold_zhihu_files(platform, display_name=display_name))
                elif platform.platform == "jin10":
                    write_skill_files(slug, scaffold_jin10_files(platform, display_name=display_name))

    result_data = {
        "ok": True,
        "slug": slug,
        "feed_id": platform.feed_id,
        "skill_dir": f"{slug}-discovery",
        "analysis": {"platform": platform.platform, "scaffold": True},
        "validation": validation,
    }
    if session:
        session.log("result", data=result_data)
    yield {"event": "result", "data": result_data, **({"job_id": session.job_id} if session else {})}
