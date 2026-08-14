"""数据源刷新 HTTP 策略（与 .cursor/skills/_lib/http_client.py 常量同步）。"""

from __future__ import annotations

import os
import random

REQUEST_TIMEOUT_SECONDS = 5
DEFAULT_RETRIES = 3
PAGE_DELAY_BASE_SECONDS = float(os.getenv("FEED_PAGE_DELAY", "1.2"))
PAGE_DELAY_JITTER_SECONDS = 0.4


def page_delay_seconds() -> float:
    """刷新分页之间的等待时长（带抖动）。"""
    return PAGE_DELAY_BASE_SECONDS + random.uniform(0, PAGE_DELAY_JITTER_SECONDS)
