"""数据源接入、修复、校验与微信探测。"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from api.deps import feed_client
from api.models import AuthPrecheckRequest, CancelOnboardRequest
from auth.credential_store import precheck_entry_urls, sync_runtime_cookies
from core.llm import LLMError, sse_event
from feed.feed_errors import FeedError
from feed.feed_registry import UNGROUPED_GROUP_ID, feed_registry
from onboarding.source_onboarding_batch import cancel_batch, get_batch, start_batch
from onboarding.source_onboarding_cursor import cancel_cursor_run, run_onboarding_agent
from onboarding.source_onboarding_log import (
    OnboardingCancelled,
    cancel_job,
    create_session,
    list_recent_logs,
    read_log,
    unregister_session,
)
from onboarding.source_onboarding_refresh import refresh_with_auto_repair
from onboarding.source_skill_repair import resolve_skill_entry_url, run_skill_repair_agent
from onboarding.source_skill_writer import resolve_onboard_target, skill_dir_for, validate_slug
from paths import SKILLS_LIB
from schemas import OnboardBatchRequest, OnboardSourceRequest, RepairSourceRequest
from skills.skill_validate import run_validation

router = APIRouter(tags=["onboarding"])

def _resolve_onboard_group_id(group_id: str | None) -> str | None:
    raw = (group_id or "").strip()
    if not raw or raw == UNGROUPED_GROUP_ID:
        return None
    groups = feed_registry.list_groups()
    if any(str(group.get("id", "")) == raw for group in groups):
        return raw
    raise HTTPException(status_code=400, detail=f"分组不存在: {raw}")


async def _refresh_onboarded_feed(feed_id: str) -> dict:
    feed_client.ensure_feed_visible(feed_id)
    # 与批量接入一致：首拉只更新近 3 天列表元数据，不拉正文
    return await feed_client.refresh_feed(feed_id, days=3)


async def _watch_onboard_disconnect(request: Request, session) -> None:
    while not session.cancelled and not session.completed:
        if await request.is_disconnected():
            session.cancel(reason="disconnect")
            return
        await asyncio.sleep(0.4)


async def _sse_onboard_stream(body: OnboardSourceRequest, request: Request):
    session = None
    watcher: asyncio.Task | None = None
    try:
        yield ": connected\n\n"
        slug, name, entry_url = resolve_onboard_target(
            body.entry_url,
            slug=body.slug,
            name=body.name,
        )
        session = create_session(entry_url=entry_url, slug=slug, name=name)
        watcher = asyncio.create_task(_watch_onboard_disconnect(request, session))
        llm_config = body.llm_config.model_dump() if body.llm_config else None
        target_group_id = _resolve_onboard_group_id(body.group_id)
        result_data: dict | None = None

        yield sse_event(
            "status",
            {
                "phase": "start",
                "message": "Cursor 接入已启动",
                "job_id": session.job_id,
                "slug": slug,
                "entry_url": entry_url,
            },
        )

        async for event in run_onboarding_agent(
            slug=slug,
            name=name,
            entry_url=entry_url,
            hints=body.hints,
            list_api_hint=body.list_api_hint,
            llm_config=llm_config,
            auto_validate=body.auto_validate,
            session=session,
            auto_repair=body.auto_repair,
        ):
            if session.cancelled:
                break
            kind = event.get("event", "status")
            if kind == "result":
                result_data = event.get("data") or {}
                if body.reload:
                    feed_client.reload_skills()
                    result_data["feed_count"] = len(await feed_client.list_feeds())
                feed_id = str(result_data.get("feed_id") or "").strip()
                if target_group_id and feed_id:
                    feed_registry.assign_feed_to_group(feed_id, target_group_id)
                if feed_id:
                    yield sse_event(
                        "status",
                        {
                            "phase": "refreshing",
                            "message": "接入完成，正在拉取文章…",
                            "job_id": session.job_id,
                        },
                    )
                    refresh_result: dict | None = None
                    try:
                        async for refresh_event in refresh_with_auto_repair(
                            slug=slug,
                            do_refresh=lambda fid=feed_id: _refresh_onboarded_feed(fid),
                            reload_skills=feed_client.reload_skills,
                            session=session,
                            auto_validate=body.auto_validate,
                            auto_repair=body.auto_repair,
                        ):
                            if session.cancelled:
                                break
                            rev_kind = refresh_event.get("event", "status")
                            if rev_kind == "refresh_done":
                                refresh_result = refresh_event.get("data") or {}
                            elif rev_kind == "status":
                                payload = {
                                    "phase": refresh_event.get("phase") or "auto_repair",
                                    "message": refresh_event.get("message") or "自动修复中…",
                                    "job_id": session.job_id,
                                }
                                yield sse_event("status", payload)
                    except FeedError as refresh_exc:
                        result_data["refresh_error"] = str(refresh_exc)
                        session.finish(success=False, detail=result_data)
                        yield sse_event(
                            "error",
                            {
                                "detail": f"skill 已写入，但拉取失败: {refresh_exc}",
                                "job_id": session.job_id,
                                "feed_id": feed_id,
                            },
                        )
                        return
                    if session.cancelled:
                        break
                    if refresh_result is None:
                        yield sse_event(
                            "error",
                            {
                                "detail": "首拉未返回结果",
                                "job_id": session.job_id,
                            },
                        )
                        return
                    result_data["refresh"] = refresh_result
                    repaired = bool(refresh_result.get("auto_repaired"))
                    done_msg = str(refresh_result.get("message") or "文章拉取完成")
                    yield sse_event(
                        "status",
                        {
                            "phase": "refresh_done",
                            "message": (
                                f"自动修复后{done_msg}" if repaired else done_msg
                            ),
                            "job_id": session.job_id,
                        },
                    )
                result_data["job_id"] = session.job_id
                session.finish(success=True, detail=result_data)
                yield sse_event("result", result_data)
            elif kind == "analysis":
                payload = event.get("data") or {}
                payload["job_id"] = session.job_id
                yield sse_event("analysis", payload)
            else:
                if "job_id" not in event:
                    event["job_id"] = session.job_id
                yield sse_event("status", event)

        if session.cancelled:
            session.cleanup_partial_skill()
            session.log("cancelled")
            session.finish(success=False, detail={"cancelled": True})
            yield sse_event("cancelled", {"detail": "接入已取消", "job_id": session.job_id})
        else:
            yield sse_event("done", {**(result_data or {}), "job_id": session.job_id})
    except OnboardingCancelled:
        if session:
            session.cleanup_partial_skill()
            session.log("cancelled")
            session.finish(success=False, detail={"cancelled": True})
            yield sse_event("cancelled", {"detail": "接入已取消", "job_id": session.job_id})
    except LLMError as exc:
        if session:
            session.log("error", detail=str(exc))
            session.finish(success=False, detail={"error": str(exc)})
        yield sse_event("error", {"detail": str(exc), **({"job_id": session.job_id} if session else {})})
    except Exception as exc:
        if session:
            session.log("error", detail=str(exc))
            session.finish(success=False, detail={"error": str(exc)})
        yield sse_event(
            "error",
            {
                "detail": f"Agent 接入失败: {exc}",
                **({"job_id": session.job_id} if session else {}),
            },
        )
    finally:
        if watcher:
            watcher.cancel()
        if session:
            unregister_session(session.job_id)


async def _sse_repair_stream(slug: str, body: RepairSourceRequest, request: Request):
    session = None
    watcher: asyncio.Task | None = None
    try:
        yield ": connected\n\n"
        safe_slug = validate_slug(slug)
        skill_dir = skill_dir_for(safe_slug)
        if not skill_dir.is_dir():
            yield sse_event("error", {"detail": f"discovery skill 不存在: {safe_slug}-discovery"})
            return

        entry_url = resolve_skill_entry_url(safe_slug) or f"skill://{safe_slug}"
        session = create_session(
            entry_url=entry_url,
            slug=safe_slug,
            name=safe_slug,
            kind="repair",
        )
        watcher = asyncio.create_task(_watch_onboard_disconnect(request, session))
        result_data: dict | None = None

        yield sse_event(
            "status",
            {
                "phase": "start",
                "message": "Cursor 修复任务已启动",
                "job_id": session.job_id,
                "slug": safe_slug,
            },
        )

        async for event in run_skill_repair_agent(
            slug=safe_slug,
            feedback=body.feedback,
            issue_types=body.issue_types,
            sample_url=body.sample_url,
            auto_validate=body.auto_validate,
            session=session,
        ):
            if session.cancelled:
                break
            kind = event.get("event", "status")
            if kind == "result":
                result_data = event.get("data") or {}
                if body.reload:
                    feed_client.reload_skills()
                    result_data["feed_count"] = len(await feed_client.list_feeds())
                result_data["job_id"] = session.job_id
                session.finish(success=True, detail=result_data)
                yield sse_event("result", result_data)
            else:
                if "job_id" not in event:
                    event["job_id"] = session.job_id
                yield sse_event("status", event)

        if session.cancelled:
            session.log("cancelled")
            session.finish(success=False, detail={"cancelled": True})
            yield sse_event("cancelled", {"detail": "修复已取消", "job_id": session.job_id})
        else:
            yield sse_event("done", {**(result_data or {}), "job_id": session.job_id})
    except OnboardingCancelled:
        if session:
            session.log("cancelled")
            session.finish(success=False, detail={"cancelled": True})
            yield sse_event("cancelled", {"detail": "修复已取消", "job_id": session.job_id})
    except LLMError as exc:
        if session:
            session.log("error", detail=str(exc))
            session.finish(success=False, detail={"error": str(exc)})
        yield sse_event("error", {"detail": str(exc), **({"job_id": session.job_id} if session else {})})
    except Exception as exc:
        if session:
            session.log("error", detail=str(exc))
            session.finish(success=False, detail={"error": str(exc)})
        yield sse_event(
            "error",
            {
                "detail": f"Skill 修复失败: {exc}",
                **({"job_id": session.job_id} if session else {}),
            },
        )
    finally:
        if watcher:
            watcher.cancel()
        if session:
            unregister_session(session.job_id)


@router.post("/api/sources/onboard")
async def onboard_source(body: OnboardSourceRequest, request: Request):
    try:
        slug, name, entry_url = resolve_onboard_target(
            body.entry_url,
            slug=body.slug,
            name=body.name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if body.stream:
        return StreamingResponse(
            _sse_onboard_stream(body, request),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    llm_config = body.llm_config.model_dump() if body.llm_config else None
    target_group_id = _resolve_onboard_group_id(body.group_id)
    result_data: dict | None = None
    async for event in run_onboarding_agent(
        slug=slug,
        name=name,
        entry_url=entry_url,
        hints=body.hints,
        list_api_hint=body.list_api_hint,
        llm_config=llm_config,
        auto_validate=body.auto_validate,
        auto_repair=body.auto_repair,
    ):
        if event.get("event") == "result":
            result_data = event.get("data") or {}
    if not result_data:
        raise HTTPException(status_code=502, detail="Agent 未返回结果")
    if body.reload:
        feed_client.reload_skills()
        result_data["feed_count"] = len(await feed_client.list_feeds())
    feed_id = str(result_data.get("feed_id") or "").strip()
    if target_group_id and feed_id:
        feed_registry.assign_feed_to_group(feed_id, target_group_id)
    if feed_id:
        refresh_result: dict | None = None
        async for refresh_event in refresh_with_auto_repair(
            slug=slug,
            do_refresh=lambda fid=feed_id: _refresh_onboarded_feed(fid),
            reload_skills=feed_client.reload_skills,
            auto_validate=body.auto_validate,
            auto_repair=body.auto_repair,
        ):
            if refresh_event.get("event") == "refresh_done":
                refresh_result = refresh_event.get("data") or {}
        if refresh_result is None:
            raise HTTPException(status_code=502, detail="首拉未返回结果")
        result_data["refresh"] = refresh_result
    return result_data


@router.post("/api/sources/onboard/cancel")
async def cancel_onboard_source(body: CancelOnboardRequest):
    await cancel_cursor_run(body.job_id)
    if cancel_job(body.job_id):
        return {"ok": True, "job_id": body.job_id}
    raise HTTPException(status_code=404, detail="任务不存在或已结束")


@router.post("/api/sources/onboard/batch")
async def onboard_source_batch(body: OnboardBatchRequest):
    try:
        batch = await start_batch(
            entry_urls=body.entry_urls,
            feed_client=feed_client,
            max_concurrency=body.max_concurrency,
            auto_validate=body.auto_validate,
            reload=body.reload,
            group_id=body.group_id,
            auto_repair=body.auto_repair,
        )
        return batch.to_dict()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"批量接入失败: {exc}") from exc


@router.get("/api/sources/onboard/batch/{batch_id}")
async def get_onboard_batch(batch_id: str):
    batch = get_batch(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="批量任务不存在或已结束")
    return batch.to_dict()


@router.post("/api/sources/onboard/batch/{batch_id}/cancel")
async def cancel_onboard_batch(batch_id: str):
    if await cancel_batch(batch_id):
        batch = get_batch(batch_id)
        return {"ok": True, "batch_id": batch_id, **(batch.to_dict() if batch else {})}
    raise HTTPException(status_code=404, detail="批量任务不存在或已结束")


@router.get("/api/sources/onboard/logs")
async def list_onboard_logs(limit: int = Query(default=30, ge=1, le=100)):
    return {"ok": True, "logs": list_recent_logs(limit=limit)}


@router.get("/api/sources/onboard/logs/{job_id}")
async def get_onboard_log(job_id: str):
    records = read_log(job_id)
    if not records:
        raise HTTPException(status_code=404, detail="未找到该任务的日志")
    return {"ok": True, "job_id": job_id, "records": records}


@router.post("/api/sources/{slug}/repair")
async def repair_source(slug: str, body: RepairSourceRequest, request: Request):
    try:
        safe_slug = validate_slug(slug)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if body.stream:
        return StreamingResponse(
            _sse_repair_stream(safe_slug, body, request),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    result_data: dict | None = None
    async for event in run_skill_repair_agent(
        slug=safe_slug,
        feedback=body.feedback,
        issue_types=body.issue_types,
        sample_url=body.sample_url,
        auto_validate=body.auto_validate,
    ):
        if event.get("event") == "result":
            result_data = event.get("data") or {}
    if not result_data:
        raise HTTPException(status_code=502, detail="修复未返回结果")
    if body.reload:
        feed_client.reload_skills()
        result_data["feed_count"] = len(await feed_client.list_feeds())
    return result_data

@router.post("/api/sources/auth-precheck")
async def auth_precheck(body: AuthPrecheckRequest):
    urls = [str(url).strip() for url in body.entry_urls if str(url).strip()]
    if not urls:
        raise HTTPException(status_code=400, detail="请提供至少一个链接")
    return precheck_entry_urls(urls)


@router.get("/api/sources/weixin/search")
async def search_weixin_accounts(q: str = Query(..., min_length=1, max_length=80)):
    """按名称搜索公众号（需公众号后台凭证）。"""
    query = (q or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="请输入公众号名称")

    sync_runtime_cookies()
    from auth.credential_store import slot_configured

    if not slot_configured("weixin"):
        raise HTTPException(
            status_code=400,
            detail="ASKME_AUTH_REQUIRED:slot=weixin 请先在设置页或添加源弹窗登录【公众号】后台（勿选小程序）",
        )

    skills_lib = SKILLS_LIB
    import sys

    lib_path = str(skills_lib)
    if lib_path not in sys.path:
        sys.path.insert(0, lib_path)
    import weixin_common as w

    try:
        hits = w.search_biz(query, begin=0, count=10)
    except w.WeixinSearchRateLimited as exc:
        retry_after = int(getattr(exc, "retry_after", 60) or 60)
        raise HTTPException(
            status_code=429,
            detail=str(exc),
            headers={"Retry-After": str(max(1, retry_after))},
        ) from exc
    except RuntimeError as exc:
        detail = str(exc)
        status = 400 if "ASKME_AUTH_REQUIRED" in detail else 502
        raise HTTPException(status_code=status, detail=detail) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"搜索公众号失败: {exc}") from exc

    accounts = [w.normalize_search_hit(item) for item in hits]
    accounts = [a for a in accounts if a.get("fakeid")]
    return {"ok": True, "query": query, "accounts": accounts}


@router.get("/api/sources/weixin/resolve")
async def resolve_weixin_account_url(url: str = Query(..., min_length=8, max_length=500)):
    """从文章/带 __biz 的链接解析公众号（不走 searchbiz）。"""
    entry = (url or "").strip()
    if not entry:
        raise HTTPException(status_code=400, detail="请提供公众号文章或带 __biz 的链接")

    skills_lib = SKILLS_LIB
    import sys

    lib_path = str(skills_lib)
    if lib_path not in sys.path:
        sys.path.insert(0, lib_path)
    import weixin_common as w

    try:
        account = w.resolve_account_from_entry(entry)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"解析公众号链接失败: {exc}") from exc

    fakeid = str(account.get("fakeid") or "").strip()
    if not fakeid:
        raise HTTPException(status_code=400, detail="未能从链接解析出公众号")
    nickname = str(account.get("nickname") or account.get("askme_name") or "").strip()
    return {
        "ok": True,
        "url": entry,
        "fakeid": fakeid,
        "nickname": nickname,
        "entry_url": w.build_weixin_entry_url(fakeid, nickname=nickname),
    }


@router.post("/api/sources/{slug}/validate")
async def validate_source(slug: str):
    try:
        safe_slug = validate_slug(slug)
        return run_validation(safe_slug)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"验证失败: {exc}") from exc


