"""Askme 数据源统一 HTTP 策略：超时、重试退避与页间限速。

所有 discovery skill 的对外 HTTP 请求必须通过本模块（禁止直接 urlopen 并自定义 timeout）。
常量须与 backend/feed_http_policy.py 保持一致。
"""

from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.request
from typing import Any

# 与 backend/feed_http_policy.py 同步（所有 discovery 必须遵循，禁止覆盖）
REQUEST_TIMEOUT_SECONDS = 5
DEFAULT_RETRIES = 1
RETRYABLE_HTTP_CODES = frozenset({429, 502, 503})
BACKOFF_BASE_SECONDS = 0.8
BACKOFF_JITTER_SECONDS = 0.25
PAGE_DELAY_BASE_SECONDS = 0.8
PAGE_DELAY_JITTER_SECONDS = 0.3


def _backoff_sleep(attempt: int) -> None:
    delay = BACKOFF_BASE_SECONDS * (2**attempt) + random.uniform(0, BACKOFF_JITTER_SECONDS)
    time.sleep(delay)


def sleep_between_pages() -> None:
    """分页拉取时在页与页之间调用，降低触发限流概率。"""
    delay = PAGE_DELAY_BASE_SECONDS + random.uniform(0, PAGE_DELAY_JITTER_SECONDS)
    time.sleep(delay)


def fetch_bytes_and_headers(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    method: str | None = None,
    timeout: float | None = None,
    retries: int = DEFAULT_RETRIES,
) -> tuple[bytes, Any]:
    # 统一 5s：忽略调用方传入的 timeout，避免各 skill 各自放宽
    _ = timeout
    timeout_value = REQUEST_TIMEOUT_SECONDS
    base_headers = dict(headers or {})
    last_err: Exception | None = None

    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, headers=base_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout_value) as resp:
                return resp.read(), resp.headers
        except urllib.error.HTTPError as exc:
            last_err = exc
            if exc.code in RETRYABLE_HTTP_CODES and attempt < retries:
                _backoff_sleep(attempt)
                continue
            raise
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            if attempt < retries:
                _backoff_sleep(attempt)
                continue
            raise

    if last_err:
        raise last_err
    raise RuntimeError(f"请求失败: {url}")


def fetch_bytes(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    method: str | None = None,
    timeout: float | None = None,
    retries: int = DEFAULT_RETRIES,
) -> bytes:
    body, _ = fetch_bytes_and_headers(
        url,
        headers=headers,
        data=data,
        method=method,
        timeout=timeout,
        retries=retries,
    )
    return body


def fetch_text(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    method: str | None = None,
    encoding: str = "utf-8",
    errors: str = "ignore",
    timeout: float | None = None,
    retries: int = DEFAULT_RETRIES,
) -> str:
    raw = fetch_bytes(
        url,
        headers=headers,
        data=data,
        method=method,
        timeout=timeout,
        retries=retries,
    )
    return raw.decode(encoding, errors=errors)


def fetch_json(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    method: str | None = None,
    timeout: float | None = None,
    retries: int = DEFAULT_RETRIES,
) -> Any:
    text = fetch_text(
        url,
        headers=headers,
        data=data,
        method=method,
        timeout=timeout,
        retries=retries,
        errors="strict",
    )
    return json.loads(text)


def fetch_with_headers(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    method: str | None = None,
    timeout: float | None = None,
    retries: int = DEFAULT_RETRIES,
) -> tuple[bytes, dict[str, str]]:
    body, resp_headers = fetch_bytes_and_headers(
        url,
        headers=headers,
        data=data,
        method=method,
        timeout=timeout,
        retries=retries,
    )
    header_map = {k.lower(): v for k, v in resp_headers.items()}
    return body, header_map
