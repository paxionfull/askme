"""X 平台访问 x.com / api.x.com 的统一间隔（列表、正文、探测）。"""

from __future__ import annotations

import os
import random
import time

# 所有 X 原站/API 请求的基准间隔（秒）；可通过环境变量 X_ACCESS_INTERVAL_SECONDS 覆盖
X_ACCESS_INTERVAL_SECONDS = float(os.getenv("X_ACCESS_INTERVAL_SECONDS", "3.0"))
_X_ACCESS_JITTER_SECONDS = 0.4


def x_access_delay_seconds() -> float:
    """单次等待时长（含轻微抖动）。"""
    return X_ACCESS_INTERVAL_SECONDS + random.uniform(0, _X_ACCESS_JITTER_SECONDS)


def sleep_between_x_access() -> None:
    """两次 X 相关 HTTP 请求之间的阻塞等待。"""
    time.sleep(x_access_delay_seconds())
