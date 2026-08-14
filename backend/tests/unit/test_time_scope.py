from __future__ import annotations

from datetime import datetime, timedelta

from core.time_scope import (
    SHANGHAI,
    calendar_scope_cutoff,
    days_range_label,
    filter_articles_by_days,
    format_duration_zh,
    is_timestamp_today,
    parse_publish_time,
    shanghai_start_of_today,
)


def test_parse_publish_time_accepts_z_suffix() -> None:
    dt = parse_publish_time("2026-08-05T12:00:00Z")
    assert dt is not None
    assert dt.tzinfo == SHANGHAI


def test_calendar_scope_cutoff_three_days() -> None:
    now = datetime(2026, 8, 6, 15, 0, tzinfo=SHANGHAI)
    cutoff = calendar_scope_cutoff(3, now=now)
    assert cutoff == datetime(2026, 8, 4, 0, 0, tzinfo=SHANGHAI)


def test_filter_articles_by_days() -> None:
    today = shanghai_start_of_today()
    recent = (today.replace(hour=8)).isoformat()
    old = (today - timedelta(days=5)).replace(hour=8).isoformat()
    articles = [
        {"published_at": recent},
        {"published_at": old},
        {"published_at": ""},
    ]
    filtered = filter_articles_by_days(articles, days=3)
    assert len(filtered) == 1


def test_is_timestamp_today() -> None:
    now = datetime(2026, 8, 6, 23, 0, tzinfo=SHANGHAI)
    today_ts = shanghai_start_of_today(now=now).timestamp() + 3600
    yesterday_ts = shanghai_start_of_today(now=now).timestamp() - 3600
    assert is_timestamp_today(today_ts, now=now) is True
    assert is_timestamp_today(yesterday_ts, now=now) is False


def test_days_range_label() -> None:
    assert days_range_label(1) == "今天"
    assert days_range_label(3) == "近 3 天"


def test_format_duration_zh() -> None:
    assert format_duration_zh(3.2) == "3.2 秒"
    assert format_duration_zh(65) == "1 分 5 秒"
