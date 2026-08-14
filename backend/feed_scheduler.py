import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from zoneinfo import ZoneInfo

from time_scope import format_duration_zh

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CONFIG_PATH = DATA_DIR / "feed_scheduler.json"
SHANGHAI = ZoneInfo("Asia/Shanghai")
JOB_ID_PREFIX = "feed_refresh_"
DEFAULT_REFRESH_CONCURRENCY = max(1, int(os.getenv("FEED_REFRESH_CONCURRENCY", "8")))
# 微信公众号共用同一后台登录态：刷新并发单独压到 1，避免多号并行打 list_ex
DEFAULT_WEIXIN_REFRESH_CONCURRENCY = max(
    1, int(os.getenv("FEED_WEIXIN_REFRESH_CONCURRENCY", "1"))
)
# 单个数据源刷新硬超时：超时后记失败并释放并发槽，避免整批卡在某一个源上
DEFAULT_FEED_REFRESH_TIMEOUT = max(15.0, float(os.getenv("FEED_REFRESH_TIMEOUT", "30")))

DEFAULT_CONFIG: dict[str, Any] = {
    "schedules": [],
}

logger = logging.getLogger(__name__)


def humanize_refresh_error(raw: str) -> str:
    """将刷新异常转成用户可读原因（常见为网络不可达/反爬）。"""
    text = (raw or "").strip()
    if not text:
        return "未知错误"
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
            "feed_id": "",
            "feed_name": "",
            "last_completed_feed_id": "",
            "completed_feed_ids": [],
            "scope": "all",
            "group_id": "",
            "group_name": "",
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
            return {"schedules": schedules}
        except (json.JSONDecodeError, OSError):
            return dict(DEFAULT_CONFIG)

    def save_config(
        self,
        *,
        schedules: list[dict[str, int]],
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

    def start_refresh_all(self, client=None, *, days: int = 1) -> dict[str, Any]:
        return self._start_refresh_job(
            client,
            feed_ids=None,
            scope="all",
            group_id="",
            group_name="",
            days=days,
            start_message="已开始更新全部数据源，后台执行中",
        )

    def start_refresh_group(
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
        return self._start_refresh_job(
            client,
            feed_ids=feed_ids,
            scope="group",
            group_id=group_id,
            group_name=label,
            days=days,
            start_message=f"已开始更新分组「{label}」，后台执行中",
        )

    def _start_refresh_job(
        self,
        client,
        *,
        feed_ids: list[str] | None,
        scope: str,
        group_id: str,
        group_name: str,
        start_message: str,
        days: int = 1,
    ) -> dict[str, Any]:
        if self.is_refresh_running():
            raise RuntimeError("已有更新任务进行中，请稍后再试")

        feed_client = client or self._client
        if feed_client is None:
            raise RuntimeError("数据源客户端未就绪")

        self._last_refresh_result = None
        self._refresh_task = asyncio.create_task(
            self._refresh_worker(
                feed_client,
                feed_ids=feed_ids,
                scope=scope,
                group_id=group_id,
                group_name=group_name,
                days=days,
            )
        )
        payload: dict[str, Any] = {
            "started": True,
            "message": start_message,
            "scope": scope,
            "days": max(1, int(days)),
        }
        if scope == "group":
            payload["group_id"] = group_id
            payload["group_name"] = group_name
            payload["feed_count"] = len(feed_ids or [])
        return payload

    async def _refresh_worker(
        self,
        feed_client,
        *,
        feed_ids: list[str] | None = None,
        scope: str = "all",
        group_id: str = "",
        group_name: str = "",
        days: int = 1,
    ) -> None:
        try:
            result = await asyncio.shield(
                self.run_refresh_feeds(
                    feed_client,
                    feed_ids=feed_ids,
                    scope=scope,
                    group_id=group_id,
                    group_name=group_name,
                    days=days,
                )
            )
            self._last_refresh_result = result
        except Exception as exc:
            self._last_error = str(exc) or "更新失败"
            self._last_refresh_result = {
                "ok": False,
                "feed_count": self._last_feed_count,
                "failed": [],
                "message": self._last_error,
            }
            logger.error("后台更新失败: %s", exc)
        finally:
            self._refresh_task = None
            self._refresh_progress = {
                "current": 0,
                "total": 0,
                "feed_id": "",
                "feed_name": "",
                "last_completed_feed_id": "",
                "completed_feed_ids": [],
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
        feed_client = client or self._client
        if feed_client is None:
            raise RuntimeError("数据源客户端未就绪")

        refresh_days = max(1, int(days))

        async with self._refresh_lock:
            self._last_run_at = time.time()
            self._last_error = None
            self._last_feed_count = 0
            failed: list[dict[str, str]] = []
            no_new: list[dict[str, str]] = []
            batch_started = time.monotonic()

            feeds = await feed_client.list_feeds()
            enabled_feeds = [
                feed
                for feed in feeds
                if feed.get("status", 1) == 1 and feed.get("id")
            ]
            if feed_ids is not None:
                allowed = set(feed_ids)
                enabled_feeds = [feed for feed in enabled_feeds if feed.get("id") in allowed]

            total = len(enabled_feeds)
            self._refresh_progress = {
                "current": 0,
                "total": total,
                "feed_id": "",
                "feed_name": "",
                "last_completed_feed_id": "",
                "completed_feed_ids": [],
                "scope": scope,
                "group_id": group_id,
                "group_name": group_name,
            }

            if total > 0:
                from feed_registry import feed_registry

                def _is_weixin_feed(feed_id: str) -> bool:
                    fid = (feed_id or "").strip()
                    if fid.startswith("website:weixin:"):
                        return True
                    account = feed_registry.get_platform_account(fid)
                    return bool(
                        account
                        and str(account.get("platform") or "").strip().lower() == "weixin"
                    )

                gen_sem = asyncio.Semaphore(min(DEFAULT_REFRESH_CONCURRENCY, total))
                weixin_sem = asyncio.Semaphore(
                    min(DEFAULT_WEIXIN_REFRESH_CONCURRENCY, total)
                )
                completed_count = 0
                completed_success_ids: list[str] = []
                per_feed_timeout = DEFAULT_FEED_REFRESH_TIMEOUT

                async def refresh_one(feed: dict[str, Any]) -> tuple[str, str, bool, dict[str, Any] | None, str | None]:
                    feed_id = str(feed.get("id", ""))
                    feed_name = str(feed.get("mpName", ""))
                    slot = weixin_sem if _is_weixin_feed(feed_id) else gen_sem
                    await slot.acquire()
                    task = asyncio.create_task(
                        feed_client.refresh_feed(feed_id, days=refresh_days)
                    )
                    try:
                        done, _pending = await asyncio.wait({task}, timeout=per_feed_timeout)
                        if task not in done:
                            # 超时：释放并发槽，后台任务继续跑完但不阻塞整批
                            def _swallow(done_task: asyncio.Task) -> None:
                                try:
                                    done_task.result()
                                except Exception:
                                    pass

                            task.add_done_callback(_swallow)
                            return (
                                feed_id,
                                feed_name,
                                False,
                                None,
                                f"刷新超时（>{int(per_feed_timeout)}s），已跳过该源",
                            )
                        try:
                            feed_result = task.result()
                            return feed_id, feed_name, True, feed_result, None
                        except Exception as exc:
                            return feed_id, feed_name, False, None, str(exc) or "刷新失败"
                    finally:
                        slot.release()

                tasks = [asyncio.create_task(refresh_one(feed)) for feed in enabled_feeds]
                for done in asyncio.as_completed(tasks):
                    feed_id, feed_name, ok, feed_result, error_message = await done
                    completed_count += 1
                    if ok and feed_result is not None:
                        self._last_feed_count += 1
                        completed_success_ids.append(feed_id)
                        if not feed_result.get("has_new_content"):
                            no_new.append({"feed_id": feed_id, "feed_name": feed_name})
                    else:
                        reason = humanize_refresh_error(error_message or "刷新失败")
                        logger.error("刷新数据源 %s 失败: %s", feed_id, reason)
                        failed.append(
                            {
                                "feed_id": feed_id,
                                "feed_name": feed_name,
                                "error": reason,
                            }
                        )
                    self._refresh_progress = {
                        "current": completed_count,
                        "total": total,
                        "feed_id": feed_id,
                        "feed_name": feed_name,
                        "last_completed_feed_id": feed_id,
                        "completed_feed_ids": list(completed_success_ids),
                        "scope": scope,
                        "group_id": group_id,
                        "group_name": group_name,
                    }

            if self._last_feed_count == 0 and not enabled_feeds:
                if scope == "group" and group_name:
                    message = f"分组「{group_name}」暂无数据源"
                elif not feeds:
                    message = "暂无数据源"
                else:
                    message = "未能更新任何数据源"
                    self._last_error = failed[0]["error"] if failed else message
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
            elapsed_seconds = time.monotonic() - batch_started
            duration = format_duration_zh(elapsed_seconds)
            message = f"{message}（耗时 {duration}）"

            return {
                "ok": self._last_feed_count > 0,
                "feed_count": self._last_feed_count,
                "failed": failed,
                "no_new": no_new,
                "message": message,
                "elapsed_seconds": round(elapsed_seconds, 2),
                "scope": scope,
                "group_id": group_id or None,
                "group_name": group_name or None,
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
        }

    def update_config(
        self,
        *,
        schedules: list[dict[str, Any]],
    ) -> dict[str, Any]:
        normalized = validate_schedules(schedules)
        invalid_count = len(schedules) - len(normalized)
        if schedules and not normalized:
            raise ValueError("请填写有效的执行时间（时 0–23，分/秒 0–59）")
        if invalid_count > 0 and not normalized:
            raise ValueError("存在无效的时间，请检查后重试")

        self.save_config(schedules=normalized)
        self.apply_config()
        return self.get_status()


feed_scheduler = FeedSchedulerManager()
