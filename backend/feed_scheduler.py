import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from zoneinfo import ZoneInfo

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CONFIG_PATH = DATA_DIR / "feed_scheduler.json"
SHANGHAI = ZoneInfo("Asia/Shanghai")
DEFAULT_REFRESH_INTERVAL_SECONDS = 3
MIN_REFRESH_INTERVAL_SECONDS = 0
MAX_REFRESH_INTERVAL_SECONDS = 600
JOB_ID_PREFIX = "feed_refresh_"

DEFAULT_CONFIG: dict[str, Any] = {
    "schedules": [],
    "refresh_interval_seconds": DEFAULT_REFRESH_INTERVAL_SECONDS,
}

logger = logging.getLogger(__name__)


def _normalize_schedule(entry: dict[str, Any]) -> dict[str, int] | None:
    try:
        hour = int(entry.get("hour", 0))
        minute = int(entry.get("minute", 0))
        second = int(entry.get("second", 0))
    except (TypeError, ValueError):
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
        return None
    return {"hour": hour, "minute": minute, "second": second}


def validate_refresh_interval(value: Any) -> int:
    try:
        interval = int(value)
    except (TypeError, ValueError):
        return DEFAULT_REFRESH_INTERVAL_SECONDS
    return min(MAX_REFRESH_INTERVAL_SECONDS, max(MIN_REFRESH_INTERVAL_SECONDS, interval))


def validate_schedules(schedules: list[dict[str, Any]]) -> list[dict[str, int]]:
    normalized: list[dict[str, int]] = []
    seen: set[tuple[int, int, int]] = set()
    for entry in schedules:
        item = _normalize_schedule(entry)
        if item is None:
            continue
        key = (item["hour"], item["minute"], item["second"])
        if key in seen:
            continue
        seen.add(key)
        normalized.append(item)
    normalized.sort(key=lambda item: (item["hour"], item["minute"], item["second"]))
    return normalized


