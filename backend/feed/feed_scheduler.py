from paths import DATA_DIR

import asyncio
import json
import logging
import os
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from zoneinfo import ZoneInfo

from core.time_scope import format_duration_zh


@dataclass
class _RefreshWorkItem:
    feed_id: str
    feed_name: str
    days: int

CONFIG_PATH = DATA_DIR / "feed_scheduler.json"
LAST_REFRESH_PATH = DATA_DIR / "feed_refresh_last.json"
SHANGHAI = ZoneInfo("Asia/Shanghai")
JOB_ID_PREFIX = "feed_refresh_"
RETENTION_JOB_ID = "data_retention_daily"
DEFAULT_REFRESH_CONCURRENCY = max(1, int(os.getenv("FEED_REFRESH_CONCURRENCY", "8")))
# 单个数据源刷新：软超时仅释放并发槽，任务继续跑完并计入真实结果（避免慢源被误标「跳过」）
# 产品约束：单源长时间卡住不可接受，默认硬上限约 1 分钟。
DEFAULT_FEED_REFRESH_SOFT_TIMEOUT = max(
    10.0, float(os.getenv("FEED_REFRESH_TIMEOUT", "25"))
)
# 硬超时：仍未完成则取消该源并记失败
DEFAULT_FEED_REFRESH_HARD_TIMEOUT = max(
    DEFAULT_FEED_REFRESH_SOFT_TIMEOUT,
    float(os.getenv("FEED_REFRESH_HARD_TIMEOUT", "60")),
)
# 兼容旧名
DEFAULT_FEED_REFRESH_TIMEOUT = DEFAULT_FEED_REFRESH_HARD_TIMEOUT
DEFAULT_CONFIG: dict[str, Any] = {
    "schedules": [],
}

logger = logging.getLogger(__name__)


def humanize_refresh_error(raw: str) -> str:
    """将刷新异常转成用户可读原因（常见为网络不可达/反爬）。"""
    text = (raw or "").strip()
    if not text:
        return "未知错误"
    # 保留授权门禁原文，便于前端解析 slot=…
    if "ASKME_AUTH_REQUIRED" in text.upper():
        if len(text) > 180:
            return text[:177] + "…"
        return text
    lower = text.lower()
    network_markers = (
        "timed out",
        "timeout",
        "temporarily unavailable",
        "name or service not known",
        "nodename nor servname",
        "getaddrinfo failed",
        "network is unreachable",
        "no route to host",
        "connection refused",
        "connection reset",
        "connection aborted",
        "broken pipe",
        "ssl",
        "certificate",
        "proxyerror",
        "max retries exceeded",
        "failed to establish a new connection",
        "remote end closed connection",
        "urlopen error",
        "errno 61",
        "errno 51",
        "errno 65",
        "errno 8",
        "errno -2",
        "errno -3",
    )
    if any(marker in lower for marker in network_markers):
        return f"网络无法访问或请求超时（{text}）"
    anti_bot_markers = (
        "cloudflare",
        "captcha",
        "challenge",
        "datadome",
        "403",
        "401",
        "429",
        "access denied",
        "blocked",
    )
    if any(marker in lower for marker in anti_bot_markers):
        return f"站点拦截或访问受限（{text}）"
    if len(text) > 180:
        return text[:177] + "…"
    return text


