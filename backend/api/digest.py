"""简报缓存与概览生成。"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from api.deps import article_service, feed_client
from core.llm import LLMError, sse_event
from core.time_scope import is_timestamp_today
from digest.digest_cache import delete_summary
from digest.digest_cache import get_summary_entry
from digest.digest_cache import list_summary_entries
from digest.digest_cache import set_summary as cache_summary
from digest.digest_service import (
    build_article_refs,
    generate_partition_summary,
    partition_articles_by_groups,
    resolve_digest_skill_for_group,
    resolve_feed_ids_for_groups,
    stitch_digest_trees,
    stitch_summaries,
)
from feed.content_job_manager import content_job_manager
from feed.feed_errors import FeedError
from feed.feed_registry import UNGROUPED_GROUP_ID, feed_registry
from schemas import SummarizeRequest


def _missing_digest_rule_detail(group_ids: list[str] | None) -> str | None:
    """所选分组若未绑定整理规则，返回错误文案；否则 None。"""
    if not group_ids:
        return None
    groups = {str(g.get("id")): g for g in feed_registry.list_groups()}
    for gid in group_ids:
        if gid == UNGROUPED_GROUP_ID:
            return "「未分组」无法生成简报，请先将源归入板块并设置整理规则。"
        group = groups.get(gid)
        if not group:
            return f"分组不存在：{gid}"
        if not resolve_digest_skill_for_group(group):
            name = str(group.get("name") or gid)
            return (
                f"「{name}」尚未设置整理规则，无法生成简报。"
                "请先在管理分组或简报页绑定规则。"
            )
    return None

router = APIRouter(tags=["digest"])


def _no_body_detail(meta_count: int) -> str:
    if meta_count > 0:
        return (
            f"找到 {meta_count} 篇文章，但均无法获取正文。"
            "请先在「数据源」页刷新订阅后重试。"
        )
    return "所选时间范围内没有文章"


NO_CACHED_CONTEXT_DETAIL = "请先在数据源页点击「拉取正文」后再生成概览。"


def _brief_title(summary: str) -> str:
    for line in summary.splitlines():
        text = line.strip()
        if not text:
            continue
        while text.startswith("#"):
            text = text.lstrip("#").strip()
        if text:
            return text[:120] if len(text) > 120 else text
    return "Untitled brief"


def _source_count(article_refs: list) -> int:
    feeds: set[str] = set()
    for ref in article_refs:
        if not isinstance(ref, dict):
            continue
        feed_id = str(ref.get("feed_id") or "").strip()
        if feed_id:
            feeds.add(feed_id)
    return len(feeds)


async def _resolve_group_names(group_ids: list[str]) -> list[str]:
    if not group_ids:
        return []
    groups = {str(g.get("id")): g for g in feed_registry.list_groups()}
    names: list[str] = []
    for gid in group_ids:
        group = groups.get(gid)
        if group:
            name = str(group.get("name") or gid).strip()
            if name:
                names.append(name)
    return names


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
    if meta_count <= 0:
        return "所选时间范围内没有文章"
    if body.use_cached_context:
        return NO_CACHED_CONTEXT_DETAIL
    return _no_body_detail(meta_count)


async def _watch_summarize_disconnect(request: Request, job_id: str) -> None:
    while not content_job_manager.is_summarize_cancelled(job_id):
        if await request.is_disconnected():
            content_job_manager.request_summarize_cancel()
            break
        await asyncio.sleep(0.3)


async def _sse_summarize_stream(body: SummarizeRequest, request: Request | None = None):
    job_id: str | None = None
    watcher: asyncio.Task | None = None

    def _cancelled() -> bool:
        return bool(job_id and content_job_manager.is_summarize_cancelled(job_id))

    try:
        yield ": connected\n\n"
        if not body.group_ids:
            yield sse_event("error", {"detail": "请至少选择一个分组"})
            return

        begun = content_job_manager.begin_summarize(
            {
                "days": body.days,
                "group_ids": list(body.group_ids),
                "feed_ids": list(body.feed_ids or []),
            }
        )
        if not begun.get("started"):
            yield sse_event("error", {"detail": "已有概览生成任务进行中，请稍后再试"})
            return

        job_id = str(content_job_manager.get_summarize_status().get("job_id") or "")
        if request is not None and job_id:
            watcher = asyncio.create_task(_watch_summarize_disconnect(request, job_id))

        if _cancelled():
            yield sse_event("cancelled", {"detail": "已取消"})
            return

        if not body.use_cached_context:
            if job_id:
                content_job_manager.update_summarize(
                    job_id,
                    phase="loading_articles",
                    message="正在拉取文章正文...",
                )
            yield sse_event(
                "status",
                {"phase": "loading_articles", "message": "正在拉取文章正文..."},
            )

        if _cancelled():
            yield sse_event("cancelled", {"detail": "已取消"})
            return

        missing_rule = _missing_digest_rule_detail(body.group_ids)
        if missing_rule:
            yield sse_event("error", {"detail": missing_rule})
            return

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
        partition_total = len(partitions)

        for index, partition in enumerate(partitions):
            if _cancelled():
                yield sse_event("cancelled", {"detail": "已取消"})
                return

            group_name = str(partition.get("group_name") or "")
            skill_id = str(partition.get("digest_skill_id") or "")
            status_message = f"正在生成「{group_name}」概览（{len(partition['articles'])} 篇）..."
            if job_id:
                content_job_manager.update_summarize(
                    job_id,
                    phase="generating",
                    message=status_message,
                    current=index + 1,
                    total=partition_total,
                )
            yield sse_event(
                "status",
                {
                    "phase": "generating",
                    "message": status_message,
                    "group_id": partition.get("group_id"),
                    "digest_skill_id": skill_id,
                },
            )

            if len(partitions) > 1:
                header = f"## {group_name}\n\n"
                summary_parts.append(header)
                yield sse_event("token", {"content": header})

            status_queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue()

            async def _on_status(phase: str, message: str, _q=status_queue) -> None:
                await _q.put((phase, message))

            gen_task = asyncio.create_task(
                generate_partition_summary(
                    articles=partition["articles"],
                    digest_skill_id=skill_id,
                    llm_config=llm_config,
                    on_status=_on_status,
                )
            )
            while not gen_task.done():
                if _cancelled():
                    gen_task.cancel()
                    yield sse_event("cancelled", {"detail": "已取消"})
                    return
                try:
                    phase, message = await asyncio.wait_for(status_queue.get(), timeout=0.2)
                    if job_id:
                        content_job_manager.update_summarize(job_id, phase=phase, message=message)
                    yield sse_event(
                        "status",
                        {
                            "phase": phase,
                            "message": message,
                            "group_id": partition.get("group_id"),
                            "digest_skill_id": skill_id,
                        },
                    )
                except asyncio.TimeoutError:
                    await asyncio.sleep(0)
            while not status_queue.empty():
                phase, message = status_queue.get_nowait()
                if job_id:
                    content_job_manager.update_summarize(job_id, phase=phase, message=message)
                yield sse_event(
                    "status",
                    {
                        "phase": phase,
                        "message": message,
                        "group_id": partition.get("group_id"),
                        "digest_skill_id": skill_id,
                    },
                )

            if _cancelled():
                gen_task.cancel()
                yield sse_event("cancelled", {"detail": "已取消"})
                return

            part_text, part_tree = await gen_task
            if part_text:
                for line in part_text.splitlines(keepends=True) or [part_text]:
                    if _cancelled():
                        yield sse_event("cancelled", {"detail": "已取消"})
                        return
                    yield sse_event("token", {"content": line})
                    await asyncio.sleep(0)

            summary_parts.append(part_text)
            section_results.append(
                {
                    "group_id": partition.get("group_id"),
                    "group_name": group_name,
                    "summary": part_text,
                    "digest_tree": part_tree,
                }
            )

        if _cancelled():
            yield sse_event("cancelled", {"detail": "已取消"})
            return

        article_count = sum(len(partition["articles"]) for partition in partitions)
        article_refs = build_article_refs(partitions)
        final_summary = stitch_summaries(section_results) if len(partitions) > 1 else "".join(summary_parts)
        digest_tree = stitch_digest_trees(section_results)
        cache_summary(
            body.days,
            final_summary,
            body.feed_ids or None,
            group_ids=body.group_ids,
            article_count=article_count,
            truncated=total_truncated,
            article_refs=article_refs,
            digest_tree=digest_tree,
        )
        if job_id:
            content_job_manager.finish_summarize(job_id, status="done", message="概览生成完成")
            job_id = None
        yield sse_event(
            "done",
            {
                "article_count": article_count,
                "truncated": total_truncated,
                "article_refs": article_refs,
                "digest_tree": digest_tree,
            },
        )
    except asyncio.CancelledError:
        if job_id:
            content_job_manager.finish_summarize(job_id, status="cancelled", message="已取消")
            job_id = None
        yield sse_event("cancelled", {"detail": "已取消"})
    except LLMError as exc:
        if job_id:
            content_job_manager.finish_summarize(
                job_id,
                status="error",
                message=str(exc),
                error=str(exc),
            )
            job_id = None
        yield sse_event("error", {"detail": str(exc)})
    except FeedError as exc:
        if job_id:
            content_job_manager.finish_summarize(
                job_id,
                status="error",
                message=str(exc),
                error=str(exc),
            )
            job_id = None
        yield sse_event("error", {"detail": str(exc)})
    except Exception as exc:
        if job_id:
            content_job_manager.finish_summarize(
                job_id,
                status="error",
                message=f"概览生成失败: {exc}",
                error=f"概览生成失败: {exc}",
            )
            job_id = None
        yield sse_event("error", {"detail": f"概览生成失败: {exc}"})
    finally:
        if watcher is not None:
            watcher.cancel()
        if job_id and content_job_manager.is_summarize_running():
            final_status = (
                "cancelled"
                if content_job_manager.is_summarize_cancelled(job_id)
                else "error"
            )
            content_job_manager.finish_summarize(
                job_id,
                status=final_status,
                message="已取消" if final_status == "cancelled" else "概览生成失败",
            )


@router.get("/api/digest/summaries")
async def list_digest_summaries(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    entries, total = list_summary_entries(limit=limit, offset=offset)
    items = []
    for entry in entries:
        article_refs = entry.get("article_refs") or []
        group_ids = entry.get("group_ids") or []
        group_names = await _resolve_group_names(group_ids)
        items.append(
            {
                "cache_key": entry["cache_key"],
                "days": entry["days"],
                "title": _brief_title(str(entry.get("summary") or "")),
                "article_count": int(entry.get("article_count") or 0),
                "source_count": _source_count(article_refs),
                "truncated": bool(entry.get("truncated")),
                "updated_at": float(entry.get("updated_at") or 0),
                "group_ids": group_ids,
                "group_names": group_names,
                "feed_ids": entry.get("feed_ids") or [],
            }
        )
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/api/digest/summary")
async def get_digest_summary(
    days: int = Query(default=1, ge=1, le=30),
    feed_ids: list[str] = Query(default=[]),
    group_ids: list[str] = Query(default=[]),
    allow_history: bool = Query(default=False),
):
    entry = get_summary_entry(days, feed_ids or None, group_ids or None)
    # 简报「已生成」仅认当天（上海自然日）写出的缓存；跨日一律当未生成
    if entry and not allow_history and not is_timestamp_today(entry.get("updated_at")):
        entry = None
    if not entry:
        return {
            "summary": "",
            "article_count": 0,
            "truncated": False,
            "updated_at": None,
            "article_refs": [],
            "digest_tree": None,
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
        "digest_tree": entry.get("digest_tree"),
    }


@router.delete("/api/digest/summary")
async def delete_digest_summary(
    days: int = Query(default=1, ge=1, le=30),
    feed_ids: list[str] = Query(default=[]),
    group_ids: list[str] = Query(default=[]),
):
    delete_summary(days, feed_ids or None, group_ids or None)
    return {"ok": True}


@router.get("/api/summarize/jobs/current")
async def get_summarize_job_status():
    return content_job_manager.get_summarize_status()


@router.post("/api/summarize/jobs/cancel")
async def cancel_summarize_job():
    ok = content_job_manager.request_summarize_cancel()
    return {"ok": ok}


@router.post("/api/summarize")
async def summarize(body: SummarizeRequest, request: Request):
    try:
        llm_config = body.llm_config.model_dump() if body.llm_config else None

        if body.stream:
            return StreamingResponse(
                _sse_summarize_stream(body, request),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

        if not body.group_ids:
            raise HTTPException(status_code=400, detail="请至少选择一个分组")

        missing_rule = _missing_digest_rule_detail(body.group_ids)
        if missing_rule:
            raise HTTPException(status_code=400, detail=missing_rule)

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
            part_summary, part_tree = await generate_partition_summary(
                articles=partition["articles"],
                digest_skill_id=str(partition["digest_skill_id"]),
                llm_config=llm_config,
            )
            section_results.append(
                {
                    "group_id": partition.get("group_id"),
                    "group_name": partition["group_name"],
                    "summary": part_summary,
                    "digest_tree": part_tree,
                }
            )

        summary = stitch_summaries(section_results) if len(section_results) > 1 else section_results[0]["summary"]
        article_count = sum(len(partition["articles"]) for partition in partitions)
        article_refs = build_article_refs(partitions)
        digest_tree = stitch_digest_trees(section_results)
        cache_summary(
            body.days,
            summary,
            body.feed_ids or None,
            group_ids=body.group_ids,
            article_count=article_count,
            truncated=total_truncated,
            article_refs=article_refs,
            digest_tree=digest_tree,
        )
        return {
            "summary": summary,
            "article_count": article_count,
            "truncated": total_truncated,
            "article_refs": article_refs,
            "digest_tree": digest_tree,
        }
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except HTTPException:
        raise
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"概览生成失败: {exc}") from exc

