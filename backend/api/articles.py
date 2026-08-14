"""近期文章与正文任务。"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from api.deps import article_service
from core.llm import LLMError, sse_event
from feed.content_job_manager import content_job_manager
from feed.feed_errors import FeedError
from schemas import RecentArticlesRequest

router = APIRouter(tags=["articles"])

@router.get("/api/articles/recent")
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


@router.post("/api/articles/recent")
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


@router.post("/api/articles/bodies/jobs")
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

    async def runner(on_progress, is_cancelled=None):
        return await article_service.get_recent_articles(
            days=body.days,
            feed_ids=body.feed_ids or None,
            enrich=True,
            list_limit=body.list_limit,
            on_progress=on_progress,
            is_cancelled=is_cancelled,
        )

    started = await content_job_manager.start_bodies(runner=runner, params=params)
    return started


@router.post("/api/articles/bodies/jobs/cancel")
async def cancel_bodies_job():
    ok = content_job_manager.request_bodies_cancel()
    return {"ok": ok, "message": "已请求停止拉取正文" if ok else "当前没有进行中的正文任务"}


@router.get("/api/articles/bodies/jobs/current")
async def get_bodies_job_status():
    return content_job_manager.get_bodies_status()


@router.get("/api/articles/body")
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


