"""批量数据源接入：并行调度多个 onboarding 任务。"""

from __future__ import annotations

import asyncio
import re
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Literal

from feed_errors import FeedError
from llm import LLMError
from source_onboarding_cursor import cancel_cursor_run, load_cursor_api_key, run_onboarding_agent
from source_onboarding_log import (
    OnboardingCancelled,
    create_session,
    unregister_session,
)
from source_onboarding_refresh import refresh_with_auto_repair
from source_platform_scaffold import detect_platform
from source_skill_writer import (
    is_complete_discovery_skill,
    remove_discovery_skill_dir,
    resolve_feed_id_for_target,
    resolve_onboard_target,
    skill_dir_for,
)

from feed_registry import UNGROUPED_GROUP_ID, feed_registry

MAX_BATCH_SIZE = 20
DEFAULT_MAX_CONCURRENCY = 5
RELOAD_DEBOUNCE_SECONDS = 1.5

ItemStatus = Literal["queued", "running", "done", "failed", "cancelled", "skipped"]
BatchStatus = Literal["running", "done", "cancelled"]


def parse_entry_urls(raw_urls: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for raw in raw_urls:
        for part in re.split(r"[\n,]+", raw):
            url = part.strip()
            if not url or url in seen:
                continue
            seen.add(url)
            ordered.append(url)
    if len(ordered) > MAX_BATCH_SIZE:
        raise ValueError(f"单次最多 {MAX_BATCH_SIZE} 个链接")
    return ordered


@dataclass
class BatchItem:
    entry_url: str
    slug: str = ""
    name: str = ""
    status: ItemStatus = "queued"
    phase: str = ""
    message: str = ""
    error: str | None = None
    feed_id: str | None = None
    job_id: str | None = None
    skip_reason: str | None = None
    reuse_existing: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "entry_url": self.entry_url,
            "slug": self.slug,
            "name": self.name,
            "status": self.status,
            "phase": self.phase,
            "message": self.message,
            "error": self.error,
            "feed_id": self.feed_id,
            "job_id": self.job_id,
            "skip_reason": self.skip_reason,
            "reuse_existing": self.reuse_existing,
        }


def _assign_feed_group(feed_id: str | None, group_id: str | None) -> None:
    if not feed_id:
        return
    gid = (group_id or "").strip()
    try:
        # 未分组：从所有自定义分组中移除；有分组：移动到目标组
        feed_registry.assign_feed_to_group(
            feed_id,
            None if (not gid or gid == UNGROUPED_GROUP_ID) else gid,
        )
    except ValueError:
        pass


def _attach_existing_feed(
    *,
    feed_id: str,
    group_id: str | None,
) -> str:
    """将已有 skill 对应的数据源加入目标分组（隐藏源先恢复）。"""
    restored = False
    if feed_registry.is_hidden(feed_id):
        feed_registry.unhide_feed(feed_id)
        restored = True
    _assign_feed_group(feed_id, group_id)
    gid = (group_id or "").strip()
    if restored and gid and gid != UNGROUPED_GROUP_ID:
        return "已恢复并从所选分组接入"
    if restored:
        return "已恢复数据源（skill 已存在）"
    if gid and gid != UNGROUPED_GROUP_ID:
        return "数据源已存在，已加入所选分组"
    return "数据源已存在，无需重复接入"


async def _refresh_onboarded_feed(feed_client, feed_id: str) -> dict[str, Any]:
    feed_client.ensure_feed_visible(feed_id)
    return await feed_client.refresh_feed(feed_id)


@dataclass
class OnboardingBatch:
    batch_id: str
    items: list[BatchItem] = field(default_factory=list)
    status: BatchStatus = "running"
    cancelled: bool = False
    auto_validate: bool = True
    reload: bool = True
    max_concurrency: int = DEFAULT_MAX_CONCURRENCY
    group_id: str | None = None
    auto_repair: bool = True
    _task: asyncio.Task | None = field(default=None, repr=False)

    @property
    def total(self) -> int:
        return len(self.items)

    def count_by_status(self, status: ItemStatus) -> int:
        return sum(1 for item in self.items if item.status == status)

    @property
    def completed(self) -> int:
        return self.count_by_status("done")

    @property
    def failed(self) -> int:
        return self.count_by_status("failed")

    @property
    def skipped(self) -> int:
        return self.count_by_status("skipped")

    @property
    def running(self) -> int:
        return self.count_by_status("running")

    @property
    def queued(self) -> int:
        return self.count_by_status("queued")

    @property
    def finished(self) -> int:
        return sum(
            1
            for item in self.items
            if item.status in {"done", "failed", "cancelled", "skipped"}
        )

    def summary_message(self) -> str:
        if self.status == "running":
            return f"批量接入中 {self.completed}/{self.total} 完成"
        parts: list[str] = []
        if self.completed:
            parts.append(f"已接入 {self.completed} 个")
        if self.skipped:
            parts.append(f"跳过 {self.skipped} 个")
        if self.failed:
            parts.append(f"失败 {self.failed} 个")
        if self.count_by_status("cancelled"):
            parts.append(f"取消 {self.count_by_status('cancelled')} 个")
        return "，".join(parts) if parts else "批量接入已完成"

    def to_dict(self) -> dict[str, Any]:
        return {
            "batch_id": self.batch_id,
            "status": self.status,
            "total": self.total,
            "completed": self.completed,
            "failed": self.failed,
            "skipped": self.skipped,
            "running": self.running,
            "queued": self.queued,
            "message": self.summary_message(),
            "items": [item.to_dict() for item in self.items],
        }


