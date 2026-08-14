"""可刷新后恢复的后台任务：拉取正文、建立索引、生成概览、对话生成。"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any, Callable, Awaitable

logger = logging.getLogger(__name__)


def _new_job_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


class ChatJobCallbacks:
    """传给对话生成 runner 的回调；runner 内调用即写入任务缓冲区，与请求连接生命周期无关。"""

    def __init__(self, manager: "ContentJobManager", job_id: str) -> None:
        self._manager = manager
        self._job_id = job_id

    def _live(self) -> bool:
        return self._manager._chat.get("job_id") == self._job_id

    def append_content(self, token: str) -> None:
        if not token or not self._live():
            return
        self._manager._chat["content"] = self._manager._chat.get("content", "") + token

    def append_thinking(self, chunk: str) -> None:
        if not chunk or not self._live():
            return
        self._manager._chat["thinking"] = self._manager._chat.get("thinking", "") + chunk

    def set_citations(self, items: list[dict[str, Any]]) -> None:
        if not self._live():
            return
        self._manager._chat["citations"] = items

    def set_prompt_preview(self, preview: dict[str, Any]) -> None:
        if not self._live():
            return
        self._manager._chat["prompt_preview"] = preview

    def set_status(self, phase: str, message: str = "") -> None:
        if not self._live():
            return
        if phase:
            self._manager._chat["phase"] = phase
        if message:
            self._manager._chat["message"] = message

    def is_cancelled(self) -> bool:
        if not self._live():
            return True
        cancel = self._manager._chat_cancel
        return cancel is not None and cancel.is_set()


class ContentJobManager:
    """单例式后台任务管理。同类型同时只允许一个运行。"""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._bodies_task: asyncio.Task | None = None
        self._index_task: asyncio.Task | None = None
        self._chat_task: asyncio.Task | None = None
        self._bodies: dict[str, Any] = self._idle_state("bodies")
        self._index: dict[str, Any] = self._idle_state("index")
        self._summarize: dict[str, Any] = self._idle_state("summarize")
        self._chat: dict[str, Any] = self._idle_chat_state()
        self._summarize_cancel: asyncio.Event | None = None
        self._bodies_cancel: asyncio.Event | None = None
        self._chat_cancel: asyncio.Event | None = None

    @staticmethod
    def _idle_state(kind: str) -> dict[str, Any]:
        return {
            "job_id": None,
            "kind": kind,
            "status": "idle",
            "current": 0,
            "total": 0,
            "message": "",
            "error": None,
            "result": None,
            "params": {},
            "started_at": None,
            "finished_at": None,
            "phase": "",
        }

    @staticmethod
    def _idle_chat_state() -> dict[str, Any]:
        return {
            "job_id": None,
            "kind": "chat",
            "status": "idle",
            "phase": "",
            "message": "",
            "content": "",
            "thinking": "",
            "citations": None,
            "prompt_preview": None,
            "error": None,
            "result": None,
            "started_at": None,
            "finished_at": None,
        }

    def get_bodies_status(self) -> dict[str, Any]:
        return dict(self._bodies)

    def get_index_status(self) -> dict[str, Any]:
        return dict(self._index)

    def is_bodies_running(self) -> bool:
        return self._bodies.get("status") == "running"

    def is_index_running(self) -> bool:
        return self._index.get("status") == "running"

    def get_summarize_status(self) -> dict[str, Any]:
        return dict(self._summarize)

    def is_summarize_running(self) -> bool:
        return self._summarize.get("status") == "running"

    def begin_summarize(self, params: dict[str, Any]) -> dict[str, Any]:
        if self.is_summarize_running():
            return {"started": False, **self.get_summarize_status()}
        job_id = _new_job_id("summarize")
        self._summarize_cancel = asyncio.Event()
        self._summarize = {
            "job_id": job_id,
            "kind": "summarize",
            "status": "running",
            "phase": "start",
            "current": 0,
            "total": 0,
            "message": "正在准备生成概览…",
            "error": None,
            "result": None,
            "params": params,
            "started_at": time.time(),
            "finished_at": None,
        }
        return {"started": True, **self.get_summarize_status()}

    def update_summarize(
        self,
        job_id: str,
        *,
        phase: str = "",
        message: str = "",
        current: int | None = None,
        total: int | None = None,
    ) -> None:
        if self._summarize.get("job_id") != job_id:
            return
        patch: dict[str, Any] = {}
        if phase:
            patch["phase"] = phase
        if message:
            patch["message"] = message
        if current is not None:
            patch["current"] = current
        if total is not None:
            patch["total"] = total
        if patch:
            self._summarize.update(patch)

    def is_summarize_cancelled(self, job_id: str) -> bool:
        if self._summarize.get("job_id") != job_id:
            return True
        cancel = self._summarize_cancel
        return cancel is not None and cancel.is_set()

    def request_summarize_cancel(self) -> bool:
        if not self.is_summarize_running():
            return False
        if self._summarize_cancel is not None:
            self._summarize_cancel.set()
        return True

    def is_bodies_cancelled(self) -> bool:
        cancel = self._bodies_cancel
        return cancel is not None and cancel.is_set()

    def request_bodies_cancel(self) -> bool:
        """请求停止当前正文拉取任务。"""
        if not self.is_bodies_running():
            return False
        if self._bodies_cancel is not None:
            self._bodies_cancel.set()
        if self._bodies_task is not None and not self._bodies_task.done():
            self._bodies_task.cancel()
        return True

    def finish_summarize(
        self,
        job_id: str,
        *,
        status: str = "done",
        message: str = "",
        error: str | None = None,
    ) -> None:
        if self._summarize.get("job_id") != job_id:
            return
        patch: dict[str, Any] = {
            "status": status,
            "finished_at": time.time(),
        }
        if message:
            patch["message"] = message
        if error:
            patch["error"] = error
        self._summarize.update(patch)
        self._summarize_cancel = None

    async def start_bodies(
        self,
        *,
        runner: Callable[..., Awaitable[dict[str, Any]]],
        params: dict[str, Any],
    ) -> dict[str, Any]:
        async with self._lock:
            if self.is_bodies_running():
                return {"started": False, **self.get_bodies_status()}
            job_id = _new_job_id("bodies")
            self._bodies_cancel = asyncio.Event()
            self._bodies = {
                "job_id": job_id,
                "kind": "bodies",
                "status": "running",
                "current": 0,
                "total": 0,
                "message": str(params.get("message") or "正在拉取正文…"),
                "error": None,
                "result": None,
                "params": params,
                "started_at": time.time(),
                "finished_at": None,
            }

            async def on_progress(
                current: int,
                total: int,
                cached_count: int,
                fetched_count: int,
                feed_name: str,
            ) -> None:
                if self._bodies.get("job_id") != job_id:
                    return
                self._bodies.update(
                    {
                        "current": current,
                        "total": total,
                        "message": f"正在处理：{feed_name}" if feed_name else "正在拉取正文…",
                        "cached_count": cached_count,
                        "fetched_count": fetched_count,
                    }
                )

            def is_cancelled() -> bool:
                return self.is_bodies_cancelled() or self._bodies.get("job_id") != job_id

            async def worker() -> None:
                try:
                    result = await runner(on_progress, is_cancelled)
                    if self._bodies.get("job_id") != job_id:
                        return
                    if is_cancelled():
                        self._bodies.update(
                            {
                                "status": "cancelled",
                                "message": "已停止拉取正文",
                                "result": result,
                                "finished_at": time.time(),
                            }
                        )
                        return
                    self._bodies.update(
                        {
                            "status": "done",
                            "message": "正文拉取完成",
                            "result": result,
                            "finished_at": time.time(),
                            "current": int(self._bodies.get("total") or 0),
                        }
                    )
                except asyncio.CancelledError:
                    if self._bodies.get("job_id") != job_id:
                        return
                    self._bodies.update(
                        {
                            "status": "cancelled",
                            "message": "已停止拉取正文",
                            "finished_at": time.time(),
                        }
                    )
                except Exception as exc:
                    logger.exception("拉取正文后台任务失败")
                    if self._bodies.get("job_id") != job_id:
                        return
                    self._bodies.update(
                        {
                            "status": "error",
                            "error": str(exc) or "拉取正文失败",
                            "message": str(exc) or "拉取正文失败",
                            "finished_at": time.time(),
                        }
                    )
                finally:
                    self._bodies_task = None
                    self._bodies_cancel = None

            self._bodies_task = asyncio.create_task(worker())
            return {"started": True, **self.get_bodies_status()}

    async def wait_for_bodies(self) -> dict[str, Any]:
        """等待当前正文任务结束（无任务则立即返回状态）。"""
        task = self._bodies_task
        if task is not None and not task.done():
            try:
                await task
            except asyncio.CancelledError:
                pass
        return self.get_bodies_status()

    async def start_index(
        self,
        *,
        runner: Callable[[Callable[..., Awaitable[None]]], Awaitable[dict[str, Any]]],
        params: dict[str, Any],
    ) -> dict[str, Any]:
        async with self._lock:
            if self.is_index_running():
                return {"started": False, **self.get_index_status()}
            job_id = _new_job_id("index")
            self._index = {
                "job_id": job_id,
                "kind": "index",
                "status": "running",
                "current": 0,
                "total": 0,
                "message": "正在建立向量索引…",
                "error": None,
                "result": None,
                "params": params,
                "started_at": time.time(),
                "finished_at": None,
            }

            async def on_progress(current: int, article_total: int, title: str) -> None:
                if self._index.get("job_id") != job_id:
                    return
                self._index.update(
                    {
                        "current": current,
                        "total": article_total,
                        "message": title or f"第 {current} 篇",
                    }
                )

            async def worker() -> None:
                try:
                    result = await runner(on_progress)
                    if self._index.get("job_id") != job_id:
                        return
                    self._index.update(
                        {
                            "status": "done",
                            "message": "索引建立完成",
                            "result": result,
                            "finished_at": time.time(),
                            "current": int(self._index.get("total") or 0),
                        }
                    )
                except Exception as exc:
                    logger.exception("建立索引后台任务失败")
                    if self._index.get("job_id") != job_id:
                        return
                    self._index.update(
                        {
                            "status": "error",
                            "error": str(exc) or "建立索引失败",
                            "message": str(exc) or "建立索引失败",
                            "finished_at": time.time(),
                        }
                    )
                finally:
                    self._index_task = None

            self._index_task = asyncio.create_task(worker())
            return {"started": True, **self.get_index_status()}

    def get_chat_status(self) -> dict[str, Any]:
        return dict(self._chat)

    def is_chat_running(self) -> bool:
        return self._chat.get("status") == "running"

    def start_chat(
        self,
        *,
        runner: Callable[[ChatJobCallbacks], Awaitable[dict[str, Any] | None]],
    ) -> dict[str, Any]:
        """启动对话生成后台任务，与请求/响应生命周期解耦；页面刷新不会中断生成。

        若已有对话任务在跑（如用户编辑重发、或旧任务未及时结束），新请求直接抢占：
        取消旧任务并立刻开始新的，旧任务的回调会因 job_id 不匹配自动失效。
        """
        if self.is_chat_running():
            if self._chat_cancel is not None:
                self._chat_cancel.set()
            if self._chat_task is not None and not self._chat_task.done():
                self._chat_task.cancel()
        job_id = _new_job_id("chat")
        self._chat_cancel = asyncio.Event()
        self._chat = {
            **self._idle_chat_state(),
            "job_id": job_id,
            "status": "running",
            "started_at": time.time(),
        }
        callbacks = ChatJobCallbacks(self, job_id)

        async def worker() -> None:
            try:
                result = await runner(callbacks)
                if self._chat.get("job_id") != job_id:
                    return
                if callbacks.is_cancelled():
                    self._chat.update({"status": "cancelled", "finished_at": time.time()})
                else:
                    self._chat.update(
                        {
                            "status": "done",
                            "result": result or {},
                            "finished_at": time.time(),
                        }
                    )
            except asyncio.CancelledError:
                if self._chat.get("job_id") == job_id:
                    self._chat.update({"status": "cancelled", "finished_at": time.time()})
            except Exception as exc:
                logger.exception("对话生成后台任务失败")
                if self._chat.get("job_id") != job_id:
                    return
                self._chat.update(
                    {
                        "status": "error",
                        "error": str(exc) or "对话生成失败",
                        "finished_at": time.time(),
                    }
                )
            finally:
                # 被新任务抢占时 job_id 已不同，不能清掉新任务的 task/cancel 引用
                if self._chat.get("job_id") == job_id:
                    self._chat_task = None
                    self._chat_cancel = None

        self._chat_task = asyncio.create_task(worker())
        return {"started": True, **self.get_chat_status()}

    def request_chat_cancel(self) -> bool:
        if not self.is_chat_running():
            return False
        if self._chat_cancel is not None:
            self._chat_cancel.set()
        return True


content_job_manager = ContentJobManager()
