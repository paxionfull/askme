"""数据源接入编排：已知平台走脚手架，未知站走 Agent runtime（Askme / Cursor）。"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from feed.feed_registry import feed_registry
from onboarding.agent import (
    cancel_agent_run,
    emit_status,
    load_cursor_api_key,
    mask_cursor_api_key,
    run_skill_task,
)
from onboarding.source_onboarding_log import OnboardingSession
from onboarding.source_platform_scaffold import detect_platform
from onboarding.source_skill_writer import (
    is_complete_discovery_skill,
    remove_discovery_skill_dir,
    skill_dir_for,
    validate_slug,
)
from paths import PROJECT_ROOT

# 向后兼容：旧 import 路径仍可用
cancel_cursor_run = cancel_agent_run
_emit_status = emit_status


def _build_onboarding_prompt(
    *,
    slug: str,
    name: str,
    entry_url: str,
    hints: str,
    list_api_hint: str,
) -> str:
    from onboarding.discovery_skill_catalog import catalog_for_onboarding_prompt
    from prompts import render_prompt

    catalog = catalog_for_onboarding_prompt(exclude_slug=slug)
    catalog_md = str(catalog.get("markdown") or "").strip()
    catalog_path = str(catalog.get("catalog_path") or "")
    catalog_count = int(catalog.get("count") or 0)

    return render_prompt(
        "onboarding_create",
        catalog_path=catalog_path,
        catalog_count=catalog_count,
        entry_url=entry_url,
        slug=slug,
        name=name,
        hints=hints or "(无)",
        list_api_hint=list_api_hint or "(无)",
        catalog_md=catalog_md,
        project_root=str(PROJECT_ROOT),
    )


async def run_cursor_skill_task(
    *,
    slug: str,
    prompt: str,
    auto_validate: bool,
    session: OnboardingSession | None,
    result_engine: str = "cursor_sdk",
    mark_files_written: bool = False,
    auto_repair: bool = True,
    max_repair_attempts: int | None = None,
    llm_config: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """兼容旧名：统一走 Agent runtime。"""
    kwargs: dict[str, Any] = {
        "slug": slug,
        "prompt": prompt,
        "auto_validate": auto_validate,
        "session": session,
        "result_engine": result_engine,
        "mark_files_written": mark_files_written,
        "auto_repair": auto_repair,
        "llm_config": llm_config,
    }
    if max_repair_attempts is not None:
        kwargs["max_repair_attempts"] = max_repair_attempts
    async for event in run_skill_task(**kwargs):
        yield event


async def _run_unknown_site_onboarding(
    *,
    slug: str,
    name: str,
    entry_url: str,
    hints: str,
    list_api_hint: str,
    auto_validate: bool,
    session: OnboardingSession | None,
    auto_repair: bool = True,
    llm_config: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    prompt = _build_onboarding_prompt(
        slug=slug,
        name=name,
        entry_url=entry_url,
        hints=hints,
        list_api_hint=list_api_hint,
    )

    async for event in run_skill_task(
        slug=slug,
        prompt=prompt,
        auto_validate=auto_validate,
        session=session,
        mark_files_written=True,
        auto_repair=auto_repair,
        llm_config=llm_config,
    ):
        yield event


async def run_onboarding_agent(
    *,
    slug: str,
    name: str,
    entry_url: str,
    hints: str = "",
    list_api_hint: str = "",
    llm_config: dict[str, Any] | None = None,
    auto_validate: bool = True,
    session: OnboardingSession | None = None,
    auto_repair: bool = True,
) -> AsyncIterator[dict[str, Any]]:
    """统一接入入口：已知平台走脚手架，其余走 Askme/Cursor Agent。"""
    if session is not None and llm_config is not None:
        session.llm_config = llm_config

    safe_slug = validate_slug(slug)
    platform = detect_platform(entry_url.strip())
    feed_id = platform.feed_id if platform else f"website:{safe_slug}"

    if skill_dir_for(safe_slug).exists():
        if not is_complete_discovery_skill(safe_slug):
            remove_discovery_skill_dir(safe_slug)
            try:
                feed_registry.purge_feed(feed_id)
            except Exception:
                pass
            if session:
                session.log("cleanup_incomplete", slug=safe_slug, feed_id=feed_id)
        elif feed_registry.is_hidden(feed_id) or (
            is_complete_discovery_skill(safe_slug) and skill_dir_for(safe_slug).exists()
        ):
            restored = False
            if feed_registry.is_hidden(feed_id):
                feed_registry.unhide_feed(feed_id)
                restored = True
                if session:
                    session.log("restore", feed_id=feed_id, slug=safe_slug)
                yield emit_status(session, phase="restore", message="恢复已移除的数据源…")
            else:
                yield emit_status(
                    session,
                    phase="attach",
                    message="数据源 skill 已存在，准备加入分组…",
                )
            result_data = {
                "ok": True,
                "slug": safe_slug,
                "feed_id": feed_id,
                "skill_dir": f"{safe_slug}-discovery",
                "restored": restored,
                "already_exists": not restored,
                "analysis": {"restored": restored, "already_exists": not restored},
                "validation": None,
            }
            if session:
                session.log("result", data=result_data)
            yield {
                "event": "result",
                "data": result_data,
                **({"job_id": session.job_id} if session else {}),
            }
            return

    if platform:
        from onboarding.source_platform_onboard import run_platform_onboarding

        async for event in run_platform_onboarding(
            platform=platform,
            slug=safe_slug,
            name=name.strip(),
            auto_validate=auto_validate,
            session=session,
            auto_repair=auto_repair,
        ):
            yield event
        return

    async for event in _run_unknown_site_onboarding(
        slug=safe_slug,
        name=name.strip(),
        entry_url=entry_url.strip(),
        hints=hints,
        list_api_hint=list_api_hint,
        auto_validate=auto_validate,
        session=session,
        auto_repair=auto_repair,
        llm_config=llm_config,
    ):
        yield event