def _normalize_group_ids(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for item in raw:
        gid = str(item or "").strip().lower()
        if not gid or gid in seen:
            continue
        seen.add(gid)
        result.append(gid)
    return result


def _normalize_schedule(entry: dict[str, Any]) -> dict[str, Any] | None:
    kind = str(entry.get("kind") or "daily").strip().lower()
    if kind not in ("daily", "interval"):
        kind = "daily"
    group_ids = _normalize_group_ids(entry.get("group_ids"))
    try:
        every_hours = int(entry.get("every_hours", 6))
    except (TypeError, ValueError):
        every_hours = 6
    every_hours = max(1, min(24, every_hours))

    if kind == "interval":
        return {
            "kind": "interval",
            "hour": 0,
            "minute": 0,
            "second": 0,
            "every_hours": every_hours,
            "group_ids": group_ids,
        }

    try:
        hour = int(entry.get("hour", 0))
        minute = int(entry.get("minute", 0))
        second = int(entry.get("second", 0))
    except (TypeError, ValueError):
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
        return None
    return {
        "kind": "daily",
        "hour": hour,
        "minute": minute,
        "second": second,
        "every_hours": every_hours,
        "group_ids": group_ids,
    }


def _schedule_time_key(item: dict[str, Any]) -> tuple[Any, ...]:
    kind = item.get("kind", "daily")
    if kind == "interval":
        return ("interval", int(item.get("every_hours", 6)))
    return (
        "daily",
        int(item.get("hour", 0)),
        int(item.get("minute", 0)),
        int(item.get("second", 0)),
    )


def validate_schedules(schedules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged_by_key: dict[tuple[Any, ...], dict[str, Any]] = {}
    order: list[tuple[Any, ...]] = []
    for entry in schedules:
        if not isinstance(entry, dict):
            continue
        item = _normalize_schedule(entry)
        if item is None:
            continue
        key = _schedule_time_key(item)
        existing = merged_by_key.get(key)
        if existing is None:
            merged_by_key[key] = item
            order.append(key)
            continue
        existing["group_ids"] = _normalize_group_ids(
            list(existing.get("group_ids") or []) + list(item.get("group_ids") or [])
        )
    normalized = [merged_by_key[key] for key in order]
    normalized.sort(
        key=lambda item: (
            0 if item.get("kind") == "daily" else 1,
            int(item.get("hour", 0)),
            int(item.get("minute", 0)),
            int(item.get("second", 0)),
            int(item.get("every_hours", 6)),
            ",".join(item.get("group_ids") or []),
        )
    )
    return normalized


def _migrate_legacy_config(data: dict[str, Any]) -> list[dict[str, Any]]:
    if not data.get("enabled"):
        return []
    expr = str(data.get("cron_expression", "")).strip()
    parts = expr.split()
    if len(parts) != 5:
        return []
    try:
        minute = int(parts[0])
        hour_field = parts[1]
        if hour_field.isdigit():
            return validate_schedules([{"hour": int(hour_field), "minute": minute, "second": 0}])
        if "," in hour_field:
            return validate_schedules(
                [{"hour": int(h), "minute": minute, "second": 0} for h in hour_field.split(",") if h.isdigit()]
            )
    except ValueError:
        return []
    return []


class FeedSchedulerManager:
    def __init__(self) -> None:
        self._scheduler = AsyncIOScheduler(timezone=SHANGHAI)
        self._client = None
        self._refresh_task: asyncio.Task | None = None
        self._refresh_cancel = asyncio.Event()
        self._active_feed_tasks: set[asyncio.Task] = set()
        self._pending: deque[_RefreshWorkItem] = deque()
        self._queued_ids: set[str] = set()
        self._inflight_ids: set[str] = set()
        self._wake = asyncio.Event()
        self._task_feed_ids: dict[asyncio.Task, str] = {}
        self._round_failed: list[dict[str, str]] = []
        self._round_no_new: list[dict[str, str]] = []
        self._round_success_ids: list[str] = []
        self._round_completed = 0
        self._round_total = 0
        self._round_started_mono: float | None = None
        self._round_scopes: set[str] = set()
        self._round_group_id = ""
        self._round_group_name = ""
        self._refresh_progress: dict[str, Any] = {
            "current": 0,
            "total": 0,
            "feed_id": "",
            "feed_name": "",
            "last_completed_feed_id": "",
            "completed_feed_ids": [],
            "queued": 0,
            "scope": "all",
            "group_id": "",
            "group_name": "",
        }
        self._last_refresh_result: dict[str, Any] | None = None
        self._last_run_at: float | None = None
        self._last_error: str | None = None
        self._last_feed_count = 0
        self._load_last_refresh()

    def _load_last_refresh(self) -> None:
        if not LAST_REFRESH_PATH.exists():
            return
        try:
            data = json.loads(LAST_REFRESH_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return
        if not isinstance(data, dict):
            return
        try:
            run_at = data.get("last_run_at")
            self._last_run_at = float(run_at) if run_at is not None else None
        except (TypeError, ValueError):
            self._last_run_at = None
        self._last_error = str(data["last_error"]) if data.get("last_error") else None
        try:
            self._last_feed_count = int(data.get("last_feed_count") or 0)
        except (TypeError, ValueError):
            self._last_feed_count = 0
        failed = data.get("failed")
        if not isinstance(failed, list):
            failed = []
        self._last_refresh_result = {
            "ok": bool(data.get("ok", self._last_feed_count > 0)),
            "feed_count": self._last_feed_count,
            "failed": [item for item in failed if isinstance(item, dict)],
            "message": str(data.get("message") or "") or None,
            "scope": str(data.get("scope") or "all"),
        }

    def _persist_last_refresh(self, result: dict[str, Any] | None) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        payload = {
            "last_run_at": self._last_run_at,
            "last_error": self._last_error,
            "last_feed_count": self._last_feed_count,
            "ok": bool((result or {}).get("ok", self._last_feed_count > 0)),
            "message": (result or {}).get("message"),
            "failed": (result or {}).get("failed") or [],
            "scope": (result or {}).get("scope") or "all",
        }
        try:
            LAST_REFRESH_PATH.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        except OSError as exc:
            logger.warning("无法持久化刷新结果: %s", exc)
    def load_config(self) -> dict[str, Any]:
        if not CONFIG_PATH.exists():
            return dict(DEFAULT_CONFIG)
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(data.get("schedules"), list):
                schedules = validate_schedules(data["schedules"])
            else:
                schedules = _migrate_legacy_config(data)
            return {"schedules": schedules}
        except (json.JSONDecodeError, OSError):
            return dict(DEFAULT_CONFIG)

    def save_config(
        self,
        *,
        schedules: list[dict[str, Any]],
    ) -> dict[str, Any]:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        payload = {"schedules": validate_schedules(schedules)}
        CONFIG_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload

    def start(self, client) -> None:
        self._client = client
        if not self._scheduler.running:
            self._scheduler.start()
        self.apply_config()
        self._ensure_retention_job()

    def shutdown(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)

    def _ensure_retention_job(self) -> None:
        """每日清理超过保留窗口的文章 / 正文 / 索引（默认近 3 天）。"""
        if not self._scheduler.running:
            return
        from feed.data_retention import (
            RETENTION_JOB_ID,
            retention_cron_hour,
            retention_cron_minute,
            run_data_retention,
        )

        self._scheduler.add_job(
            run_data_retention,
            CronTrigger(
                hour=retention_cron_hour(),
                minute=retention_cron_minute(),
                second=0,
                timezone=SHANGHAI,
            ),
            id=RETENTION_JOB_ID,
            replace_existing=True,
            coalesce=True,
            max_instances=1,
        )
        logger.info(
            "已注册数据保留任务 %s @ %02d:%02d Asia/Shanghai",
            RETENTION_JOB_ID,
            retention_cron_hour(),
            retention_cron_minute(),
        )

    def _remove_refresh_jobs(self) -> None:
        if not self._scheduler.running:
            return
        for job in self._scheduler.get_jobs():
            if job.id.startswith(JOB_ID_PREFIX):
                self._scheduler.remove_job(job.id)

    def apply_config(self) -> None:
        self._remove_refresh_jobs()
        schedules = self.load_config().get("schedules", [])
        if not schedules:
            return

        for index, sched in enumerate(schedules):
            kind = str(sched.get("kind") or "daily")
            group_ids = list(sched.get("group_ids") or [])
            if kind == "interval":
                every = max(1, min(24, int(sched.get("every_hours") or 6)))
                hours = list(range(0, 24, every)) or [0]
                trigger = CronTrigger(
                    hour=",".join(str(h) for h in hours),
                    minute=0,
                    second=0,
                    timezone=SHANGHAI,
                )
            else:
                trigger = CronTrigger(
                    second=int(sched.get("second", 0)),
                    minute=int(sched.get("minute", 0)),
                    hour=int(sched.get("hour", 0)),
                    timezone=SHANGHAI,
                )
            self._scheduler.add_job(
                self._run_scheduled_refresh,
                trigger,
                id=f"{JOB_ID_PREFIX}{index}",
                replace_existing=True,
                kwargs={"group_ids": group_ids},
            )

    def _auto_refresh_feed_ids(self) -> list[str]:
        """兼容旧配置：未指定 group_ids 时，刷开启 auto_refresh 的分组。"""
        from feed.feed_registry import feed_registry

        feed_ids: list[str] = []
        seen: set[str] = set()
        for group in feed_registry.list_groups():
            if not bool(group.get("auto_refresh", True)):
                continue
            for fid in group.get("feed_ids") or []:
                fid_s = str(fid).strip()
                if not fid_s or fid_s in seen:
                    continue
                seen.add(fid_s)
                feed_ids.append(fid_s)
        return feed_ids

    async def _resolve_schedule_feed_ids(self, group_ids: list[str] | None) -> list[str]:
        ids = [str(gid).strip() for gid in (group_ids or []) if str(gid).strip()]
        if not ids:
            return self._auto_refresh_feed_ids()
        from digest.digest_service import resolve_feed_ids_for_groups

        return await resolve_feed_ids_for_groups(self._client, ids)

    async def _pull_bodies_for_feeds(
        self,
        feed_ids: list[str],
        *,
        days: int = 1,
        list_limit: int = 0,
    ) -> dict[str, Any]:
        """定时刷新列表后拉取正文（与源页手动更新对齐）。"""
        from api.deps import article_service
        from feed.content_job_manager import content_job_manager

        ids = [str(fid).strip() for fid in feed_ids if str(fid).strip()]
        if not ids:
            return {"started": False, "message": "无数据源，跳过正文"}

        if content_job_manager.is_bodies_running():
            logger.info("定时更新：已有正文任务进行中，等待其结束后再继续")
            await content_job_manager.wait_for_bodies()

        params = {
            "days": days,
            "feed_ids": ids,
            "message": "定时更新：正在拉取正文…",
            "group_id": "",
            "list_limit": list_limit,
        }

        async def runner(on_progress, is_cancelled=None):
            return await article_service.get_recent_articles(
                days=days,
                feed_ids=ids,
                enrich=True,
                list_limit=list_limit,
                on_progress=on_progress,
                is_cancelled=is_cancelled,
            )

        started = await content_job_manager.start_bodies(runner=runner, params=params)
        if not started.get("started"):
            logger.info(
                "定时更新：未能启动正文任务（%s）",
                started.get("message") or started.get("status") or "busy",
            )
            return started

        status = await content_job_manager.wait_for_bodies()
        logger.info(
            "定时更新正文结束：status=%s article_count=%s",
            status.get("status"),
            (status.get("result") or {}).get("article_count")
            if isinstance(status.get("result"), dict)
            else None,
        )
        return status

    async def _run_scheduled_refresh(self, group_ids: list[str] | None = None) -> None:
        try:
            feed_ids = await self._resolve_schedule_feed_ids(group_ids)
            if not feed_ids:
                result = {
                    "ok": True,
                    "feed_count": 0,
                    "failed": [],
                    "message": "定时未匹配到可更新的数据源，已跳过",
                    "cancelled": False,
                }
                self._last_refresh_result = result
                self._persist_last_refresh(result)
                logger.info("定时刷新跳过：无可用数据源")
                return
            result = await self.run_refresh_feeds(
                self._client,
                feed_ids=feed_ids,
                scope="all",
                days=1,
            )
            self._last_refresh_result = result
            self._persist_last_refresh(result)
            failed = (result or {}).get("failed") or []
            if failed:
                logger.warning(
                    "定时刷新部分失败：成功 %s，失败 %s",
                    (result or {}).get("feed_count"),
                    len(failed),
                )
                for item in failed[:20]:
                    logger.warning(
                        "  · %s: %s",
                        item.get("feed_name") or item.get("feed_id"),
                        item.get("error"),
                    )

            if result and not result.get("cancelled"):
                try:
                    bodies_status = await self._pull_bodies_for_feeds(feed_ids, days=1)
                    status = str(bodies_status.get("status") or "")
                    if status == "error":
                        err = (
                            bodies_status.get("error")
                            or bodies_status.get("message")
                            or "拉取正文失败"
                        )
                        logger.warning("定时更新正文失败：%s", err)
                        if isinstance(result, dict):
                            result = {
                                **result,
                                "message": f"{result.get('message') or '列表已更新'}；正文拉取失败：{err}",
                            }
                            self._last_refresh_result = result
                            self._persist_last_refresh(result)
                    elif status == "done" and isinstance(result, dict):
                        body_result = bodies_status.get("result") or {}
                        with_body = (
                            body_result.get("article_count")
                            if isinstance(body_result, dict)
                            else None
                        )
                        suffix = (
                            f"；正文已拉取 {with_body} 篇"
                            if with_body is not None
                            else "；正文已拉取"
                        )
                        result = {
                            **result,
                            "message": f"{result.get('message') or '列表已更新'}{suffix}",
                        }
                        self._last_refresh_result = result
                        self._persist_last_refresh(result)
                except Exception as bodies_exc:
                    logger.exception("定时更新正文异常: %s", bodies_exc)
                    if isinstance(result, dict):
                        result = {
                            **result,
                            "message": (
                                f"{result.get('message') or '列表已更新'}；"
                                f"正文拉取异常：{bodies_exc}"
                            ),
                        }
                        self._last_refresh_result = result
                        self._persist_last_refresh(result)
        except Exception as exc:
            self._last_error = str(exc) or "定时刷新失败"
            self._last_refresh_result = {
                "ok": False,
                "feed_count": self._last_feed_count,
                "failed": [],
                "message": self._last_error,
            }
            self._persist_last_refresh(self._last_refresh_result)
            logger.error("定时刷新任务失败: %s", exc)

    def is_refresh_running(self) -> bool:
        return self._refresh_task is not None and not self._refresh_task.done()

    def request_refresh_cancel(self) -> bool:
        """请求停止当前批量更新；清空排队，已完成的源结果保留。"""
        if not self.is_refresh_running():
            return False
        self._refresh_cancel.set()
        self._pending.clear()
        self._queued_ids.clear()
        self._wake.set()
        for task in list(self._active_feed_tasks):
            if not task.done():
                task.cancel()
        if self._refresh_task is not None and not self._refresh_task.done():
            self._refresh_task.cancel()
        return True

    async def start_refresh_all(self, client=None, *, days: int = 1) -> dict[str, Any]:
        return await self._enqueue_refresh_job(
            client,
            feed_ids=None,
            scope="all",
            group_id="",
            group_name="",
            days=days,
            start_message="已开始更新全部数据源，后台执行中",
        )

    async def start_refresh_feeds(
        self,
        client=None,
        *,
        feed_ids: list[str],
        days: int = 1,
    ) -> dict[str, Any]:
        ids = [str(fid).strip() for fid in feed_ids if str(fid).strip()]
        if not ids:
            raise ValueError("请指定数据源")
        return await self._enqueue_refresh_job(
            client,
            feed_ids=ids,
            scope="all",
            group_id="",
            group_name="",
            days=days,
            start_message=f"已开始更新所选 {len(ids)} 个数据源，后台执行中",
        )

    async def start_refresh_group(
        self,
        client,
        *,
        group_id: str,
        group_name: str,
        feed_ids: list[str],
        days: int = 1,
    ) -> dict[str, Any]:
        if not feed_ids:
            raise ValueError("该分组暂无数据源")
        label = group_name or group_id
        return await self._enqueue_refresh_job(
            client,
            feed_ids=feed_ids,
            scope="group",
            group_id=group_id,
            group_name=label,
            days=days,
            start_message=f"已开始更新分组「{label}」，后台执行中",
        )

    async def start_refresh_feed(
        self,
        client,
        *,
        feed_id: str,
        feed_name: str = "",
        days: int = 1,
    ) -> dict[str, Any]:
        fid = (feed_id or "").strip()
        if not fid:
            raise ValueError("请指定数据源")
        label = (feed_name or "").strip() or fid
        return await self._enqueue_refresh_job(
            client,
            feed_ids=[fid],
            scope="feed",
            group_id="",
            group_name="",
            days=days,
            start_message=f"已开始更新「{label}」，后台执行中",
            feed_name_hint=label,
        )

    def _display_scope(self) -> tuple[str, str, str]:
        scopes = self._round_scopes
        if len(scopes) == 1:
            scope = next(iter(scopes))
            if scope == "group":
                return scope, self._round_group_id, self._round_group_name
            return scope, "", ""
        if scopes:
            return "all", "", ""
        return "all", "", ""

    def _sync_progress(self, feed_id: str = "", feed_name: str = "") -> None:
        scope, group_id, group_name = self._display_scope()
        self._refresh_progress = {
            "current": self._round_completed,
            "total": self._round_total,
            "feed_id": feed_id,
            "feed_name": feed_name,
            "last_completed_feed_id": feed_id
            or self._refresh_progress.get("last_completed_feed_id", ""),
            "completed_feed_ids": list(self._round_success_ids),
            "queued": len(self._pending),
            "scope": scope,
            "group_id": group_id,
            "group_name": group_name,
        }

    def _round_done_ids(self) -> set[str]:
        return set(self._round_success_ids) | {
            str(item.get("feed_id") or "") for item in self._round_failed
        }

    def _begin_round(self, *, scope: str, group_id: str, group_name: str) -> None:
        self._pending.clear()
        self._queued_ids.clear()
        self._inflight_ids.clear()
        self._active_feed_tasks.clear()
        self._task_feed_ids.clear()
        self._round_failed = []
        self._round_no_new = []
        self._round_success_ids = []
        self._round_completed = 0
        self._round_total = 0
        self._last_feed_count = 0
        self._last_error = None
        self._last_refresh_result = None
        self._last_run_at = time.time()
        self._round_started_mono = time.monotonic()
        self._round_scopes = {scope}
        self._round_group_id = group_id
        self._round_group_name = group_name
        self._refresh_cancel.clear()
        self._wake.clear()
        self._sync_progress()

    def _try_enqueue_feed(self, feed: dict[str, Any], days: int) -> bool:
        feed_id = str(feed.get("id") or "").strip()
        if not feed_id:
            return False
        if feed_id in self._queued_ids or feed_id in self._inflight_ids:
            return False
        if feed_id in self._round_done_ids():
            return False
        self._pending.append(
            _RefreshWorkItem(
                feed_id=feed_id,
                feed_name=str(feed.get("mpName") or ""),
                days=max(1, int(days)),
            )
        )
        self._queued_ids.add(feed_id)
        self._round_total += 1
        return True

    async def _enqueue_refresh_job(
        self,
        client,
        *,
        feed_ids: list[str] | None,
        scope: str,
        group_id: str,
        group_name: str,
        start_message: str,
        days: int = 1,
        feed_name_hint: str = "",
    ) -> dict[str, Any]:
        feed_client = client or self._client
        if feed_client is None:
            raise RuntimeError("数据源客户端未就绪")

        feeds = await feed_client.list_feeds()
        enabled_feeds = [
            feed for feed in feeds if feed.get("status", 1) == 1 and feed.get("id")
        ]
        if feed_ids is not None:
            allowed = set(feed_ids)
            enabled_feeds = [feed for feed in enabled_feeds if feed.get("id") in allowed]
            if feed_name_hint and len(enabled_feeds) == 1 and not enabled_feeds[0].get("mpName"):
                enabled_feeds[0] = {**enabled_feeds[0], "mpName": feed_name_hint}

        if feed_ids is not None and not enabled_feeds:
            if scope == "group":
                raise ValueError("该分组暂无数据源")
            if scope == "feed":
                raise ValueError("数据源不存在或已禁用")

        was_running = self.is_refresh_running()
        if not was_running:
            self._begin_round(scope=scope, group_id=group_id, group_name=group_name)
        else:
            self._round_scopes.add(scope)
            if scope == "group" and group_id:
                self._round_group_id = group_id
                self._round_group_name = group_name

        added = 0
        for feed in enabled_feeds:
            if self._try_enqueue_feed(feed, days):
                added += 1

        self._sync_progress()

        if not was_running:
            self._refresh_task = asyncio.create_task(self._dispatch_refresh(feed_client))
        else:
            self._wake.set()

        if added == 0 and was_running:
            message = "这些数据源已在更新队列中"
        elif was_running:
            message = f"已追加 {added} 个数据源到更新队列"
        elif not enabled_feeds:
            message = "暂无数据源"
        else:
            message = start_message

        payload: dict[str, Any] = {
            "started": True,
            "merged": was_running,
            "added": added,
            "message": message,
            "scope": scope,
            "days": max(1, int(days)),
            "queued": len(self._pending),
            "total": self._round_total,
        }
        if scope == "group":
            payload["group_id"] = group_id
            payload["group_name"] = group_name
            payload["feed_count"] = len(feed_ids or [])
        if scope == "feed" and feed_ids:
            payload["feed_id"] = feed_ids[0]
        return payload

    async def _dispatch_refresh(self, feed_client) -> None:
        gen_sem = asyncio.Semaphore(DEFAULT_REFRESH_CONCURRENCY)
        soft_timeout = DEFAULT_FEED_REFRESH_SOFT_TIMEOUT
        hard_timeout = DEFAULT_FEED_REFRESH_HARD_TIMEOUT
        cancelled = False

        async def refresh_one(
            item: _RefreshWorkItem,
        ) -> tuple[str, str, bool, dict[str, Any] | None, str | None]:
            feed_id = item.feed_id
            feed_name = item.feed_name
            if self._refresh_cancel.is_set():
                return feed_id, feed_name, False, None, "cancelled"
            slot = gen_sem
            soft = soft_timeout
            hard = hard_timeout
            await slot.acquire()
            if self._refresh_cancel.is_set():
                slot.release()
                return feed_id, feed_name, False, None, "cancelled"
            task = asyncio.create_task(
                feed_client.refresh_feed(feed_id, days=item.days)
            )
            self._active_feed_tasks.add(task)
            self._task_feed_ids[task] = feed_id
            slot_held = True
            try:
                done, _pending = await asyncio.wait({task}, timeout=soft)
                if task not in done:
                    slot.release()
                    slot_held = False
                    remaining = max(0.1, hard - soft)
                    done, _pending = await asyncio.wait({task}, timeout=remaining)
                if task not in done:
                    task.cancel()
                    try:
                        await task
                    except (asyncio.CancelledError, Exception):
                        pass
                    return (
                        feed_id,
                        feed_name,
                        False,
                        None,
                        f"刷新超时（>{int(hard)}s）",
                    )
                try:
                    feed_result = task.result()
                    return feed_id, feed_name, True, feed_result, None
                except asyncio.CancelledError:
                    return feed_id, feed_name, False, None, "cancelled"
                except Exception as exc:
                    return feed_id, feed_name, False, None, str(exc) or "刷新失败"
            except asyncio.CancelledError:
                if not task.done():
                    task.cancel()
                    try:
                        await task
                    except (asyncio.CancelledError, Exception):
                        pass
                return feed_id, feed_name, False, None, "cancelled"
            finally:
                self._active_feed_tasks.discard(task)
                self._task_feed_ids.pop(task, None)
                if slot_held:
                    slot.release()

        worker_tasks: set[asyncio.Task] = set()

        def _record_result(
            feed_id: str,
            feed_name: str,
            ok: bool,
            feed_result: dict[str, Any] | None,
            error_message: str | None,
        ) -> None:
            nonlocal cancelled
            self._inflight_ids.discard(feed_id)
            if error_message == "cancelled":
                cancelled = True
                return
            self._round_completed += 1
            if ok and feed_result is not None:
                self._last_feed_count += 1
                self._round_success_ids.append(feed_id)
                if not feed_result.get("has_new_content"):
                    self._round_no_new.append(
                        {"feed_id": feed_id, "feed_name": feed_name}
                    )
            else:
                reason = humanize_refresh_error(error_message or "刷新失败")
                logger.error("刷新数据源 %s 失败: %s", feed_id, reason)
                self._round_failed.append(
                    {
                        "feed_id": feed_id,
                        "feed_name": feed_name,
                        "error": reason,
                    }
                )
            self._sync_progress(feed_id, feed_name)

        try:
            while True:
                if self._refresh_cancel.is_set():
                    cancelled = True
                    break

                while self._pending and not self._refresh_cancel.is_set():
                    item = self._pending.popleft()
                    self._queued_ids.discard(item.feed_id)
                    self._inflight_ids.add(item.feed_id)
                    task = asyncio.create_task(refresh_one(item))
                    worker_tasks.add(task)
                    self._task_feed_ids[task] = item.feed_id

                self._sync_progress(
                    str(self._refresh_progress.get("feed_id") or ""),
                    str(self._refresh_progress.get("feed_name") or ""),
                )

                if not worker_tasks:
                    break

                self._wake.clear()
                wake_task = asyncio.create_task(self._wake.wait())
                try:
                    done, _ = await asyncio.wait(
                        set(worker_tasks) | {wake_task},
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                finally:
                    if not wake_task.done():
                        wake_task.cancel()
                        try:
                            await wake_task
                        except asyncio.CancelledError:
                            pass

                for task in done:
                    if task is wake_task:
                        continue
                    worker_tasks.discard(task)
                    feed_id = self._task_feed_ids.pop(task, "")
                    try:
                        result = task.result()
                    except asyncio.CancelledError:
                        cancelled = True
                        if feed_id:
                            self._inflight_ids.discard(feed_id)
                        continue
                    except Exception as exc:
                        if feed_id:
                            _record_result(
                                feed_id,
                                "",
                                False,
                                None,
                                str(exc) or "刷新失败",
                            )
                        continue
                    _record_result(*result)

            if cancelled or self._refresh_cancel.is_set():
                cancelled = True
                self._pending.clear()
                self._queued_ids.clear()
                for task in list(worker_tasks):
                    if not task.done():
                        task.cancel()
                if worker_tasks:
                    await asyncio.gather(*worker_tasks, return_exceptions=True)
                for task in list(worker_tasks):
                    feed_id = self._task_feed_ids.pop(task, "")
                    if task.cancelled():
                        if feed_id:
                            self._inflight_ids.discard(feed_id)
                        continue
                    try:
                        result = task.result()
                    except Exception:
                        if feed_id:
                            self._inflight_ids.discard(feed_id)
                        continue
                    _record_result(*result)
                worker_tasks.clear()

            scope, group_id, group_name = self._display_scope()
            failed = list(self._round_failed)
            no_new = list(self._round_no_new)

            if cancelled:
                if scope == "group" and group_name:
                    parts = [
                        f"已停止更新分组「{group_name}」"
                        + (
                            f"（已完成 {self._last_feed_count} 个）"
                            if self._last_feed_count
                            else ""
                        )
                    ]
                else:
                    parts = [
                        "已停止更新"
                        + (
                            f"（已完成 {self._last_feed_count} 个数据源）"
                            if self._last_feed_count
                            else ""
                        )
                    ]
                if failed:
                    parts.append(f"{len(failed)} 个失败")
                message = "，".join(parts)
            elif self._last_feed_count == 0 and self._round_total == 0:
                if scope == "group" and group_name:
                    message = f"分组「{group_name}」暂无数据源"
                else:
                    message = "暂无数据源"
            elif self._last_feed_count == 0:
                message = "未能更新任何数据源"
                self._last_error = failed[0]["error"] if failed else message
            else:
                if scope == "group" and group_name:
                    parts = [f"已更新分组「{group_name}」{self._last_feed_count} 个数据源"]
                else:
                    parts = [f"已更新 {self._last_feed_count} 个数据源"]
                if no_new:
                    parts.append(f"{len(no_new)} 个暂无新文章")
                if failed:
                    parts.append(f"{len(failed)} 个失败")
                message = "，".join(parts)

            feed_client.invalidate_article_cache()
            started = self._round_started_mono or time.monotonic()
            elapsed_seconds = time.monotonic() - started
            message = f"{message}（耗时 {format_duration_zh(elapsed_seconds)}）"

            result = {
                "ok": self._last_feed_count > 0,
                "feed_count": self._last_feed_count,
                "failed": failed,
                "no_new": no_new,
                "message": message,
                "elapsed_seconds": round(elapsed_seconds, 2),
                "scope": scope,
                "group_id": group_id or None,
                "group_name": group_name or None,
                "cancelled": cancelled,
            }
            self._last_refresh_result = result
            self._persist_last_refresh(result)
        except asyncio.CancelledError:
            self._pending.clear()
            self._queued_ids.clear()
            for task in list(worker_tasks):
                if not task.done():
                    task.cancel()
            if worker_tasks:
                await asyncio.gather(*worker_tasks, return_exceptions=True)
            if self._last_refresh_result is None:
                cancelled_msg = (
                    f"已停止更新（已完成 {self._last_feed_count} 个数据源）"
                    if self._last_feed_count > 0
                    else "已停止更新"
                )
                self._last_refresh_result = {
                    "ok": self._last_feed_count > 0,
                    "feed_count": self._last_feed_count,
                    "failed": list(self._round_failed),
                    "message": cancelled_msg,
                    "cancelled": True,
                }
                self._persist_last_refresh(self._last_refresh_result)
            raise
        except Exception as exc:
            self._last_error = str(exc) or "更新失败"
            self._last_refresh_result = {
                "ok": False,
                "feed_count": self._last_feed_count,
                "failed": list(self._round_failed),
                "message": self._last_error,
            }
            self._persist_last_refresh(self._last_refresh_result)
            logger.error("后台更新失败: %s", exc)
        finally:
            self._refresh_task = None
            self._active_feed_tasks.clear()
            self._task_feed_ids.clear()
            self._pending.clear()
            self._queued_ids.clear()
            self._inflight_ids.clear()
            self._refresh_cancel.clear()
            self._wake.clear()
            self._refresh_progress = {
                "current": 0,
                "total": 0,
                "feed_id": "",
                "feed_name": "",
                "last_completed_feed_id": "",
                "completed_feed_ids": [],
                "queued": 0,
                "scope": "all",
                "group_id": "",
                "group_name": "",
            }

    async def run_refresh_all(self, client=None, *, days: int = 1) -> dict[str, Any]:
        return await self.run_refresh_feeds(client or self._client, days=days)

    async def run_refresh_feeds(
        self,
        client=None,
        *,
        feed_ids: list[str] | None = None,
        scope: str = "all",
        group_id: str = "",
        group_name: str = "",
        days: int = 1,
    ) -> dict[str, Any]:
        """入队并等待本轮调度结束（供定时任务等同步等待场景）。"""
        await self._enqueue_refresh_job(
            client,
            feed_ids=feed_ids,
            scope=scope,
            group_id=group_id,
            group_name=group_name,
            days=days,
            start_message="已开始更新数据源，后台执行中",
        )
        task = self._refresh_task
        if task is not None and not task.done():
            try:
                await task
            except asyncio.CancelledError:
                pass
        return self._last_refresh_result or {
            "ok": False,
            "feed_count": 0,
            "failed": [],
            "message": "更新未执行",
            "cancelled": False,
        }

    def _collect_next_runs(self, schedules: list[dict[str, Any]]) -> list[dict[str, Any]]:
        next_runs: list[dict[str, Any]] = []
        for index, sched in enumerate(schedules):
            job = self._scheduler.get_job(f"{JOB_ID_PREFIX}{index}")
            next_run = None
            if job and job.next_run_time:
                next_run = job.next_run_time.astimezone(SHANGHAI).isoformat()
            next_runs.append({**sched, "next_run": next_run})
        return next_runs

    def get_status(self) -> dict[str, Any]:
        config = self.load_config()
        schedules = config.get("schedules", [])
        next_runs = self._collect_next_runs(schedules)
        return {
            "schedules": schedules,
            "enabled": len(schedules) > 0,
            "next_runs": next_runs,
            "refresh_running": self.is_refresh_running(),
            "refresh_progress": dict(self._refresh_progress),
            "last_run_at": self._last_run_at,
            "last_error": self._last_error,
            "last_feed_count": self._last_feed_count,
            "last_refresh_message": (
                self._last_refresh_result.get("message") if self._last_refresh_result else None
            ),
            "last_refresh_failed": (
                self._last_refresh_result.get("failed") if self._last_refresh_result else []
            ),
            "last_refresh_cancelled": bool(
                self._last_refresh_result.get("cancelled") if self._last_refresh_result else False
            ),
        }

    def update_config(
        self,
        *,
        schedules: list[dict[str, Any]],
    ) -> dict[str, Any]:
        normalized = validate_schedules(schedules)
        invalid_count = len(schedules) - len(normalized)
        if schedules and not normalized:
            raise ValueError("请填写有效的定时规则（每天时刻或每隔小时，并可选择分组）")
        if invalid_count > 0 and not normalized:
            raise ValueError("存在无效的定时规则，请检查后重试")

        self.save_config(schedules=normalized)
        self.apply_config()
        return self.get_status()

    def prune_deleted_groups(self, removed_group_ids: list[str]) -> dict[str, Any]:
        """分组删除后同步定时：仅含该组的规则整条移除，否则只从 group_ids 去掉该组。"""
        removed = {
            str(gid).strip().lower()
            for gid in removed_group_ids
            if str(gid or "").strip()
        }
        if not removed:
            return self.get_status()

        config = self.load_config()
        schedules = config.get("schedules", [])
        if not schedules:
            return self.get_status()

        next_schedules: list[dict[str, Any]] = []
        for entry in schedules:
            if not isinstance(entry, dict):
                continue
            group_ids = [
                gid
                for gid in _normalize_group_ids(entry.get("group_ids"))
                if gid not in removed
            ]
            if not group_ids:
                continue
            next_schedules.append({**entry, "group_ids": group_ids})

        self.save_config(schedules=validate_schedules(next_schedules))
        self.apply_config()
        return self.get_status()


feed_scheduler = FeedSchedulerManager()
