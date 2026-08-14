import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from article_service import ArticleService
from time_scope import filter_articles_by_days
from chat_service import (
    ChatService,
    SCOPED_SUMMARIZE_DEFAULT_QUESTION,
    run_rag_chat,
    run_scoped_article_summarize,
)
from digest_cache import delete_summary
from digest_cache import get_summary as get_cached_summary
from digest_cache import get_summary_entry
from digest_cache import set_summary as cache_summary
from content_job_manager import content_job_manager
from feed_scheduler import feed_scheduler
from llm import LLMError, complete, fetch_available_models, get_llm_status, sse_event, stream_llm
from digest_service import (
    build_article_refs,
    build_summary_messages_for_partition,
    get_system_prompt_for_skill,
    partition_articles_by_groups,
    resolve_feed_ids_for_groups,
    stitch_summaries,
)
from digest_skill_registry import (
    delete_user_digest_skill,
    get_digest_skill,
    get_digest_skill_detail,
    list_digest_skills,
    save_user_digest_skill,
)
from feed_registry import UNGROUPED_GROUP_ID, feed_registry
from schemas import (
    BuildIndexRequest,
    ChatRequest,
    ChatSkillInput,
    DigestSkillInput,
    RecentArticlesRequest,
    FeedRenameRequest,
    FeedGroupsRequest,
    LlmModelsRequest,
    LlmStatusRequest,
    OnboardBatchRequest,
    OnboardSourceRequest,
    RefreshAllRequest,
    RefreshGroupRequest,
    RepairSourceRequest,
    SkillConfigInput,
    SummarizeRequest,
)
from skill_config import get_chat_system_prompt, load_skill_config, save_skill_config
from skill_manager import (
    delete_discovery_skill_by_feed_id,
    delete_discovery_skill,
    delete_other_skill,
    get_chat_skill,
    get_discovery_skill_detail,
    get_other_skill_detail,
    list_all_skills,
    save_chat_skill,
)
from feed_client import FeedClient
from feed_errors import FeedError
from source_onboarding_batch import cancel_batch, get_batch, start_batch
from source_onboarding_refresh import refresh_with_auto_repair
from source_onboarding_cursor import cancel_cursor_run, load_cursor_api_key, mask_cursor_api_key, run_onboarding_agent
from source_onboarding_log import (
    OnboardingCancelled,
    cancel_job,
    create_session,
    list_recent_logs,
    read_log,
    unregister_session,
)
from source_skill_repair import resolve_skill_entry_url, run_skill_repair_agent
from source_skill_writer import resolve_onboard_target, skill_dir_for, validate_slug
from skill_validate import run_validation


@asynccontextmanager
async def lifespan(app: FastAPI):
    _set_runtime_zhihu_cookie(_get_saved_zhihu_cookie())
    _set_runtime_cursor_api_key(load_cursor_api_key())
    feed_scheduler.start(feed_client)
    for feed in await feed_client.list_feeds():
        feed_id = feed.get("id", "")
        if feed_id and feed_client.store.count_articles(feed_id) == 0:
            try:
                await feed_client.refresh_feed(feed_id)
            except Exception:
                pass
    yield
    feed_scheduler.shutdown()


