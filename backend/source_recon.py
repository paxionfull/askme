"""收集新网站的一手证据，供 onboarding Agent 分析（不用 RSS）。"""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
DEFAULT_TIMEOUT = 5.0
MAX_SAMPLE_CHARS = 2500


def _truncate(text: str, limit: int = MAX_SAMPLE_CHARS) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit] + "\n…[truncated]"


def _base_url(entry_url: str) -> str:
    parsed = urlparse(entry_url.strip())
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("请输入有效的 http(s) URL")
    return f"{parsed.scheme}://{parsed.netloc}"


def _extract_api_hints(html: str, base: str) -> list[str]:
    hints: set[str] = set()
    patterns = (
        r'https?://[^\s"\']+(?:api|json|wp-json)[^\s"\']*',
        r'/(?:api|wp-json)[^\s"\']+',
    )
    for pattern in patterns:
        for match in re.findall(pattern, html, flags=re.I):
            url = match if match.startswith("http") else urljoin(base, match)
            hints.add(url.split('"')[0].split("'")[0])
    return sorted(hints)[:20]


async def _probe_url(
    client: httpx.AsyncClient,
    url: str,
    *,
    referer: str | None = None,
) -> dict[str, Any]:
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    try:
        response = await client.get(url, headers=headers, follow_redirects=True)
        content_type = response.headers.get("content-type", "")
        body = response.text
        sample = body
        parsed_json: Any = None
        if "json" in content_type or body.lstrip().startswith(("{", "[")):
            try:
                parsed_json = response.json()
                sample = json.dumps(parsed_json, ensure_ascii=False, indent=2)
            except Exception:
                sample = body
        return {
            "url": str(response.url),
            "status": response.status_code,
            "content_type": content_type,
            "sample": _truncate(sample),
            "json_keys": list(parsed_json.keys())[:20] if isinstance(parsed_json, dict) else None,
            "json_is_list": isinstance(parsed_json, list),
            "json_list_len": len(parsed_json) if isinstance(parsed_json, list) else None,
        }
    except Exception as exc:
        return {"url": url, "error": str(exc)}


async def collect_site_evidence(
    entry_url: str,
    *,
    hints: str = "",
    list_api_hint: str = "",
) -> dict[str, Any]:
    base = _base_url(entry_url)
    fetches: list[dict[str, Any]] = []
    urls_to_probe: list[str] = [entry_url.strip()]

    if list_api_hint.strip():
        urls_to_probe.append(list_api_hint.strip())

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        entry_fetch = await _probe_url(client, entry_url.strip(), referer=entry_url)
        fetches.append(entry_fetch)

        html = entry_fetch.get("sample", "")
        if not isinstance(html, str):
            html = ""
        api_hints = _extract_api_hints(html, base)
        for hint in api_hints[:8]:
            urls_to_probe.append(hint)

        # 常见 JSON 列表路径（仅作线索，Agent 决定是否采用）
        for path in (
            "/wp-json/wp/v2/posts?per_page=2&_fields=id,link,title,date",
            "/api/article_library/articles.json?page=1&per=2",
            "/api/articles.json",
        ):
            urls_to_probe.append(urljoin(base, path))

        seen: set[str] = set()
        for url in urls_to_probe:
            if url in seen:
                continue
            seen.add(url)
            if url == entry_url.strip() and entry_fetch in fetches:
                continue
            fetches.append(await _probe_url(client, url, referer=entry_url))

    soup = BeautifulSoup(entry_fetch.get("sample", ""), "html.parser") if entry_fetch.get("sample") else None
    page_title = soup.title.get_text(strip=True) if soup and soup.title else ""

    return {
        "entry_url": entry_url.strip(),
        "base_url": base,
        "page_title": page_title,
        "user_hints": hints.strip(),
        "list_api_hint": list_api_hint.strip(),
        "api_url_hints": api_hints,
        "fetches": fetches,
    }