_batches: dict[str, OnboardingBatch] = {}
_batch_lock = Lock()
_reload_task: asyncio.Task | None = None
_reload_lock = asyncio.Lock()


def _new_batch_id() -> str:
    return uuid.uuid4().hex[:12]


def _prepare_item(entry_url: str, seen_slugs: set[str]) -> BatchItem:
    item = BatchItem(entry_url=entry_url)
    try:
        slug, name, normalized = resolve_onboard_target(entry_url)
    except ValueError as exc:
        item.status = "skipped"
        item.skip_reason = str(exc)
        item.message = str(exc)
        return item

    feed_id = resolve_feed_id_for_target(normalized, slug)

    if skill_dir_for(slug).exists():
        if not is_complete_discovery_skill(slug):
            remove_discovery_skill_dir(slug)
            try:
                feed_registry.purge_feed(feed_id)
            except Exception:
                pass
        else:
            # skill 已完整：加入所选分组，而不是判定为失败/跳过
            if slug in seen_slugs:
                item.slug = slug
                item.name = name
                item.status = "skipped"
                item.skip_reason = f"本批次 slug 冲突: {slug}"
                item.message = item.skip_reason
                return item
            seen_slugs.add(slug)
            item.slug = slug
            item.name = name
            item.entry_url = normalized
            item.feed_id = feed_id
            item.reuse_existing = True
            return item

    if slug in seen_slugs:
        item.slug = slug
        item.name = name
        item.status = "skipped"
        item.skip_reason = f"本批次 slug 冲突: {slug}"
        item.message = item.skip_reason
        return item

    seen_slugs.add(slug)
    item.slug = slug
    item.name = name
    item.entry_url = normalized
    item.feed_id = feed_id
    return item


def _needs_cursor_agent(entry_url: str) -> bool:
    return detect_platform(entry_url.strip()) is None


async def _schedule_reload(feed_client) -> None:
    global _reload_task
    async with _reload_lock:
        if _reload_task and not _reload_task.done():
            return

        async def _debounced() -> None:
            await asyncio.sleep(RELOAD_DEBOUNCE_SECONDS)
            feed_client.reload_skills()

        _reload_task = asyncio.create_task(_debounced())