app = FastAPI(title="Askme API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

feed_client = FeedClient()
article_service = ArticleService(feed_client)
chat_service = ChatService()
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SECRETS_PATH = DATA_DIR / "integrations.json"
CURSOR_API_KEY = "cursor_api_key"
ZHIHU_COOKIE_KEY = "zhihu_cookie"
ZHIHU_FEED_IDS = ["website:zhihu:aitechtalk", "website:zhihu:xinziyuan"]


class ScheduleTimeRequest(BaseModel):
    hour: int = Field(ge=0, le=23)
    minute: int = Field(ge=0, le=59)
    second: int = Field(ge=0, le=59)


class FeedSchedulerConfigRequest(BaseModel):
    schedules: list[ScheduleTimeRequest] = Field(default_factory=list)


class ZhihuCookieRequest(BaseModel):
    cookie: str = Field(..., min_length=1)


class CancelOnboardRequest(BaseModel):
    job_id: str = Field(..., min_length=1)


class CursorApiKeyRequest(BaseModel):
    api_key: str = Field(..., min_length=1)


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
    return await feed_client.refresh_feed(feed_id)


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


@app.post("/api/sources/onboard")
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


@app.post("/api/sources/onboard/cancel")
async def cancel_onboard_source(body: CancelOnboardRequest):
    await cancel_cursor_run(body.job_id)
    if cancel_job(body.job_id):
        return {"ok": True, "job_id": body.job_id}
    raise HTTPException(status_code=404, detail="任务不存在或已结束")


@app.post("/api/sources/onboard/batch")
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


@app.get("/api/sources/onboard/batch/{batch_id}")
async def get_onboard_batch(batch_id: str):
    batch = get_batch(batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="批量任务不存在或已结束")
    return batch.to_dict()


@app.post("/api/sources/onboard/batch/{batch_id}/cancel")
async def cancel_onboard_batch(batch_id: str):
    if await cancel_batch(batch_id):
        batch = get_batch(batch_id)
        return {"ok": True, "batch_id": batch_id, **(batch.to_dict() if batch else {})}
    raise HTTPException(status_code=404, detail="批量任务不存在或已结束")


@app.get("/api/sources/onboard/logs")
async def list_onboard_logs(limit: int = Query(default=30, ge=1, le=100)):
    return {"ok": True, "logs": list_recent_logs(limit=limit)}


@app.get("/api/sources/onboard/logs/{job_id}")
async def get_onboard_log(job_id: str):
    records = read_log(job_id)
    if not records:
        raise HTTPException(status_code=404, detail="未找到该任务的日志")
    return {"ok": True, "job_id": job_id, "records": records}


@app.post("/api/sources/{slug}/repair")
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


def _load_integrations() -> dict:
    if not SECRETS_PATH.exists():
        return {}
    try:
        return json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_integrations(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SECRETS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _mask_cookie(cookie: str) -> str:
    cookie = cookie.strip()
    if len(cookie) <= 16:
        return "*" * len(cookie)
    return f"{cookie[:8]}...{cookie[-8:]}"


def _get_saved_zhihu_cookie() -> str:
    value = str(_load_integrations().get(ZHIHU_COOKIE_KEY, "")).strip()
    return value


def _set_runtime_zhihu_cookie(cookie: str) -> None:
    cookie = cookie.strip()
    if cookie:
        os.environ["ZHIHU_COOKIE"] = cookie
    else:
        os.environ.pop("ZHIHU_COOKIE", None)


def _set_runtime_cursor_api_key(api_key: str) -> None:
    api_key = api_key.strip()
    if api_key:
        os.environ["CURSOR_API_KEY"] = api_key
    else:
        os.environ.pop("CURSOR_API_KEY", None)


@app.get("/api/health")
async def health():
    feeds = await feed_client.list_feeds()
    return {
        "status": "ok",
        "source": "website",
        "feed_count": len(feeds),
    }


@app.get("/api/llm/status")
async def llm_status_get():
    return get_llm_status()


@app.post("/api/llm/status")
async def llm_status_post(body: LlmStatusRequest | None = None):
    override = body.llm_config.model_dump() if body and body.llm_config else None
    return get_llm_status(override)


@app.post("/api/llm/models")
async def llm_models(body: LlmModelsRequest):
    try:
        models = await fetch_available_models(body.api_base, body.api_key)
        return {"models": models}
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取模型列表失败: {exc}") from exc


@app.get("/api/articles/recent")
async def get_recent_articles(
    days: int = Query(default=1, ge=1, le=30),
    feed_ids: list[str] = Query(default=[]),
    enrich: bool = Query(default=False),
    list_limit: int | None = Query(default=None, ge=1, le=100),
):
    try:
        result = await article_service.get_recent_articles(
            days=days,
            feed_ids=feed_ids or None,
            enrich=enrich,
            list_limit=list_limit,
        )
        return result
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取文章失败: {exc}") from exc



async def _sse_recent_articles_stream(body: RecentArticlesRequest):
    try:
        if body.enrich:
            yield sse_event(
                "status",
                {
                    "phase": "loading_articles",
                    "message": "正在拉取正文…",
                    "current": 0,
                    "total": 0,
                    "cached_count": 0,
                    "fetched_count": 0,
                },
            )

        progress_queue: asyncio.Queue[dict] = asyncio.Queue()

        async def on_progress(
            current: int,
            total: int,
            cached_count: int,
            fetched_count: int,
            feed_name: str,
        ) -> None:
            await progress_queue.put(
                {
                    "phase": "loading_articles",
                    "message": f"正在处理：{feed_name}" if feed_name else "正在拉取正文…",
                    "current": current,
                    "total": total,
                    "cached_count": cached_count,
                    "fetched_count": fetched_count,
                }
            )

        task = asyncio.create_task(
            article_service.get_recent_articles(
                days=body.days,
                feed_ids=body.feed_ids or None,
                enrich=body.enrich,
                list_limit=body.list_limit,
                on_progress=on_progress if body.enrich else None,
            )
        )

        while True:
            if task.done() and progress_queue.empty():
                break
            try:
                item = await asyncio.wait_for(progress_queue.get(), timeout=0.1)
            except TimeoutError:
                continue
            yield sse_event("status", item)

        result = await task
        yield sse_event("result", result)
        yield sse_event("done", result)
    except FeedError as exc:
        yield sse_event("error", {"detail": str(exc)})
    except LLMError as exc:
        yield sse_event("error", {"detail": str(exc)})
    except Exception as exc:
        yield sse_event("error", {"detail": f"获取文章失败: {exc}"})


@app.post("/api/articles/recent")
async def stream_recent_articles(body: RecentArticlesRequest):
    if not body.stream:
        return await get_recent_articles(
            days=body.days,
            feed_ids=body.feed_ids,
            enrich=body.enrich,
            list_limit=body.list_limit,
        )
    return StreamingResponse(
        _sse_recent_articles_stream(body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/articles/bodies/jobs")
async def start_bodies_job(body: RecentArticlesRequest):
    if content_job_manager.is_bodies_running():
        status = content_job_manager.get_bodies_status()
        return {"started": False, "message": "正文拉取任务进行中", **status}

    params = {
        "days": body.days,
        "feed_ids": list(body.feed_ids or []),
        "list_limit": body.list_limit,
        "message": (body.progress_message or "").strip() or "正在拉取正文…",
        "group_id": (body.group_id or "").strip(),
    }

    async def runner(on_progress):
        return await article_service.get_recent_articles(
            days=body.days,
            feed_ids=body.feed_ids or None,
            enrich=True,
            list_limit=body.list_limit,
            on_progress=on_progress,
        )

    started = await content_job_manager.start_bodies(runner=runner, params=params)
    return started


@app.get("/api/articles/bodies/jobs/current")
async def get_bodies_job_status():
    return content_job_manager.get_bodies_status()


@app.get("/api/articles/body")
async def get_article_body(
    feed_id: str = Query(..., min_length=1),
    article_id: str = Query(..., min_length=1),
    fetch: bool = Query(True),
):
    try:
        body = await article_service.get_or_fetch_stored_body(
            feed_id,
            article_id,
            fetch=fetch,
        )
        if not body:
            raise HTTPException(status_code=404, detail="正文未拉取，请先在数据源页点击「拉取正文」")
        return body
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取正文失败: {exc}") from exc


async def _emit_llm_stream(messages: list[dict[str, str]], llm_config: dict | None = None):
    async for part in stream_llm(messages, llm_config):
        if part.kind == "thinking":
            yield sse_event("thinking", {"content": part.text})
        else:
            yield sse_event("token", {"content": part.text})
        await asyncio.sleep(0)


def _no_body_detail(meta_count: int) -> str:
    if meta_count > 0:
        return (
            f"找到 {meta_count} 篇文章，但均无法获取正文。"
            "请先在「数据源」页刷新订阅后重试。"
        )
    return "所选时间范围内暂无文章，请先到「数据源」页刷新订阅。"


NO_CACHED_CONTEXT_DETAIL = "请先在数据源页点击「拉取正文」后再生成概览。"


async def _resolve_summarize_scope(body: SummarizeRequest) -> tuple[list[str] | None, list[str] | None]:
    if body.group_ids:
        feed_ids = await resolve_feed_ids_for_groups(feed_client, body.group_ids)
        return (feed_ids or None), body.group_ids
    return (body.feed_ids or None), None


async def _resolve_summarize_context(body: SummarizeRequest) -> dict:
    feed_ids, _group_ids = await _resolve_summarize_scope(body)
    if body.use_cached_context:
        return await article_service.get_cached_context_for_llm(
            days=body.days,
            feed_ids=feed_ids,
        )
    return await article_service.get_context_for_llm(
        days=body.days,
        feed_ids=feed_ids,
    )


def _summarize_context_error(body: SummarizeRequest, meta_count: int) -> str:
    if body.use_cached_context:
        return NO_CACHED_CONTEXT_DETAIL
    return _no_body_detail(meta_count)


async def _sse_summarize_stream(body: SummarizeRequest):
    try:
        yield ": connected\n\n"
        if not body.group_ids:
            yield sse_event("error", {"detail": "请至少选择一个分组"})
            return

        if not body.use_cached_context:
            yield sse_event("status", {"phase": "loading_articles", "message": "正在拉取文章正文..."})

        data = await _resolve_summarize_context(body)
        meta_count = data.get("meta_count", data["article_count"])

        if not data["articles"]:
            yield sse_event("error", {"detail": _summarize_context_error(body, meta_count)})
            return

        groups = feed_registry.list_groups()
        partitions = partition_articles_by_groups(
            data["articles"],
            selected_group_ids=body.group_ids,
            groups=groups,
        )
        if not partitions:
            yield sse_event("error", {"detail": "所选分组内暂无可用正文"})
            return

        llm_config = body.llm_config.model_dump() if body.llm_config else None
        summary_parts: list[str] = []
        section_results: list[dict] = []
        total_truncated = bool(data.get("truncated"))

        for index, partition in enumerate(partitions):
            group_name = str(partition.get("group_name") or "")
            skill_id = str(partition.get("digest_skill_id") or "")
            yield sse_event(
                "status",
                {
                    "phase": "generating",
                    "message": f"正在生成「{group_name}」概览（{len(partition['articles'])} 篇）...",
                    "group_id": partition.get("group_id"),
                    "digest_skill_id": skill_id,
                },
            )

            prompt = body.prompt.strip() or get_system_prompt_for_skill(skill_id)
            messages, truncated = build_summary_messages_for_partition(
                article_service,
                system_prompt=prompt,
                articles=partition["articles"],
                days=body.days,
                digest_skill_id=skill_id,
            )
            total_truncated = total_truncated or truncated

            if len(partitions) > 1:
                header = f"## {group_name}\n\n"
                summary_parts.append(header)
                yield sse_event("token", {"content": header})

            part_chunks: list[str] = []
            async for part in stream_llm(
                messages,
                llm_config,
                temperature=0,
                enable_thinking=body.enable_thinking,
            ):
                if part.kind == "thinking":
                    yield sse_event("thinking", {"content": part.text})
                else:
                    part_chunks.append(part.text)
                    yield sse_event("token", {"content": part.text})
                await asyncio.sleep(0)

            part_text = "".join(part_chunks)
            summary_parts.append(part_text)
            section_results.append({"group_name": group_name, "summary": part_text})

        article_count = sum(len(partition["articles"]) for partition in partitions)
        article_refs = build_article_refs(partitions)
        final_summary = stitch_summaries(section_results) if len(partitions) > 1 else "".join(summary_parts)
        cache_summary(
            body.days,
            final_summary,
            body.feed_ids or None,
            group_ids=body.group_ids,
            article_count=article_count,
            truncated=total_truncated,
            article_refs=article_refs,
        )
        yield sse_event(
            "done",
            {
                "article_count": article_count,
                "truncated": total_truncated,
                "article_refs": article_refs,
            },
        )
    except LLMError as exc:
        yield sse_event("error", {"detail": str(exc)})
    except FeedError as exc:
        yield sse_event("error", {"detail": str(exc)})
    except Exception as exc:
        yield sse_event("error", {"detail": f"概览生成失败: {exc}"})


@app.get("/api/digest/summary")
async def get_digest_summary(
    days: int = Query(default=1, ge=1, le=30),
    feed_ids: list[str] = Query(default=[]),
    group_ids: list[str] = Query(default=[]),
):
    entry = get_summary_entry(days, feed_ids or None, group_ids or None)
    if not entry:
        return {
            "summary": "",
            "article_count": 0,
            "truncated": False,
            "updated_at": None,
            "article_refs": [],
        }
    article_refs = entry.get("article_refs") or []
    if not article_refs and entry.get("summary"):
        resolved_feed_ids = feed_ids or None
        if group_ids and not resolved_feed_ids:
            resolved_feed_ids = await resolve_feed_ids_for_groups(feed_client, group_ids)
        try:
            data = await article_service.get_cached_context_for_llm(days, resolved_feed_ids)
            article_refs = [
                {
                    "feed_id": str(article.get("feed_id", "")),
                    "article_id": str(article.get("id", "")),
                    "title": str(article.get("title", "")),
                    "url": str(article.get("url", "")),
                }
                for article in (data.get("articles") or [])
                if article.get("feed_id") and article.get("id")
            ]
        except Exception:
            article_refs = []
    return {
        "summary": entry["summary"],
        "article_count": entry["article_count"],
        "truncated": entry["truncated"],
        "updated_at": entry["updated_at"],
        "article_refs": article_refs,
    }


@app.delete("/api/digest/summary")
async def delete_digest_summary(
    days: int = Query(default=1, ge=1, le=30),
    feed_ids: list[str] = Query(default=[]),
    group_ids: list[str] = Query(default=[]),
):
    delete_summary(days, feed_ids or None, group_ids or None)
    return {"ok": True}


@app.post("/api/summarize")
async def summarize(body: SummarizeRequest):
    try:
        llm_config = body.llm_config.model_dump() if body.llm_config else None

        if body.stream:
            return StreamingResponse(
                _sse_summarize_stream(body),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

        if not body.group_ids:
            raise HTTPException(status_code=400, detail="请至少选择一个分组")

        data = await _resolve_summarize_context(body)
        meta_count = data.get("meta_count", data["article_count"])
        if not data["articles"]:
            raise HTTPException(
                status_code=404,
                detail=_summarize_context_error(body, meta_count),
            )

        groups = feed_registry.list_groups()
        partitions = partition_articles_by_groups(
            data["articles"],
            selected_group_ids=body.group_ids,
            groups=groups,
        )
        if not partitions:
            raise HTTPException(status_code=404, detail="所选分组内暂无可用正文")

        section_results: list[dict] = []
        total_truncated = bool(data.get("truncated"))
        for partition in partitions:
            prompt = body.prompt.strip() or get_system_prompt_for_skill(str(partition["digest_skill_id"]))
            messages, truncated = build_summary_messages_for_partition(
                article_service,
                system_prompt=prompt,
                articles=partition["articles"],
                days=body.days,
                digest_skill_id=str(partition["digest_skill_id"]),
            )
            total_truncated = total_truncated or truncated
            part_summary = await complete(
                messages,
                llm_config,
                temperature=0,
                enable_thinking=body.enable_thinking,
            )
            section_results.append(
                {"group_name": partition["group_name"], "summary": part_summary}
            )

        summary = stitch_summaries(section_results) if len(section_results) > 1 else section_results[0]["summary"]
        article_count = sum(len(partition["articles"]) for partition in partitions)
        article_refs = build_article_refs(partitions)
        cache_summary(
            body.days,
            summary,
            body.feed_ids or None,
            group_ids=body.group_ids,
            article_count=article_count,
            truncated=total_truncated,
            article_refs=article_refs,
        )
        return {
            "summary": summary,
            "article_count": article_count,
            "truncated": total_truncated,
            "article_refs": article_refs,
        }
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except HTTPException:
        raise
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"概览生成失败: {exc}") from exc


NO_RAG_INDEX_DETAIL = "请先在数据源页拉取正文并建立索引"


def _article_pairs_from_scope(article_scope: list) -> list[tuple[str, str]] | None:
    pairs = article_service.resolve_article_scope(article_scope)
    return pairs or None


async def _resolve_scoped_article_pairs(
    article_scope: list,
    llm_config: dict | None,
) -> list[tuple[str, str]] | None:
    pairs = await article_service.resolve_and_index_article_scope(article_scope, llm_config)
    return pairs or None


def _last_user_question(messages: list) -> str:
    for msg in reversed(messages):
        if msg.role == "user":
            return msg.content.strip()
    return ""


async def _sse_rag_chat_stream(body: ChatRequest):
    try:
        yield ": connected\n\n"
        feed_ids = body.feed_ids or None
        llm_config = body.llm_config.model_dump() if body.llm_config else None
        history = [{"role": msg.role, "content": msg.content} for msg in body.messages]
        question = _last_user_question(body.messages)

        if body.summarize_scope:
            if not body.article_scope:
                yield sse_event("error", {"detail": "请先拖入或选定要摘要的文章"})
                return
            yield sse_event(
                "status",
                {"phase": "loading_articles", "message": "正在加载选定文章正文…"},
            )
            articles = await article_service.collect_scoped_article_bodies(body.article_scope)
            if not articles:
                yield sse_event(
                    "error",
                    {"detail": "选定文章暂无正文，请先在数据源页拉取正文后重试"},
                )
                return
            async for event in run_scoped_article_summarize(
                question=question or SCOPED_SUMMARIZE_DEFAULT_QUESTION,
                articles=articles,
                history=history,
                llm_config=llm_config,
                enable_thinking=body.enable_thinking,
                chat_service=chat_service,
                system_prompt=body.system_prompt.strip() or get_chat_system_prompt(),
            ):
                yield event
                await asyncio.sleep(0)
            yield sse_event("done", {"has_summary": True})
            return

        if body.use_rag and body.article_scope:
            yield sse_event(
                "status",
                {"phase": "indexing", "message": "正在准备选定文章的检索索引…"},
            )
        article_pairs = await _resolve_scoped_article_pairs(body.article_scope, llm_config)
        cutoff_iso = article_service.scope_cutoff_iso(body.days)

        if body.use_rag and body.article_scope and not article_pairs:
            yield sse_event(
                "error",
                {"detail": "未能匹配到可检索的文章，请先在数据源页拉取该文正文；若已拉取，请检查 Embedding 配置后重试"},
            )
            return

        if body.use_rag:
            chunk_count = chat_service.count_chunks(cutoff_iso, feed_ids, article_pairs)
            if chunk_count == 0:
                detail = NO_RAG_INDEX_DETAIL
                if article_pairs:
                    detail = "所选文章尚未建立索引，请先在数据源页拉取正文并建立索引"
                yield sse_event("error", {"detail": detail})
                return

        summary = body.summary.strip() or get_cached_summary(body.days, feed_ids)
        titles = await article_service.get_scope_titles(body.days, feed_ids)
        if not question:
            yield sse_event("error", {"detail": "请提供用户问题"})
            return

        async for event in run_rag_chat(
            question=question,
            summary=summary,
            titles=titles,
            system_prompt=body.system_prompt.strip() or get_chat_system_prompt(),
            history=history,
            cutoff_iso=cutoff_iso,
            feed_ids=feed_ids,
            article_pairs=article_pairs,
            llm_config=llm_config,
            use_rag=body.use_rag,
            enable_thinking=body.enable_thinking,
            chat_service=chat_service,
        ):
            yield event
            await asyncio.sleep(0)

        yield sse_event("done", {"has_summary": bool(summary.strip())})
    except LLMError as exc:
        yield sse_event("error", {"detail": str(exc)})
    except FeedError as exc:
        yield sse_event("error", {"detail": str(exc)})
    except Exception as exc:
        yield sse_event("error", {"detail": f"对话失败: {exc}"})


@app.post("/api/rag/index")
async def build_rag_index(body: BuildIndexRequest):
    try:
        llm_config = body.llm_config.model_dump() if body.llm_config else None
        embedding_model = (llm_config or {}).get("embedding_model", "").strip()
        if not embedding_model:
            raise HTTPException(status_code=400, detail="请先在设置页选择并保存 Embedding 模型")
        if not (llm_config or {}).get("api_key", "").strip():
            raise HTTPException(status_code=400, detail="请先在设置页配置 API Key")

        if body.stream:
            return StreamingResponse(
                _sse_rag_index_stream(body),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

        result = await article_service.build_rag_index(
            days=body.days,
            feed_ids=body.feed_ids or None,
            llm_config=llm_config,
        )
        if result["article_count"] == 0:
            raise HTTPException(status_code=404, detail=NO_RAG_INDEX_DETAIL)
        return result
    except HTTPException:
        raise
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"建立索引失败: {exc}") from exc


@app.post("/api/rag/index/jobs")
async def start_index_job(body: BuildIndexRequest):
    if content_job_manager.is_index_running():
        status = content_job_manager.get_index_status()
        return {"started": False, "message": "索引任务进行中", **status}

    llm_config = body.llm_config.model_dump() if body.llm_config else None
    embedding_model = (llm_config or {}).get("embedding_model", "").strip()
    if not embedding_model:
        raise HTTPException(status_code=400, detail="请先在设置页选择并保存 Embedding 模型")
    if not (llm_config or {}).get("api_key", "").strip():
        raise HTTPException(status_code=400, detail="请先在设置页配置 API Key")

    params = {
        "days": body.days,
        "feed_ids": list(body.feed_ids or []),
    }

    async def runner(on_progress):
        result = await article_service.build_rag_index(
            days=body.days,
            feed_ids=body.feed_ids or None,
            llm_config=llm_config,
            on_progress=on_progress,
        )
        if result.get("article_count", 0) == 0:
            raise RuntimeError(NO_RAG_INDEX_DETAIL)
        return result

    return await content_job_manager.start_index(runner=runner, params=params)


@app.get("/api/rag/index/jobs/current")
async def get_index_job_status():
    return content_job_manager.get_index_status()


async def _sse_rag_index_stream(body: BuildIndexRequest):
    try:
        llm_config = body.llm_config.model_dump() if body.llm_config else None
        data = await article_service.get_cached_context_for_llm(body.days, body.feed_ids or None)
        articles = data.get("articles") or []
        indexable = article_service._indexable_articles(articles)
        if not indexable:
            yield sse_event("error", {"detail": NO_RAG_INDEX_DETAIL})
            return

        total = len(indexable)
        yield sse_event(
            "status",
            {
                "phase": "indexing",
                "message": "正在建立向量索引…",
                "current": 0,
                "total": total,
            },
        )

        progress_queue: asyncio.Queue[dict] = asyncio.Queue()

        async def emit_progress(current: int, article_total: int, title: str) -> None:
            await progress_queue.put(
                {
                    "phase": "indexing",
                    "message": title or f"第 {current} 篇",
                    "current": current,
                    "total": article_total,
                }
            )

        task = asyncio.create_task(
            article_service.build_rag_index(
                days=body.days,
                feed_ids=body.feed_ids or None,
                llm_config=llm_config,
                on_progress=emit_progress,
            )
        )
        while True:
            if task.done() and progress_queue.empty():
                break
            try:
                item = await asyncio.wait_for(progress_queue.get(), timeout=0.1)
            except TimeoutError:
                continue
            yield sse_event("status", item)

        result = await task
        if result["article_count"] == 0:
            yield sse_event("error", {"detail": NO_RAG_INDEX_DETAIL})
            return

        yield sse_event("result", result)
        yield sse_event("done", {})
    except LLMError as exc:
        yield sse_event("error", {"detail": str(exc)})
    except FeedError as exc:
        yield sse_event("error", {"detail": str(exc)})
    except Exception as exc:
        yield sse_event("error", {"detail": f"建立索引失败: {exc}"})


@app.get("/api/rag/status")
async def rag_status(
    days: int = Query(default=1, ge=1, le=30),
    feed_ids: list[str] = Query(default=[]),
):
    cutoff_iso = article_service.scope_cutoff_iso(days)
    ids = feed_ids or None
    chunk_count = chat_service.count_chunks(cutoff_iso, ids)
    return {
        "ready": chunk_count > 0,
        "chunk_count": chunk_count,
        "days": days,
    }


@app.get("/api/rag/chunks/{chunk_id}")
async def get_rag_chunk(chunk_id: str):
    chunk = chat_service.rag.get_chunk(chunk_id)
    if not chunk:
        raise HTTPException(status_code=404, detail="片段不存在")
    return chunk


@app.post("/api/chat")
async def chat(body: ChatRequest):
    try:
        llm_config = body.llm_config.model_dump() if body.llm_config else None

        if body.stream:
            return StreamingResponse(
                _sse_rag_chat_stream(body),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

        feed_ids = body.feed_ids or None
        article_pairs = await _resolve_scoped_article_pairs(body.article_scope, llm_config)
        cutoff_iso = article_service.scope_cutoff_iso(body.days)
        if body.use_rag and body.article_scope and not article_pairs:
            raise HTTPException(
                status_code=404,
                detail="未能匹配到可检索的文章，请先在数据源页拉取该文正文；若已拉取，请检查 Embedding 配置后重试",
            )
        if body.use_rag and chat_service.count_chunks(cutoff_iso, feed_ids, article_pairs) == 0:
            detail = NO_RAG_INDEX_DETAIL
            if article_pairs:
                detail = "所选文章尚未建立索引，请先在数据源页拉取正文并建立索引"
            raise HTTPException(status_code=404, detail=detail)

        summary = body.summary.strip() or get_cached_summary(body.days, feed_ids)
        titles = await article_service.get_scope_titles(body.days, feed_ids)
        question = _last_user_question(body.messages)
        if not question:
            raise HTTPException(status_code=400, detail="请提供用户问题")

        history = [{"role": msg.role, "content": msg.content} for msg in body.messages]
        reply_parts: list[str] = []
        citations: list[dict] = []

        async for event in run_rag_chat(
            question=question,
            summary=summary,
            titles=titles,
            system_prompt=body.system_prompt.strip() or get_chat_system_prompt(),
            history=history,
            cutoff_iso=cutoff_iso,
            feed_ids=feed_ids,
            article_pairs=article_pairs,
            llm_config=llm_config,
            use_rag=body.use_rag,
            enable_thinking=body.enable_thinking,
            chat_service=chat_service,
        ):
            if event.startswith("event: citations"):
                data_line = event.split("data:", 1)[1].strip()
                payload = json.loads(data_line)
                citations = payload.get("items", [])
            elif event.startswith("event: token"):
                data_line = event.split("data:", 1)[1].strip()
                payload = json.loads(data_line)
                reply_parts.append(payload.get("content", ""))

        return {
            "reply": "".join(reply_parts),
            "citations": citations,
            "has_summary": bool(summary.strip()),
        }
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except HTTPException:
        raise
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"对话失败: {exc}") from exc


@app.get("/api/settings/zhihu-cookie")
async def get_zhihu_cookie_status():
    cookie = _get_saved_zhihu_cookie()
    return {
        "configured": bool(cookie),
        "masked": _mask_cookie(cookie) if cookie else "",
    }


@app.put("/api/settings/zhihu-cookie")
async def save_zhihu_cookie(body: ZhihuCookieRequest):
    cookie = body.cookie.strip()
    if "d_c0=" not in cookie:
        raise HTTPException(status_code=400, detail="Cookie 缺少 d_c0，无法用于知乎接口")
    data = _load_integrations()
    data[ZHIHU_COOKIE_KEY] = cookie
    _save_integrations(data)
    _set_runtime_zhihu_cookie(cookie)
    return {"ok": True, "configured": True, "masked": _mask_cookie(cookie)}


@app.post("/api/settings/zhihu-cookie/verify")
async def verify_zhihu_cookie():
    cookie = _get_saved_zhihu_cookie()
    if not cookie:
        raise HTTPException(status_code=400, detail="请先保存知乎 Cookie")
    _set_runtime_zhihu_cookie(cookie)

    checked: list[str] = []
    for feed_id in ZHIHU_FEED_IDS:
        try:
            await feed_client.refresh_feed(feed_id)
            checked.append(feed_id)
        except FeedError as exc:
            if exc.status_code == 404:
                continue
            raise HTTPException(status_code=400, detail=f"知乎校验失败: {exc}") from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"知乎校验失败: {exc}") from exc

    if not checked:
        raise HTTPException(status_code=400, detail="未找到知乎数据源，请先确认技能已加载")
    return {"ok": True, "message": f"知乎 Cookie 可用（已校验 {len(checked)} 个数据源）"}


@app.get("/api/settings/cursor-api-key")
async def get_cursor_api_key_status():
    api_key = load_cursor_api_key()
    return {
        "configured": bool(api_key),
        "masked": mask_cursor_api_key(api_key) if api_key else "",
    }


@app.put("/api/settings/cursor-api-key")
async def save_cursor_api_key(body: CursorApiKeyRequest):
    api_key = body.api_key.strip()
    if len(api_key) < 8:
        raise HTTPException(status_code=400, detail="Cursor API Key 过短")
    data = _load_integrations()
    data[CURSOR_API_KEY] = api_key
    _save_integrations(data)
    _set_runtime_cursor_api_key(api_key)
    return {"ok": True, "configured": True, "masked": mask_cursor_api_key(api_key)}


@app.get("/api/settings/feed-scheduler")
async def get_feed_scheduler_config():
    return feed_scheduler.get_status()


@app.put("/api/settings/feed-scheduler")
async def update_feed_scheduler_config(body: FeedSchedulerConfigRequest):
    try:
        schedules = [item.model_dump() for item in body.schedules]
        return feed_scheduler.update_config(
            schedules=schedules,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/feeds/refresh-all")
async def refresh_all_feeds(body: RefreshAllRequest | None = None):
    try:
        days = body.days if body is not None else 1
        return feed_scheduler.start_refresh_all(feed_client, days=days)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"更新全部失败: {exc}") from exc


@app.post("/api/feeds/refresh-group")
async def refresh_group_feeds(body: RefreshGroupRequest):
    group_id = body.group_id.strip()
    if not group_id:
        raise HTTPException(status_code=400, detail="请指定分组")

    try:
        feed_ids = await resolve_feed_ids_for_groups(feed_client, [group_id])
        group_name = group_id
        if group_id == UNGROUPED_GROUP_ID:
            group_name = "未分组"
        else:
            for group in feed_registry.list_groups():
                if str(group.get("id", "")) == group_id:
                    group_name = str(group.get("name", "")).strip() or group_id
                    break
        return feed_scheduler.start_refresh_group(
            feed_client,
            group_id=group_id,
            group_name=group_name,
            feed_ids=feed_ids,
            days=body.days,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"更新分组失败: {exc}") from exc


@app.post("/api/feeds/reload-skills")
async def reload_feed_skills():
    try:
        count = feed_client.reload_skills()
        feeds = await feed_client.list_feeds()
        return {"ok": True, "feed_count": count, "feeds": [feed.get("id") for feed in feeds]}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"重新加载 skill 失败: {exc}") from exc


@app.post("/api/sources/{slug}/validate")
async def validate_source(slug: str):
    try:
        safe_slug = validate_slug(slug)
        return run_validation(safe_slug)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"验证失败: {exc}") from exc


@app.get("/api/feeds")
async def list_feeds():
    try:
        feeds = await feed_client.list_feeds()
        groups = feed_client.list_groups()
        group_order = feed_client.list_group_order()
        return {
            "feeds": [
                {
                    "id": feed["id"],
                    "name": feed.get("mpName", ""),
                    "cover": feed.get("mpCover", ""),
                    "intro": feed.get("mpIntro", ""),
                    "entry_url": feed.get("entryUrl", ""),
                    "sync_time": feed.get("syncTime"),
                    "status": feed.get("status"),
                    "group_id": feed.get("groupId"),
                }
                for feed in feeds
            ],
            "groups": groups,
            "group_order": group_order,
            "default_digest_skill": feed_registry.default_digest_skill(),
        }
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取数据源失败: {exc}") from exc


@app.delete("/api/feeds/{feed_id:path}")
async def delete_feed(
    feed_id: str,
    remove_skill: bool = Query(False),
):
    try:
        skill_removed = False
        if remove_skill:
            try:
                delete_discovery_skill_by_feed_id(feed_id)
                feed_client.reload_skills()
                skill_removed = True
            except ValueError:
                skill_removed = False
        if not skill_removed:
            feed_client.hide_feed(feed_id)
        return {"ok": True, "feed_id": feed_id, "skill_removed": skill_removed}
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"删除数据源失败: {exc}") from exc


