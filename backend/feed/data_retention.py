"""按自然日保留窗口清理本地文章 / 正文 / 索引等占用磁盘的数据。

默认保留近 3 个上海自然日（与产品「最多 cover 3 天」一致）。
"""

from __future__ import annotations

import logging
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

from core.time_scope import calendar_scope_cutoff
from paths import DATA_DIR

logger = logging.getLogger(__name__)

DEFAULT_RETENTION_DAYS = 3
RETENTION_JOB_ID = "data_retention_daily"


def retention_days() -> int:
    raw = os.getenv("DATA_RETENTION_DAYS", str(DEFAULT_RETENTION_DAYS)).strip()
    try:
        return max(1, min(30, int(raw)))
    except ValueError:
        return DEFAULT_RETENTION_DAYS


def retention_cron_hour() -> int:
    try:
        return max(0, min(23, int(os.getenv("DATA_RETENTION_HOUR", "4"))))
    except ValueError:
        return 4


def retention_cron_minute() -> int:
    try:
        return max(0, min(59, int(os.getenv("DATA_RETENTION_MINUTE", "0"))))
    except ValueError:
        return 0


def _should_vacuum(deleted: int) -> bool:
    flag = os.getenv("DATA_RETENTION_VACUUM", "").strip().lower()
    if flag in {"0", "false", "no", "off"}:
        return False
    if flag in {"1", "true", "yes", "on"}:
        return deleted > 0
    # 默认：删得够多才 VACUUM，避免启动时无意义重写大库
    return deleted >= 200


def _vacuum_path(path: Path) -> None:
    if not path.is_file():
        return
    conn = sqlite3.connect(path)
    try:
        conn.execute("VACUUM")
    except sqlite3.Error as exc:
        logger.warning("VACUUM %s skipped: %s", path.name, exc)
    finally:
        conn.close()


def _purge_onboarding_logs(cutoff_ts: float) -> int:
    logs_dir = DATA_DIR / "onboarding-logs"
    if not logs_dir.is_dir():
        return 0
    removed = 0
    for path in logs_dir.glob("*.jsonl"):
        try:
            if path.stat().st_mtime < cutoff_ts:
                path.unlink(missing_ok=True)
                removed += 1
        except OSError:
            continue
    return removed


def run_data_retention(*, days: int | None = None, vacuum: bool | None = None) -> dict[str, Any]:
    """删除早于保留窗口的本地缓存数据。可同步调用（供定时任务）。"""
    keep_days = retention_days() if days is None else max(1, min(30, int(days)))
    cutoff = calendar_scope_cutoff(keep_days)
    cutoff_ts = cutoff.timestamp()
    started = time.time()
    result: dict[str, Any] = {
        "ok": True,
        "days": keep_days,
        "cutoff": cutoff.isoformat(),
        "deleted": {},
    }

    try:
        from feed.website_article_store import WebsiteArticleStore

        n = WebsiteArticleStore().delete_older_than(cutoff)
        result["deleted"]["articles"] = n
    except Exception as exc:
        logger.exception("retention: articles failed")
        result["deleted"]["articles_error"] = str(exc)

    try:
        from feed.article_body_store import ArticleBodyStore

        n = ArticleBodyStore().delete_older_than(cutoff)
        result["deleted"]["bodies"] = n
    except Exception as exc:
        logger.exception("retention: bodies failed")
        result["deleted"]["bodies_error"] = str(exc)

    try:
        from chat.chunk_store import ChunkStore

        n = ChunkStore().delete_older_than(cutoff)
        result["deleted"]["chunks"] = n
    except Exception as exc:
        logger.exception("retention: chunks failed")
        result["deleted"]["chunks_error"] = str(exc)

    try:
        from digest.digest_cache import _store as digest_summary_store

        n = digest_summary_store.delete_older_than(cutoff_ts)
        result["deleted"]["digest_summaries"] = n
    except Exception as exc:
        logger.exception("retention: digest_summaries failed")
        result["deleted"]["digest_summaries_error"] = str(exc)

    try:
        from digest.digest_step_cache import _store as digest_step_store

        n = digest_step_store.delete_older_than(cutoff_ts)
        result["deleted"]["digest_steps"] = n
    except Exception as exc:
        logger.exception("retention: digest_steps failed")
        result["deleted"]["digest_steps_error"] = str(exc)

    try:
        result["deleted"]["onboarding_logs"] = _purge_onboarding_logs(cutoff_ts)
    except Exception as exc:
        logger.exception("retention: onboarding_logs failed")
        result["deleted"]["onboarding_logs_error"] = str(exc)

    total_deleted = sum(
        int(v) for k, v in result["deleted"].items() if not str(k).endswith("_error") and isinstance(v, int)
    )
    do_vacuum = _should_vacuum(total_deleted) if vacuum is None else bool(vacuum)
    if do_vacuum and total_deleted > 0:
        for name in (
            "website_articles.db",
            "article_bodies.db",
            "article_chunks.db",
            "digest_summaries.db",
            "digest_step_cache.db",
        ):
            _vacuum_path(DATA_DIR / name)
        result["vacuum"] = True
    else:
        result["vacuum"] = False

    result["elapsed_sec"] = round(time.time() - started, 3)
    result["total_deleted"] = total_deleted
    logger.info(
        "data retention done: keep=%sd cutoff=%s deleted=%s vacuum=%s elapsed=%.2fs",
        keep_days,
        result["cutoff"],
        result["deleted"],
        result["vacuum"],
        result["elapsed_sec"],
    )
    return result
