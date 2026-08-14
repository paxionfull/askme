"""Backend 读取 X 统一访问间隔（实现在 skills/discovery/_lib/x_access_policy.py）。"""

from __future__ import annotations

import sys

from paths import SKILLS_LIB

if str(SKILLS_LIB) not in sys.path:
    sys.path.insert(0, str(SKILLS_LIB))

from x_access_policy import (  # noqa: E402
    X_ACCESS_INTERVAL_SECONDS,
    sleep_between_x_access,
    x_access_delay_seconds,
)

__all__ = [
    "X_ACCESS_INTERVAL_SECONDS",
    "is_x_feed_id",
    "sleep_between_x_access",
    "x_access_delay_seconds",
]


def is_x_feed_id(feed_id: str) -> bool:
    fid = (feed_id or "").strip().lower()
    return fid.startswith("website:x:")
