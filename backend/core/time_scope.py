"""自然日时间范围（Asia/Shanghai）。"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo("Asia/Shanghai")


def parse_publish_time(published_at: str) -> datetime | None:
    if not published_at:
        return None
    try:
        dt = datetime.fromisoformat(str(published_at).replace("Z", "+00:00"))
        return dt.astimezone(SHANGHAI)
    except ValueError:
        return None


def shanghai_start_of_today(*, now: datetime | None = None) -> datetime:
    current = (now or datetime.now(SHANGHAI)).astimezone(SHANGHAI)
    return current.replace(hour=0, minute=0, second=0, microsecond=0)


def is_timestamp_today(ts: float | None, *, now: datetime | None = None) -> bool:
    """unix 时间戳是否落在上海时区「今天」自然日内。"""
    if ts is None:
        return False
    try:
        value = float(ts)
    except (TypeError, ValueError):
        return False
    if value <= 0:
        return False
    dt = datetime.fromtimestamp(value, tz=SHANGHAI)
    return dt >= shanghai_start_of_today(now=now)


def calendar_scope_cutoff(days: int, *, now: datetime | None = None) -> datetime:
    """近 N 天：上海时区当天 0 点起往前覆盖 N 个自然日（含今天）。

    例：days=1 → 今天 00:00；days=3 → 前天 00:00。
    """
    n = max(1, int(days))
    return shanghai_start_of_today(now=now) - timedelta(days=n - 1)


def filter_articles_by_days(articles: list[dict], days: int) -> list[dict]:
    cutoff = calendar_scope_cutoff(days)
    filtered: list[dict] = []
    for article in articles:
        published = parse_publish_time(str(article.get("published_at") or ""))
        if published is None or published < cutoff:
            continue
        filtered.append(article)
    return filtered


def days_range_label(days: int) -> str:
    n = max(1, int(days))
    return "今天" if n == 1 else f"近 {n} 天"


def format_duration_zh(seconds: float) -> str:
    """将秒数格式化为中文耗时，如「3.2 秒」「1 分 12 秒」。"""
    sec = max(0.0, float(seconds))
    if sec < 60:
        if sec < 10:
            return f"{sec:.1f} 秒"
        return f"{int(round(sec))} 秒"
    minutes = int(sec // 60)
    rem = int(round(sec - minutes * 60))
    if rem >= 60:
        minutes += 1
        rem = 0
    if rem == 0:
        return f"{minutes} 分"
    return f"{minutes} 分 {rem} 秒"