@app.put("/api/feeds/{feed_id:path}/name")
async def rename_feed(feed_id: str, body: FeedRenameRequest):
    try:
        name = feed_client.rename_feed(feed_id, body.name)
        return {"ok": True, "feed_id": feed_id, "name": name}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"重命名数据源失败: {exc}") from exc


@app.get("/api/skills")
async def list_skills():
    try:
        return list_all_skills()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取 skill 列表失败: {exc}") from exc


@app.get("/api/skills/digest")
async def list_digest_skill_catalog():
    return {"skills": list_digest_skills(), "default_digest_skill": feed_registry.default_digest_skill()}


@app.get("/api/skills/digest/{skill_id}")
async def get_digest_skill_detail_endpoint(skill_id: str):
    try:
        return get_digest_skill_detail(skill_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/skills/digest")
async def create_digest_skill(body: DigestSkillInput):
    try:
        return save_user_digest_skill(
            body.id,
            skill_md=body.skill_md,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put("/api/skills/digest/{skill_id}")
async def update_digest_skill(skill_id: str, body: DigestSkillInput):
    try:
        return save_user_digest_skill(
            skill_id,
            skill_md=body.skill_md,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/skills/digest/{skill_id}")
async def remove_digest_skill(skill_id: str):
    try:
        delete_user_digest_skill(skill_id)
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/skills/discovery/{skill_id}")
async def get_discovery_skill(skill_id: str):
    try:
        return get_discovery_skill_detail(skill_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/skills/other/{skill_id}")
async def get_other_skill(skill_id: str):
    try:
        return get_other_skill_detail(skill_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/skills/discovery/{skill_id}")
async def remove_discovery_skill(skill_id: str):
    try:
        result = delete_discovery_skill(skill_id)
        feed_client.reload_skills()
        return {"ok": True, **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/skills/other/{skill_id}")
async def remove_other_skill(skill_id: str):
    try:
        result = delete_other_skill(skill_id)
        return {"ok": True, **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/skills/chat")
async def get_chat_skill_config():
    return get_chat_skill()


@app.put("/api/skills/chat")
async def save_chat_skill_config(body: ChatSkillInput):
    try:
        save_chat_skill(skill_md=body.skill_md)
        return get_chat_skill() | {"saved": True, "default_digest_skill": feed_registry.default_digest_skill()}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put("/api/skills/config")
async def save_skill_global_config(body: SkillConfigInput):
    try:
        if body.chat_system_prompt:
            save_skill_config({"chat_system_prompt": body.chat_system_prompt})
        if body.default_digest_skill:
            feed_registry.set_default_digest_skill(body.default_digest_skill)
        return {
            "ok": True,
            **load_skill_config(),
            "default_digest_skill": feed_registry.default_digest_skill(),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/feeds/groups")
async def get_feed_groups():
    try:
        return {
            "groups": feed_client.list_groups(),
            "group_order": feed_client.list_group_order(),
            "default_digest_skill": feed_registry.default_digest_skill(),
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取分组失败: {exc}") from exc


@app.put("/api/feeds/groups")
async def save_feed_groups(body: FeedGroupsRequest):
    try:
        groups, group_order = feed_client.set_layout(
            [
                {
                    "id": group.id,
                    "name": group.name,
                    "feed_ids": group.feed_ids,
                    "digest_skill_id": group.digest_skill_id,
                }
                for group in body.groups
            ],
            body.group_order,
        )
        if body.default_digest_skill:
            feed_registry.set_default_digest_skill(body.default_digest_skill)
        return {
            "ok": True,
            "groups": groups,
            "group_order": group_order,
            "default_digest_skill": feed_registry.default_digest_skill(),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"保存分组失败: {exc}") from exc


@app.post("/api/feeds/{feed_id:path}/refresh")
async def refresh_feed(
    feed_id: str,
    days: int = Query(default=1, ge=1, le=30),
):
    try:
        result = await feed_client.refresh_feed(feed_id, days=days)
        return result
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"刷新失败: {exc}") from exc


@app.get("/api/feeds/{feed_id:path}/articles")
async def get_articles(
    feed_id: str,
    limit: int | None = Query(default=None, ge=1, le=5000),
    days: int | None = Query(default=None, ge=1, le=30),
    refresh: bool = Query(default=False),
    fresh: bool = Query(default=False),
    include_content: bool = Query(default=False),
):
    try:
        # 按时间过滤时取该源全部再裁剪；否则默认 20 条兼容旧调用
        fetch_limit = None if days is not None else (limit if limit is not None else 20)
        articles = await feed_client.get_articles(
            feed_id,
            limit=fetch_limit,
            refresh=refresh,
            fresh=fresh,
            include_content=include_content,
        )
        if days is not None:
            articles = filter_articles_by_days(articles, days)
        if limit is not None:
            articles = articles[:limit]
        return articles
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取文章失败: {exc}") from exc


@app.get("/api/feeds/{feed_id:path}/articles/{article_id}")
async def get_article_detail(feed_id: str, article_id: str):
    try:
        return await feed_client.get_article_content(feed_id, article_id)
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取文章正文失败: {exc}") from exc
