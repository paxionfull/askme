"""统一接入 Agent runtime：选引擎 → 跑 agent → 可选 validate / auto_repair。

鉴权半成功（needs_auth）对 Askme / Cursor 同一套规则：
完整 skill + discovery_validate 撞 ASKME_AUTH_REQUIRED → result(ok, needs_auth)。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from core.llm import LLMError
from onboarding.async_blocking import run_blocking
from onboarding.onboarding_prompt_config import (
    DEFAULT_MAX_REPAIR_ATTEMPTS,
    PROMPT_CURSOR_RESULT_PREVIEW_CHARS,
)
from onboarding.agent.select import resolve_onboarding_engine
from onboarding.source_onboarding_log import OnboardingCancelled, OnboardingSession
from onboarding.source_skill_writer import (
    is_complete_discovery_skill,
    skill_dir_for,
    validate_slug,
)
from skills.skill_validate import run_validation


def emit_status(
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


async def cancel_agent_run(job_id: str) -> bool:
    """取消进行中的 Cursor / Askme agent run。"""
    from onboarding.agent.askme_provider import cancel_askme_run
    from onboarding.agent.cursor_provider import cancel_cursor_run

    cancelled = False
    if await cancel_cursor_run(job_id):
        cancelled = True
    if await cancel_askme_run(job_id):
        cancelled = True
    return cancelled


def _analysis_from_agent(
    *,
    analysis_engine: str,
    agent_done: dict[str, Any],
    needs_auth: bool = False,
) -> dict[str, Any]:
    data = {
        "engine": analysis_engine,
        "agent_id": agent_done.get("agent_id"),
        "run_id": agent_done.get("run_id"),
        "cursor_attempts": agent_done.get("attempts", 1),
        "cursor_result": str(agent_done.get("result_text") or "")[
            :PROMPT_CURSOR_RESULT_PREVIEW_CHARS
        ],
        "turns": agent_done.get("turns"),
        "phase": agent_done.get("phase"),
        "blocker": agent_done.get("blocker"),
    }
    if needs_auth:
        data["needs_auth"] = True
    return data


def _auth_result_data(
    *,
    safe_slug: str,
    analysis_engine: str,
    agent_done: dict[str, Any],
    auth_error: str,
) -> dict[str, Any]:
    return {
        "ok": True,
        "needs_auth": True,
        "slug": safe_slug,
        "feed_id": f"website:{safe_slug}",
        "skill_dir": f"{safe_slug}-discovery",
        "auth_error": auth_error,
        "analysis": _analysis_from_agent(
            analysis_engine=analysis_engine,
            agent_done=agent_done,
            needs_auth=True,
        ),
        "validation": None,
    }


def _yield_result(
    session: OnboardingSession | None,
    result_data: dict[str, Any],
) -> dict[str, Any]:
    if session:
        session.log("result", data=result_data)
    return {
        "event": "result",
        "data": result_data,
        **({"job_id": session.job_id} if session else {}),
    }


async def run_skill_task(
    *,
    slug: str,
    prompt: str,
    auto_validate: bool,
    session: OnboardingSession | None,
    result_engine: str | None = None,
    mark_files_written: bool = False,
    auto_repair: bool = True,
    max_repair_attempts: int = DEFAULT_MAX_REPAIR_ATTEMPTS,
    llm_config: dict[str, Any] | None = None,
    preferred_engine: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """运行接入/修复 Agent；完成后可选验证，失败可自动修复。"""
    safe_slug = validate_slug(slug)
    cfg = llm_config
    if cfg is None and session is not None:
        cfg = getattr(session, "llm_config", None)

    engine = resolve_onboarding_engine(cfg, preferred=preferred_engine)
    analysis_engine = result_engine or (
        "askme" if engine == "askme" else "cursor_sdk"
    )

    if engine == "askme":
        from onboarding.agent.askme_provider import run_askme_agent

        agent_stream = run_askme_agent(
            prompt=prompt,
            slug=safe_slug,
            session=session,
            emit_status=emit_status,
            llm_config=cfg,
        )
    else:
        from onboarding.agent.cursor_provider import run_cursor_agent

        agent_stream = run_cursor_agent(
            prompt=prompt,
            slug=safe_slug,
            session=session,
            emit_status=emit_status,
        )

    agent_done: dict[str, Any] | None = None
    async for event in agent_stream:
        if event.get("event") == "agent_done":
            agent_done = event
            break
        yield event

    if agent_done is None:
        raise LLMError("Agent 未返回完成事件", status_code=502)

    if mark_files_written and session and skill_dir_for(safe_slug).exists():
        session.mark_files_written()

    blocker = agent_done.get("blocker") if isinstance(agent_done.get("blocker"), dict) else None
    blocker_kind = str((blocker or {}).get("kind") or "")
    skill_complete = is_complete_discovery_skill(safe_slug)

    # 真接不了：无列表源
    if blocker_kind == "no_list_source":
        detail = str((blocker or {}).get("detail") or "无法找到可用列表源")
        raise LLMError(f"接入中止（无可用列表源）: {detail}", status_code=502)

    # 与 Cursor 对齐：鉴权/反爬须先有完整 skill，再交给 validate
    if blocker_kind in {"auth_required", "js_challenge"} and not skill_complete:
        detail = str((blocker or {}).get("detail") or "")
        raise LLMError(
            f"接入中止：已申报 {blocker_kind}，但 discovery skill 不完整"
            f"（须含可用 discover.py）。请写完三件套后重试；"
            f"详情缺 Cookie 时由 discover.py 抛 ASKME_AUTH_REQUIRED。"
            + (f" 详情: {detail}" if detail else ""),
            status_code=502,
        )

    if not skill_complete:
        raise LLMError(
            "Agent 已结束但 discovery skill 不完整"
            f"（缺少 skills/discovery/{safe_slug}-discovery/scripts/discover.py "
            "或未实现 FEED_ID/fetch_list_page/fetch_article_detail）",
            status_code=502,
        )

    validation: dict[str, Any] | None = None
    if auto_validate:
        from auth.auth_signals import (
            account_missing_should_skip_repair,
            auth_error_should_skip_repair,
        )
        from onboarding.source_skill_repair import (
            build_validation_failure_feedback,
            iter_auto_repair_agent,
        )

        last_error = ""
        attempts = max(1, int(max_repair_attempts))
        for attempt in range(attempts):
            if session:
                session.check_cancelled()
            yield emit_status(
                session,
                phase="validate" if attempt == 0 else "auto_repair",
                message="正在验证 skill…"
                if attempt == 0
                else (
                    f"验证失败，正在根据报错自动修复"
                    f"（{attempt}/{attempts - 1}）…"
                ),
            )
            try:
                validation = await run_blocking(run_validation, safe_slug)
                if session:
                    session.check_cancelled()
                    session.log("validation", ok=True, result=validation)
                break
            except OnboardingCancelled:
                raise
            except Exception as exc:
                last_error = str(exc)
                if session:
                    session.log(
                        "validation",
                        ok=False,
                        error=last_error,
                        attempt=attempt + 1,
                    )
                if session and session.cancelled:
                    raise OnboardingCancelled("接入任务已取消") from exc
                if auth_error_should_skip_repair(last_error):
                    # 完整 skill + AUTH → 半成功（Askme / Cursor 同一出口）
                    auth_error = (
                        last_error
                        if last_error.startswith("ASKME_AUTH_REQUIRED")
                        else f"ASKME_AUTH_REQUIRED 验证需登录授权: {last_error}"
                    )
                    result_data = _auth_result_data(
                        safe_slug=safe_slug,
                        analysis_engine=analysis_engine,
                        agent_done=agent_done,
                        auth_error=auth_error,
                    )
                    yield emit_status(
                        session,
                        phase="needs_auth",
                        message="Skill 已写入，验证需登录授权（请配置 Cookie 后重试）…",
                    )
                    yield _yield_result(session, result_data)
                    return
                if account_missing_should_skip_repair(last_error):
                    raise LLMError(
                        f"skill 验证失败: {last_error}",
                        status_code=502,
                    ) from exc
                if attempt >= attempts - 1:
                    raise LLMError(
                        f"Agent 已执行但 skill 验证失败: {last_error}",
                        status_code=502,
                    ) from exc
                if not auto_repair:
                    raise LLMError(
                        "Agent 已执行但 skill 验证失败"
                        f"（未开启自动修复）: {last_error}",
                        status_code=502,
                    ) from exc
                # 不完整 skill 不应进入 repair（写不出 discover.py 时修也无用）
                if not is_complete_discovery_skill(safe_slug):
                    raise LLMError(
                        f"Agent 已执行但 skill 验证失败: {last_error}",
                        status_code=502,
                    ) from exc
                async for event in iter_auto_repair_agent(
                    slug=safe_slug,
                    feedback=build_validation_failure_feedback(
                        last_error, slug=safe_slug
                    ),
                    error=last_error,
                    issue_types=["wrong_fields", "other"],
                    auto_validate=False,
                    session=session,
                    llm_config=cfg,
                ):
                    if event.get("event") == "auto_repair_succeeded":
                        continue
                    yield event

    result_data = {
        "ok": True,
        "slug": safe_slug,
        "feed_id": f"website:{safe_slug}",
        "skill_dir": f"{safe_slug}-discovery",
        "analysis": _analysis_from_agent(
            analysis_engine=analysis_engine,
            agent_done=agent_done,
        ),
        "validation": validation,
    }
    yield _yield_result(session, result_data)
