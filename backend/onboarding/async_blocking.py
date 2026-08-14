"""把同步阻塞（HTTP probe / validate）丢进线程，避免占满 asyncio 事件循环。"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


async def run_blocking(fn: Callable[..., T], /, *args, **kwargs) -> T:
    """在默认线程池执行同步函数，让取消后的收尾不再堵住预检等 API。"""
    if kwargs:
        return await asyncio.to_thread(lambda: fn(*args, **kwargs))
    return await asyncio.to_thread(fn, *args)