async def _run_item(
    batch: OnboardingBatch,
    item: BatchItem,
    *,
    sem: asyncio.Semaphore,
    feed_client,
) -> None:
    if batch.cancelled:
        if item.status == "queued":
            item.status = "cancelled"
            item.message = "已取消"
        return

    async with sem:
        if batch.cancelled or item.status != "queued":
            if item.status == "queued":
                item.status = "cancelled"
                item.message = "已取消"
            return

        item.status = "running"
        item.phase = "start"
        item.message = "接入启动中…"

        if item.reuse_existing:
            feed_id = item.feed_id or resolve_feed_id_for_target(item.entry_url, item.slug)
            item.feed_id = feed_id
            item.phase = "attach"
            item.message = "数据源已存在，正在加入分组…"
            try:
                item.message = _attach_existing_feed(feed_id=feed_id, group_id=batch.group_id)
                item.status = "done"
                item.phase = "attached"
                if batch.reload:
                    await _schedule_reload(feed_client)
            except Exception as exc:
                item.status = "failed"
                item.phase = "attach_failed"
                item.error = str(exc) or "加入分组失败"
                item.message = item.error
            return

        session = create_session(
            entry_url=item.entry_url,
            slug=item.slug,
            name=item.name,
        )
        item.job_id = session.job_id

        try:
            async for event in run_onboarding_agent(
                slug=item.slug,
                name=item.name,
                entry_url=item.entry_url,
                auto_validate=batch.auto_validate,
                session=session,
                auto_repair=batch.auto_repair,
            ):
                if batch.cancelled or session.cancelled:
                    break
                kind = event.get("event", "status")
                if kind == "result":
                    data = event.get("data") or {}
                    item.feed_id = str(data.get("feed_id") or f"website:{item.slug}")
                    _assign_feed_group(item.feed_id, batch.group_id)
                    try:
                        refresh_result: dict[str, Any] | None = None
                        async for refresh_event in refresh_with_auto_repair(
                            slug=item.slug,
                            do_refresh=lambda fid=item.feed_id: _refresh_onboarded_feed(
                                feed_client, fid
                            ),
                            reload_skills=feed_client.reload_skills,
                            session=session,
                            auto_validate=batch.auto_validate,
                            auto_repair=batch.auto_repair,
                        ):
                            if batch.cancelled or session.cancelled:
                                break
                            rev_kind = refresh_event.get("event", "status")
                            if rev_kind == "refresh_done":
                                refresh_result = refresh_event.get("data") or {}
                            elif rev_kind == "status":
                                item.phase = str(refresh_event.get("phase") or item.phase)
                                item.message = str(
                                    refresh_event.get("message") or item.message
                                )
                        if batch.cancelled or session.cancelled:
                            break
                        if refresh_result is None:
                            raise FeedError("首拉未返回结果", status_code=502)
                        item.status = "done"
                        item.phase = "done"
                        repaired = bool(refresh_result.get("auto_repaired"))
                        base_msg = str(
                            refresh_result.get("message")
                            or f"已接入并更新 {item.feed_id}"
                        )
                        item.message = (
                            f"自动修复后{base_msg}" if repaired else base_msg
                        )
                        session.finish(
                            success=True,
                            detail={**data, "refresh": refresh_result},
                        )
                        if batch.reload:
                            await _schedule_reload(feed_client)
                    except FeedError as exc:
                        item.status = "failed"
                        item.phase = "refresh_failed"
                        item.error = str(exc)
                        item.message = f"skill 已写入，但拉取失败: {exc}"
                        session.finish(
                            success=False,
                            detail={**data, "refresh_error": str(exc)},
                        )
                        if batch.reload:
                            await _schedule_reload(feed_client)
                        break
                    break
                elif kind == "status":
                    item.phase = str(event.get("phase") or item.phase)
                    item.message = str(event.get("message") or item.message)

            if item.status == "running":
                if session.cancelled or batch.cancelled:
                    raise OnboardingCancelled("接入已取消")
                item.status = "failed"
                item.error = "Agent 未返回结果"
                item.message = item.error
                session.finish(success=False, detail={"error": item.error})
        except OnboardingCancelled:
            item.status = "cancelled"
            item.phase = "cancelled"
            item.message = "已取消"
            session.cleanup_partial_skill()
            session.finish(success=False, detail={"cancelled": True})
        except LLMError as exc:
            item.status = "failed"
            item.error = str(exc)
            item.message = str(exc)
            session.log("error", detail=str(exc))
            session.cleanup_partial_skill()
            session.finish(success=False, detail={"error": str(exc)})
        except Exception as exc:
            item.status = "failed"
            item.error = str(exc) or "接入失败"
            item.message = item.error
            session.log("error", detail=item.error)
            session.cleanup_partial_skill()
            session.finish(success=False, detail={"error": item.error})
        finally:
            unregister_session(session.job_id)


async def _run_batch(batch: OnboardingBatch, feed_client) -> None:
    queued = [item for item in batch.items if item.status == "queued"]
    sem = asyncio.Semaphore(batch.max_concurrency)
    try:
        await asyncio.gather(
            *[
                _run_item(batch, item, sem=sem, feed_client=feed_client)
                for item in queued
            ]
        )
    finally:
        if batch.reload and batch.completed > 0:
            await _schedule_reload(feed_client)
            if _reload_task:
                try:
                    await _reload_task
                except Exception:
                    pass
        batch.status = "cancelled" if batch.cancelled else "done"


def get_batch(batch_id: str) -> OnboardingBatch | None:
    with _batch_lock:
        return _batches.get(batch_id)


async def start_batch(
    *,
    entry_urls: list[str],
    feed_client,
    max_concurrency: int | None = None,
    auto_validate: bool = True,
    reload: bool = True,
    group_id: str | None = None,
    auto_repair: bool = True,
) -> OnboardingBatch:
    urls = parse_entry_urls(entry_urls)
    if not urls:
        raise ValueError("请至少提供一个有效链接")

    seen_slugs: set[str] = set()
    items = [_prepare_item(url, seen_slugs) for url in urls]
    queued = [item for item in items if item.status == "queued"]

    if queued and not load_cursor_api_key():
        needs_cursor = any(_needs_cursor_agent(item.entry_url) for item in queued)
        if needs_cursor:
            raise LLMError(
                "请先在设置页配置 Cursor API Key（Dashboard → Integrations）",
                status_code=400,
            )

    batch = OnboardingBatch(
        batch_id=_new_batch_id(),
        items=items,
        auto_validate=auto_validate,
        reload=reload,
        max_concurrency=min(10, max(1, max_concurrency or DEFAULT_MAX_CONCURRENCY)),
        group_id=(group_id or "").strip() or None,
        auto_repair=auto_repair,
    )

    with _batch_lock:
        _batches[batch.batch_id] = batch

    if not queued:
        batch.status = "done"
        return batch

    batch._task = asyncio.create_task(_run_batch(batch, feed_client))
    return batch


async def cancel_batch(batch_id: str) -> bool:
    batch = get_batch(batch_id)
    if batch is None or batch.status != "running":
        return False

    batch.cancelled = True
    for item in batch.items:
        if item.status == "queued":
            item.status = "cancelled"
            item.message = "已取消"
        elif item.status == "running" and item.job_id:
            await cancel_cursor_run(item.job_id)
            from source_onboarding_log import cancel_job

            cancel_job(item.job_id)
    return True