def _migrate_legacy_config(data: dict[str, Any]) -> list[dict[str, int]]:
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
        self._refresh_lock = asyncio.Lock()
        self._refresh_task: asyncio.Task | None = None
        self._refresh_progress: dict[str, Any] = {
            "current": 0,
            "total": 0,
            "feed_name": "",
        }
        self._last_refresh_result: dict[str, Any] | None = None
        self._last_run_at: float | None = None
        self._last_error: str | None = None
        self._last_feed_count = 0

    def load_config(self) -> dict[str, Any]:
        if not CONFIG_PATH.exists():
            return dict(DEFAULT_CONFIG)
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(data.get("schedules"), list):
                schedules = validate_schedules(data["schedules"])
            else:
                schedules = _migrate_legacy_config(data)
            interval = validate_refresh_interval(
                data.get("refresh_interval_seconds", DEFAULT_REFRESH_INTERVAL_SECONDS)
            )
            return {"schedules": schedules, "refresh_interval_seconds": interval}
        except (json.JSONDecodeError, OSError):
            return dict(DEFAULT_CONFIG)

    def save_config(
        self,
        *,
        schedules: list[dict[str, int]],
        refresh_interval_seconds: int,
    ) -> dict[str, Any]:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        payload = {
            "schedules": validate_schedules(schedules),
            "refresh_interval_seconds": validate_refresh_interval(refresh_interval_seconds),
        }
        CONFIG_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload

    def get_refresh_interval(self) -> int:
        return self.load_config().get("refresh_interval_seconds", DEFAULT_REFRESH_INTERVAL_SECONDS)

    def start(self, client) -> None:
        self._client = client
        if not self._scheduler.running:
            self._scheduler.start()
        self.apply_config()

    def shutdown(self) -> None:
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)

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
            self._scheduler.add_job(
                self._run_refresh_all,
                CronTrigger(
                    second=sched["second"],
                    minute=sched["minute"],
                    hour=sched["hour"],
                    timezone=SHANGHAI,
                ),
                id=f"{JOB_ID_PREFIX}{index}",
                replace_existing=True,
            )

    async def _run_refresh_all(self) -> None:
        if self.is_refresh_running():
            logger.info("跳过定时刷新：已有更新任务进行中")
            return
        try:
            await self.run_refresh_all()
        except Exception as exc:
            self._last_error = str(exc) or "定时刷新失败"
            logger.error("定时刷新任务失败: %s", exc)

    def is_refresh_running(self) -> bool:
        return self._refresh_task is not None and not self._refresh_task.done()

    def start_refresh_all(self, client=None) -> dict[str, Any]:
        if self.is_refresh_running():
            raise RuntimeError("已有更新任务进行中，请稍后再试")

        feed_client = client or self._client
        if feed_client is None:
            raise RuntimeError("数据源客户端未就绪")

        self._last_refresh_result = None
        self._refresh_task = asyncio.create_task(self._refresh_worker(feed_client))
        return {
            "started": True,
            "message": "已开始更新全部数据源，后台执行中",
        }

    async def _refresh_worker(self, feed_client) -> None:
        try:
            result = await asyncio.shield(self.run_refresh_all(feed_client))
            self._last_refresh_result = result
        except Exception as exc:
            self._last_error = str(exc) or "更新全部失败"
            self._last_refresh_result = {
                "ok": False,
                "feed_count": self._last_feed_count,
                "failed": [],
                "message": self._last_error,
            }
            logger.error("后台更新全部失败: %s", exc)
        finally:
            self._refresh_task = None
            self._refresh_progress = {"current": 0, "total": 0, "feed_name": ""}

    async def run_refresh_all(self, client=None) -> dict[str, Any]:
        feed_client = client or self._client
        if feed_client is None:
            raise RuntimeError("数据源客户端未就绪")

        async with self._refresh_lock:
            self._last_run_at = time.time()
            self._last_error = None
            self._last_feed_count = 0
            failed: list[dict[str, str]] = []
            no_new: list[dict[str, str]] = []

            feeds = await feed_client.list_feeds()
            enabled_feeds = [
                feed
                for feed in feeds
                if feed.get("status", 1) == 1 and feed.get("id")
            ]
            total = len(enabled_feeds)
            self._refresh_progress = {"current": 0, "total": total, "feed_name": ""}

            for index, feed in enumerate(enabled_feeds):
                feed_id = feed.get("id", "")
                feed_name = feed.get("mpName", "")
                self._refresh_progress = {
                    "current": index + 1,
                    "total": total,
                    "feed_name": feed_name,
                }
                try:
                    feed_result = await feed_client.refresh_feed(feed_id)
                    self._last_feed_count += 1
                    if not feed_result.get("has_new_content"):
                        no_new.append({"feed_id": feed_id, "feed_name": feed_name})
                except Exception as exc:
                    logger.error("刷新数据源 %s 失败: %s", feed_id, exc)
                    failed.append(
                        {
                            "feed_id": feed_id,
                            "feed_name": feed_name,
                            "error": str(exc) or "刷新失败",
                        }
                    )
                delay = self.get_refresh_interval()
                if index < total - 1 and delay > 0:
                    await asyncio.sleep(delay)

            if self._last_feed_count == 0 and not feeds:
                message = "暂无数据源"
            elif self._last_feed_count == 0:
                message = "未能更新任何数据源"
                self._last_error = failed[0]["error"] if failed else message
            else:
                parts = [f"已更新 {self._last_feed_count} 个数据源"]
                if no_new:
                    parts.append(f"{len(no_new)} 个暂无新文章")
                if failed:
                    parts.append(f"{len(failed)} 个失败")
                message = "，".join(parts)

            feed_client.invalidate_article_cache()

            return {
                "ok": self._last_feed_count > 0,
                "feed_count": self._last_feed_count,
                "failed": failed,
                "no_new": no_new,
                "message": message,
            }

    def _collect_next_runs(self, schedules: list[dict[str, int]]) -> list[dict[str, Any]]:
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
            "refresh_interval_seconds": config.get(
                "refresh_interval_seconds", DEFAULT_REFRESH_INTERVAL_SECONDS
            ),
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
        }

    def update_config(
        self,
        *,
        schedules: list[dict[str, Any]],
        refresh_interval_seconds: int | None = None,
    ) -> dict[str, Any]:
        normalized = validate_schedules(schedules)
        invalid_count = len(schedules) - len(normalized)
        if schedules and not normalized:
            raise ValueError("请填写有效的执行时间（时 0–23，分/秒 0–59）")
        if invalid_count > 0 and not normalized:
            raise ValueError("存在无效的时间，请检查后重试")

        current = self.load_config()
        interval = validate_refresh_interval(
            refresh_interval_seconds
            if refresh_interval_seconds is not None
            else current.get("refresh_interval_seconds")
        )
        self.save_config(schedules=normalized, refresh_interval_seconds=interval)
        self.apply_config()
        return self.get_status()


feed_scheduler = FeedSchedulerManager()
