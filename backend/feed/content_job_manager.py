"""可刷新后恢复的后台任务：拉取正文、建立索引、生成概览。"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any, Callable, Awaitable

logger = logging.getLogger(__name__)


def _new_job_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


class ContentJobManager:
    """单例式后台任务管理。同类型同时只允许一个运行。"""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._bodies_task: asyncio.Task | None = None
        self._index_task: asyncio.Task | None = None
        self._bodies: dict[str, Any] = self._idle_state("bodies")
        self._index: dict[str, Any] = self._idle_state("index")
        self._summarize: dict[str, Any] = self._idle_state("summarize")
        self._summarize_cancel: asyncio.Event | None = None
        self._bodies_cancel: asyncio.Event | None = None

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


content_job_manager = ContentJobManager()
