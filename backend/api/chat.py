"""对话与 RAG 索引。"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from api.deps import article_service, chat_service
from chat.chat_service import (
    SCOPED_SUMMARIZE_DEFAULT_QUESTION,
    run_rag_chat,
    run_scoped_article_summarize,
)
from core.llm import LLMError, sse_event
from digest.digest_cache import get_summary as get_cached_summary
from feed.content_job_manager import ChatJobCallbacks, content_job_manager
from feed.feed_errors import FeedError
from schemas import BuildIndexRequest, ChatRequest
from skills.skill_config import get_chat_system_prompt

router = APIRouter(tags=["chat"])

NO_RAG_INDEX_DETAIL = "请先在数据源页拉取正文并建立索引"

# 对话生成后台任务轮询转发的间隔；越小越接近真实逐字打印，但轮询过密无收益。
CHAT_JOB_POLL_INTERVAL = 0.05


def _apply_chat_job_event(raw: str, cb: ChatJobCallbacks) -> None:
    """将 run_rag_chat / run_scoped_article_summarize 产出的 SSE 字符串写入任务缓冲区。"""
    event = "message"
    payload: dict = {}
    for line in raw.splitlines():
        if line.startswith("event:"):
            event = line[len("event:") :].strip()
        elif line.startswith("data:"):
            try:
                payload = json.loads(line[len("data:") :].strip())
            except Exception:
                payload = {}
    if event == "token":
        cb.append_content(str(payload.get("content", "")))
    elif event == "thinking":
        cb.append_thinking(str(payload.get("content", "")))
    elif event == "citations":
        cb.set_citations(payload.get("items", []))
    elif event == "prompt_preview":
        cb.set_prompt_preview(payload)
    elif event == "status":
        cb.set_status(str(payload.get("phase", "")), str(payload.get("message", "")))


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

        # 注意：文章解析 / 建索引 / 检索校验等耗时步骤全部放进 runner，
        # 在后台任务内部执行——这样 start_chat() 能在校验完成前就同步拿到 job_id，
        # 前端可以立刻记下 job_id 再等结果，避免“job_id 还没到就刷新页面”导致断线后接不上生成。

        if body.summarize_scope:
            if not body.article_scope:
                yield sse_event("error", {"detail": "请先拖入或选定要摘要的文章"})
                return

            async def runner(cb: ChatJobCallbacks) -> dict:
                cb.set_status("loading_articles", "正在加载选定文章正文…")
                articles = await article_service.collect_scoped_article_bodies(body.article_scope)
                if not articles:
                    raise RuntimeError("选定文章暂无正文，请先在数据源页拉取正文后重试")
                async for event in run_scoped_article_summarize(
                    question=question or SCOPED_SUMMARIZE_DEFAULT_QUESTION,
                    articles=articles,
                    history=history,
                    llm_config=llm_config,
                    enable_thinking=body.enable_thinking,
                    chat_service=chat_service,
                    system_prompt=body.system_prompt.strip() or get_chat_system_prompt(),
                ):
                    if cb.is_cancelled():
                        return {}
                    _apply_chat_job_event(event, cb)
                return {"has_summary": True}

        else:
            if not question:
                yield sse_event("error", {"detail": "请提供用户问题"})
                return

            async def runner(cb: ChatJobCallbacks) -> dict:
                if body.use_rag and body.article_scope:
                    cb.set_status("indexing", "正在准备选定文章的检索索引…")
                article_pairs = await _resolve_scoped_article_pairs(body.article_scope, llm_config)
                cutoff_iso = article_service.scope_cutoff_iso(body.days)

                if body.use_rag and body.article_scope and not article_pairs:
                    raise RuntimeError(
                        "未能匹配到可检索的文章，请先在数据源页拉取该文正文；若已拉取，请检查 Embedding 配置后重试"
                    )

                if body.use_rag:
                    chunk_count = chat_service.count_chunks(cutoff_iso, feed_ids, article_pairs)
                    if chunk_count == 0:
                        detail = NO_RAG_INDEX_DETAIL
                        if article_pairs:
                            detail = "所选文章尚未建立索引，请先在数据源页拉取正文并建立索引"
                        raise RuntimeError(detail)

                summary = body.summary.strip() or get_cached_summary(body.days, feed_ids)
                titles = await article_service.get_scope_titles(body.days, feed_ids)

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
                    if cb.is_cancelled():
                        return {}
                    _apply_chat_job_event(event, cb)
                return {"has_summary": bool(summary.strip())}

        # 生成放入后台任务，与本次请求/连接解耦：刷新页面不会中断生成，
        # 断线期间产出的内容会缓冲在任务状态里，重连后可通过 /api/chat/jobs/current 取回。
        # 若已有任务在跑（如编辑重发），会被新任务直接抢占取消。
        started = content_job_manager.start_chat(runner=runner)
        job_id = started.get("job_id")
        # 立刻把 job_id 告知前端并落盘，不等轮询探测到 phase 变化——
        # 否则前端来不及记下 job_id 就刷新页面时，会彻底接不上这次生成。
        yield sse_event("status", {"phase": "", "message": "", "job_id": job_id})

        async for out_event in _watch_chat_job(job_id):
            yield out_event
    except LLMError as exc:
        yield sse_event("error", {"detail": str(exc)})
    except FeedError as exc:
        yield sse_event("error", {"detail": str(exc)})
    except Exception as exc:
        yield sse_event("error", {"detail": f"对话失败: {exc}"})


async def _watch_chat_job(job_id: str | None):
    """轮询任务缓冲区，把新增内容转发为 SSE；任务本身在后台独立运行，不受本次轮询取消影响。"""
    sent_len = 0
    sent_thinking_len = 0
    sent_citations = False
    sent_prompt_preview = False
    last_phase = ""

    def _flush(status: dict):
        nonlocal sent_len, sent_thinking_len, sent_citations, sent_prompt_preview
        events = []
        content = status.get("content") or ""
        thinking = status.get("thinking") or ""
        if len(content) > sent_len:
            events.append(sse_event("token", {"content": content[sent_len:]}))
            sent_len = len(content)
        if len(thinking) > sent_thinking_len:
            events.append(sse_event("thinking", {"content": thinking[sent_thinking_len:]}))
            sent_thinking_len = len(thinking)
        citations = status.get("citations")
        if citations is not None and not sent_citations:
            events.append(sse_event("citations", {"items": citations}))
            sent_citations = True
        preview = status.get("prompt_preview")
        if preview and not sent_prompt_preview:
            events.append(sse_event("prompt_preview", preview))
            sent_prompt_preview = True
        return events

    while True:
        status = content_job_manager.get_chat_status()
        if status.get("job_id") != job_id:
            yield sse_event("error", {"detail": "对话生成已被新的请求取代"})
            return
        for event in _flush(status):
            yield event
        phase = status.get("phase") or ""
        if phase and phase != last_phase:
            yield sse_event(
                "status",
                {"phase": phase, "message": status.get("message", ""), "job_id": job_id},
            )
            last_phase = phase
        if status.get("status") != "running":
            break
        await asyncio.sleep(CHAT_JOB_POLL_INTERVAL)

    final_status = content_job_manager.get_chat_status()
    if final_status.get("job_id") == job_id:
        for event in _flush(final_status):
            yield event
        status_kind = final_status.get("status")
        if status_kind == "error":
            yield sse_event("error", {"detail": final_status.get("error") or "对话失败"})
        elif status_kind == "cancelled":
            yield sse_event("cancelled", {"detail": "已取消"})
        else:
            result = final_status.get("result") or {}
            yield sse_event("done", {"has_summary": bool(result.get("has_summary"))})


@router.post("/api/rag/index")
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
        return result
    except HTTPException:
        raise
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except FeedError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"建立索引失败: {exc}") from exc


@router.post("/api/rag/index/jobs")
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
        # 无新正文时 article_count=0，仍返回已有 chunk_count，不视为失败
        return await article_service.build_rag_index(
            days=body.days,
            feed_ids=body.feed_ids or None,
            llm_config=llm_config,
            on_progress=on_progress,
        )

    return await content_job_manager.start_index(runner=runner, params=params)


@router.get("/api/rag/index/jobs/current")
async def get_index_job_status():
    return content_job_manager.get_index_status()


@router.get("/api/rag/index/preview")
async def preview_rag_index(
    days: int = Query(3, ge=1, le=14),
    feed_ids: list[str] = Query(default=[]),
):
    resolved = feed_ids if feed_ids else None
    data = await article_service.get_cached_context_for_llm(days, resolved)
    articles = data.get("articles") or []
    indexable = article_service._indexable_articles(articles)
    return {
        "days": days,
        "feed_count": len(feed_ids) if feed_ids else None,
        "meta_count": int(data.get("meta_count") or 0),
        "article_count": len(indexable),
    }


async def _sse_rag_index_stream(body: BuildIndexRequest):
    try:
        llm_config = body.llm_config.model_dump() if body.llm_config else None
        data = await article_service.get_cached_context_for_llm(body.days, body.feed_ids or None)
        articles = data.get("articles") or []
        indexable = article_service._indexable_articles(articles)
        if not indexable:
            # 无新正文：按 0 篇增量成功返回，保留库内已有索引
            result = await article_service.build_rag_index(
                days=body.days,
                feed_ids=body.feed_ids or None,
                llm_config=llm_config,
            )
            yield sse_event("result", result)
            yield sse_event("done", {})
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
        yield sse_event("result", result)
        yield sse_event("done", {})
    except LLMError as exc:
        yield sse_event("error", {"detail": str(exc)})
    except FeedError as exc:
        yield sse_event("error", {"detail": str(exc)})
    except Exception as exc:
        yield sse_event("error", {"detail": f"建立索引失败: {exc}"})


@router.get("/api/rag/status")
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


@router.get("/api/rag/chunks/{chunk_id}")
async def get_rag_chunk(chunk_id: str):
    chunk = chat_service.rag.get_chunk(chunk_id)
    if not chunk:
        raise HTTPException(status_code=404, detail="片段不存在")
    return chunk


@router.get("/api/chat/jobs/current")
async def get_chat_job_status():
    return content_job_manager.get_chat_status()


@router.post("/api/chat/jobs/cancel")
async def cancel_chat_job():
    ok = content_job_manager.request_chat_cancel()
    return {"ok": ok}


@router.post("/api/chat")
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

