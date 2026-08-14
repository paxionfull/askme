#!/usr/bin/env python3
"""X 脚手架模板（占位符替换）；运行时以 x-platform-discovery 为准。

占位：__ASKME_SCREEN_NAME__ / __ASKME_FEED_ID__ / __ASKME_DISPLAY_NAME__
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

from auth_cookie import get_request_cookie
from detail_hints import pick_hints, resolve_detail_url
from http_client import fetch_bytes, fetch_json, fetch_text
from x_access_policy import sleep_between_x_access

SHANGHAI = ZoneInfo("Asia/Shanghai")
BASE_URL = "https://x.com"
API_BASE = "https://api.x.com"
TWEET_RESULT_API = "https://cdn.syndication.twimg.com/tweet-result"
AUTH_SLOT = "x"

SCREEN_NAME = "__ASKME_SCREEN_NAME__"
ENTRY_URL = f"{BASE_URL}/{SCREEN_NAME}"
FEED_ID = "__ASKME_FEED_ID__"
FEED_META = {
    "id": FEED_ID,
    "mpName": "__ASKME_DISPLAY_NAME__",
    "mpCover": "https://abs.twimg.com/favicons/twitter.3.ico",
    "mpIntro": "__ASKME_DISPLAY_NAME__",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 50}

# SCREEN_NAME(lower) -> 已解析 User（支持更名后的有效 screen_name）
_USER_BY_ACCOUNT: dict[str, dict] = {}

_COMMON_HANDLE_SUFFIXES = (
    "space",
    "official",
    "corp",
    "inc",
    "hq",
    "news",
    "app",
    "team",
    "labs",
    "group",
    "global",
)


def _account_screen() -> str:
    """脚手架占位 screen_name（可能是更名前旧 handle）。"""
    return str(SCREEN_NAME or "").strip().lstrip("@")


def _screen() -> str:
    """当前有效 screen_name；若已解析到更名后的 handle 则返回新名。"""
    raw = _account_screen()
    cached = _USER_BY_ACCOUNT.get(raw.lower())
    if isinstance(cached, dict):
        resolved = str(cached.get("screen_name") or "").strip()
        if resolved:
            return resolved
    return raw


def _screen_name_candidates(screen: str) -> list[str]:
    """UserByScreenName 候选：原名 + CamelCase 前缀 + 去常见后缀。"""
    raw = (screen or "").strip().lstrip("@")
    if not raw:
        return []
    out: list[str] = []
    seen: set[str] = set()

    def _add(value: str) -> None:
        text = (value or "").strip().lstrip("@")
        if len(text) < 2:
            return
        key = text.lower()
        if key in seen:
            return
        seen.add(key)
        out.append(text)

    _add(raw)
    parts = re.findall(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+", raw)
    if len(parts) >= 2:
        for i in range(len(parts) - 1, 0, -1):
            _add("".join(parts[:i]))
    lower = raw.lower()
    for suffix in _COMMON_HANDLE_SUFFIXES:
        if lower.endswith(suffix) and len(lower) > len(suffix) + 1:
            _add(raw[: len(raw) - len(suffix)])
    return out


def _entry_url() -> str:
    return f"{BASE_URL}/{_screen()}"


def _syndication_timeline_urls() -> tuple[str, ...]:
    """syndication.twitter.com 常 SSL EOF；优先 syndication.x.com。"""
    screen = _screen()
    return (
        f"https://syndication.x.com/srv/timeline-profile/screen-name/{screen}",
        f"https://syndication.twitter.com/srv/timeline-profile/screen-name/{screen}",
    )


# Nitter 系镜像：只抓主页时间线（不含 /with_replies）
NITTER_MIRRORS = (
    "https://xcancel.com",
    "https://nitter.poast.org",
    "https://nitter.privacyredirect.com",
)

# 公开 Web client bearer；queryId 随前端版本变化（主 ID 取自当前 main.js）
BEARER_TOKEN = (
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs"
    "%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
)
USER_BY_SCREEN_NAME_IDS = (
    "Gb-d6r0vxPOADdG62OEBpQ",
    "sLVLhk0bGj3MVFEKTdax1w",
)
USER_TWEETS_QUERY_IDS = (
    "SXVCYB8XHSS25nzIljNtZA",
    "QWF3SzpHmykQHsQMixG0cg",
    "V7H0Ap3_Hh2FyS75OCDO3Q",
    "q6xj5bs0hapm9309hexA_g",
    "6r5OLCC_wFH4CpRyXKuAmQ",
    "E3opETHurmVJflFsUBVuUQ",
)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

USER_FEATURES = {
    "hidden_profile_subscriptions_enabled": True,
    "profile_label_improvements_pcf_label_in_post_enabled": True,
    "responsive_web_profile_redirect_enabled": True,
    "responsive_web_graphql_exclude_directive_enabled": True,
    "verified_phone_label_enabled": False,
    "subscriptions_verification_info_is_identity_verified_enabled": True,
    "subscriptions_verification_info_verified_since_enabled": True,
    "highlights_tweets_tab_ui_enabled": True,
    "responsive_web_twitter_article_notes_tab_enabled": True,
    "subscriptions_feature_can_gift_premium": True,
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
    "responsive_web_graphql_timeline_navigation_enabled": True,
    "rweb_tipjar_consumption_enabled": True,
}

TIMELINE_FEATURES = {
    "rweb_video_screen_enabled": False,
    "rweb_cashtags_enabled": False,
    "profile_label_improvements_pcf_label_in_post_enabled": True,
    "responsive_web_profile_redirect_enabled": True,
    "rweb_tipjar_consumption_enabled": True,
    "responsive_web_graphql_exclude_directive_enabled": True,
    "verified_phone_label_enabled": False,
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "responsive_web_graphql_timeline_navigation_enabled": True,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
    "premium_content_api_read_enabled": False,
    "communities_web_enable_tweet_community_results_fetch": True,
    "c9s_tweet_anatomy_moderator_badge_enabled": True,
    "responsive_web_grok_analyze_button_fetch_trends_enabled": False,
    "responsive_web_grok_analyze_post_followups_enabled": False,
    "rweb_cashtags_composer_attachment_enabled": False,
    "responsive_web_jetfuel_frame": False,
    "responsive_web_grok_share_attachment_enabled": False,
    "responsive_web_grok_annotations_enabled": False,
    "articles_preview_enabled": True,
    "responsive_web_edit_tweet_api_enabled": True,
    "rweb_conversational_replies_downvote_enabled": False,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
    "view_counts_everywhere_api_enabled": True,
    "longform_notetweets_consumption_enabled": True,
    "responsive_web_twitter_article_tweet_consumption_enabled": True,
    "content_disclosure_indicator_enabled": False,
    "content_disclosure_ai_generated_indicator_enabled": False,
    "responsive_web_grok_show_grok_translated_post": False,
    "responsive_web_grok_analysis_button_from_backend": False,
    "post_ctas_fetch_enabled": False,
    "tweet_awards_web_tipping_enabled": False,
    "creator_subscriptions_quote_tweet_preview_enabled": False,
    "freedom_of_speech_not_reach_fetch_enabled": True,
    "standardized_nudges_misinfo": True,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
    "rweb_video_timestamps_enabled": True,
    "longform_notetweets_rich_text_read_enabled": True,
    "longform_notetweets_inline_media_enabled": True,
    "responsive_web_grok_image_annotation_enabled": False,
    "responsive_web_grok_imagine_annotation_enabled": False,
    "responsive_web_grok_community_note_auto_translation_is_enabled": False,
    "responsive_web_enhance_cards_enabled": False,
}

TIMELINE_FIELD_TOGGLES = {
    "withPayments": False,
    "withAuxiliaryUserLabels": True,
    "withArticleRichContentState": False,
    "withArticlePlainText": False,
    "withArticleSummaryText": False,
    "withArticleVoiceOver": False,
    "withGrokAnalyze": False,
    "withDisallowedReplyControls": False,
}

USER_FIELD_TOGGLES = {
    "withPayments": False,
    "withAuxiliaryUserLabels": True,
}

# 公开样本兜底（无网络数据时）；通用模板为空
FALLBACK_TWEETS: list[dict] = []

_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',
    re.DOTALL,
)
_TIMELINE_ITEM_RE = re.compile(
    r'<div class="timeline-item\s*"[^>]*data-username="([^"]+)"[^>]*>(.*?)'
    r'(?=<div class="timeline-item\s*"|<div class="show-more"|$)',
    re.DOTALL,
)
_STRIP_TAG_RE = re.compile(r"<[^>]+>")
_NITTER_DATE_RE = re.compile(
    r"^([A-Za-z]{3}\s+\d{1,2},\s+\d{4})\s*[·•]\s*(\d{1,2}:\d{2}\s*[AP]M)\s*UTC$",
    re.IGNORECASE,
)


def _request(
    url: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    method: str | None = None,
    retries: int = 1,
) -> bytes:
    base = {
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if headers:
        base.update(headers)
    return fetch_bytes(url, headers=base, data=data, method=method, retries=retries)


def _to_iso_shanghai(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(SHANGHAI).isoformat()
    except ValueError:
        pass
    try:
        return parsedate_to_datetime(raw).astimezone(SHANGHAI).isoformat()
    except (TypeError, ValueError):
        pass
    m = _NITTER_DATE_RE.match(raw)
    if m:
        try:
            dt = datetime.strptime(
                f"{m.group(1)} {m.group(2).upper().replace(' ', '')}",
                "%b %d, %Y %I:%M%p",
            ).replace(tzinfo=timezone.utc)
            return dt.astimezone(SHANGHAI).isoformat()
        except ValueError:
            try:
                dt = datetime.strptime(
                    f"{m.group(1)} {m.group(2)}",
                    "%b %d, %Y %I:%M %p",
                ).replace(tzinfo=timezone.utc)
                return dt.astimezone(SHANGHAI).isoformat()
            except ValueError:
                pass
    return raw


def _strip_html(text: str) -> str:
    return html.unescape(_STRIP_TAG_RE.sub("", text or "")).strip()


def _title_from_text(text: str, *, max_len: int = 100) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return "(media)"
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


def _is_reply_fields(
    *,
    in_reply_to_status_id: object = None,
    in_reply_to_status_id_str: object = None,
    in_reply_to_screen_name: object = None,
    conversation_id_str: object = None,
    tweet_id: object = None,
) -> bool:
    """是否为回复贴（含对他人与对自己线程的后续楼）。"""
    if str(in_reply_to_status_id_str or "").strip():
        return True
    if in_reply_to_status_id not in (None, "", 0, "0"):
        return True
    if str(in_reply_to_screen_name or "").strip():
        return True
    # 会话根帖 conversation_id == id；后续楼/回复不等
    conv = str(conversation_id_str or "").strip()
    tid = str(tweet_id or "").strip()
    if conv and tid and conv != tid:
        return True
    return False


def _has_nested_result(node: object) -> bool:
    if not isinstance(node, dict):
        return False
    result = node.get("result")
    return isinstance(result, dict) and bool(result)


def _is_retweet_or_quote(
    tweet: dict,
    legacy: dict,
    *,
    text: str = "",
) -> bool:
    """转推 / 引用转发（只要用户原创主帖）。"""
    if _has_nested_result(legacy.get("retweeted_status_result")):
        return True
    if _has_nested_result(tweet.get("retweeted_status_result")):
        return True
    if isinstance(legacy.get("retweeted_status"), dict):
        return True
    if legacy.get("is_quote_status") in (True, 1, "true", "True"):
        return True
    if _has_nested_result(tweet.get("quoted_status_result")):
        return True
    if isinstance(legacy.get("quoted_status"), dict):
        return True
    stripped = (text or "").lstrip()
    if stripped.upper().startswith("RT @"):
        return True
    return False


def _item_not_original_post(item: dict) -> bool:
    """列表最终闸门：回复 / RT / QT 一律排除。"""
    if str(item.get("reply_to") or "").strip():
        return True
    if str(item.get("quote_user") or "").strip() or str(item.get("quote_text") or "").strip():
        return True
    for key in ("summary", "text", "title", "raw_text"):
        text = str(item.get(key) or "").lstrip()
        lower = text.lower()
        if lower.startswith("replying to"):
            return True
        if text.upper().startswith("RT @"):
            return True
        if lower.startswith("qt @") or lower.startswith("qt:"):
            return True
        # compose 后常见 "正文 QT @user: …" / 多段 "\nQT:"
        if " qt @" in lower or " qt:" in lower or "\nqt @" in lower or "\nqt:" in lower:
            return True
    return False


def _compose_body(
    text: str,
    *,
    reply_to: str = "",
    quote_user: str = "",
    quote_text: str = "",
) -> str:
    """拼接正文；列表阶段已丢弃回复/RT/QT，通常只剩原文。"""
    parts: list[str] = []
    reply_to = (reply_to or "").lstrip("@").strip()
    quote_user = (quote_user or "").lstrip("@").strip()
    text = (text or "").strip()
    quote_text = (quote_text or "").strip()
    if reply_to:
        parts.append(f"Replying to @{reply_to}")
    if text:
        parts.append(text)
    if quote_user or quote_text:
        head = f"QT @{quote_user}" if quote_user else "QT"
        parts.append(f"{head}: {quote_text}" if quote_text else head)
    return "\n\n".join(parts).strip()


def _media_image(entities: dict | None) -> str:
    if not isinstance(entities, dict):
        return ""
    media = entities.get("media")
    if not isinstance(media, list) or not media:
        return ""
    first = media[0] if isinstance(media[0], dict) else {}
    return str(
        first.get("media_url_https")
        or first.get("media_url")
        or first.get("expanded_url")
        or ""
    )


def _user_core_fields(user: object) -> tuple[str, str]:
    """GraphQL User：name/screen_name 已迁到 core，legacy 里可能为空。"""
    if not isinstance(user, dict):
        return "", ""
    core = user.get("core") if isinstance(user.get("core"), dict) else {}
    legacy = user.get("legacy") if isinstance(user.get("legacy"), dict) else {}
    name = str(core.get("name") or legacy.get("name") or "").strip()
    screen = str(core.get("screen_name") or legacy.get("screen_name") or "").strip()
    return name, screen


def _timeline_bottom_cursor(data: dict) -> str:
    result = ((data.get("data") or {}).get("user") or {}).get("result") or {}
    timeline = ((result.get("timeline_v2") or result.get("timeline") or {}).get("timeline")) or {}
    for inst in timeline.get("instructions") or []:
        if not isinstance(inst, dict):
            continue
        entries = inst.get("entries")
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            content = entry.get("content") if isinstance(entry.get("content"), dict) else {}
            entry_id = str(entry.get("entryId") or "")
            if content.get("cursorType") == "Bottom" or entry_id.startswith("cursor-bottom"):
                return str(content.get("value") or "").strip()
    return ""


def _cookie_pairs(cookie: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in (cookie or "").split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        key = name.strip()
        val = value.strip()
        if key and val:
            out[key] = val
    return out


def _require_x_cookie() -> str:
    cookie = get_request_cookie(AUTH_SLOT).strip()
    if not cookie:
        raise ValueError(
            "ASKME_AUTH_REQUIRED:slot=x 未配置 X Cookie。"
            "请在设置页登录 x.com 后保存含 auth_token 与 ct0 的凭证。"
        )
    pairs = _cookie_pairs(cookie)
    if not pairs.get("auth_token") or not pairs.get("ct0"):
        raise ValueError(
            "ASKME_AUTH_REQUIRED:slot=x Cookie 缺少 auth_token 或 ct0（访客态无效）。"
            "请重新登录 x.com 后粘贴完整 Cookie。"
        )
    return cookie


def _session_headers(*, referer: str = "") -> dict[str, str]:
    cookie = _require_x_cookie()
    ct0 = _cookie_pairs(cookie)["ct0"]
    return {
        "Authorization": f"Bearer {BEARER_TOKEN}",
        "Cookie": cookie,
        "x-csrf-token": ct0,
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        "x-twitter-client-language": "en",
        "content-type": "application/json",
        "Referer": referer or _entry_url(),
    }


def _graphql(
    query_id: str,
    operation: str,
    variables: dict,
    features: dict,
    *,
    referer: str = "",
    field_toggles: dict | None = None,
    retries: int = 2,
) -> dict:
    params: dict[str, str] = {
        "variables": json.dumps(variables, separators=(",", ":")),
        "features": json.dumps(features, separators=(",", ":")),
    }
    if field_toggles:
        params["fieldToggles"] = json.dumps(field_toggles, separators=(",", ":"))
    query = urllib.parse.urlencode(params)
    url = f"{API_BASE}/graphql/{query_id}/{operation}?{query}"
    body = _request(url, headers=_session_headers(referer=referer), retries=retries)
    data = json.loads(body.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{operation} 响应非对象")
    return data


def _resolve_user() -> dict:
    """解析用户；旧 handle 更名后尝试 CamelCase 前缀等候选（如 RedwireSpace→Redwire）。"""
    account_key = _account_screen()
    cache_key = account_key.lower()
    cached = _USER_BY_ACCOUNT.get(cache_key)
    if isinstance(cached, dict) and str(cached.get("rest_id") or "").strip():
        return cached

    last_err: Exception | None = None
    saw_missing_user = False
    candidates = _screen_name_candidates(account_key)
    for cand_idx, candidate in enumerate(candidates):
        if cand_idx > 0:
            sleep_between_x_access()
        for query_id in USER_BY_SCREEN_NAME_IDS:
            try:
                data = _graphql(
                    query_id,
                    "UserByScreenName",
                    {"screen_name": candidate, "withSafetyModeUserFields": True},
                    USER_FEATURES,
                    field_toggles=USER_FIELD_TOGGLES,
                    retries=2,
                )
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                if isinstance(exc, urllib.error.HTTPError) and exc.code == 429:
                    raise
                sleep_between_x_access()
                continue
            user_node = (data.get("data") or {}).get("user")
            result = (user_node or {}).get("result") or {} if isinstance(user_node, dict) else {}
            rest_id = str(result.get("rest_id") or "").strip()
            typename = str(result.get("__typename") or "")
            if not rest_id:
                if not user_node or typename in ("", "UserUnavailable"):
                    saw_missing_user = True
                continue
            legacy = result.get("legacy") if isinstance(result.get("legacy"), dict) else {}
            name, screen = _user_core_fields(result)
            avatar = str(
                legacy.get("profile_image_url_https")
                or (
                    (result.get("avatar") or {}).get("image_url")
                    if isinstance(result.get("avatar"), dict)
                    else ""
                )
                or ""
            )
            resolved_screen = screen or candidate or account_key
            user = {
                "rest_id": rest_id,
                "name": name or resolved_screen,
                "screen_name": resolved_screen,
                "avatar": avatar,
                "description": str(legacy.get("description") or ""),
                "requested_screen_name": account_key,
            }
            _USER_BY_ACCOUNT[cache_key] = user
            return user
    if saw_missing_user:
        raise ValueError(f"X 账号 @{account_key} 不存在或已停用")
    if last_err:
        raise last_err
    raise ValueError(f"X 账号 @{account_key} 不存在或已停用")


def _graphql_tweet_text(tweet: dict, legacy: dict) -> str:
    """优先 note_tweet 长文，再 fallback legacy.full_text。"""
    note = tweet.get("note_tweet") if isinstance(tweet.get("note_tweet"), dict) else {}
    note_result = note.get("note_tweet_results") if isinstance(note.get("note_tweet_results"), dict) else {}
    nested = note_result.get("result") if isinstance(note_result.get("result"), dict) else {}
    if not nested and isinstance(note.get("result"), dict):
        nested = note.get("result") or {}
    long_text = str(nested.get("text") or "").strip()
    if long_text:
        return long_text
    return str(legacy.get("full_text") or legacy.get("text") or "").strip()


def _unwrap_tweet_result(item: dict) -> dict:
    if not isinstance(item, dict):
        return {}
    if item.get("__typename") == "TweetWithVisibilityResults":
        nested = item.get("tweet")
        return nested if isinstance(nested, dict) else {}
    return item


def _quote_from_graphql(tweet: dict) -> tuple[str, str]:
    qsr = tweet.get("quoted_status_result")
    if not isinstance(qsr, dict):
        return "", ""
    quoted = _unwrap_tweet_result(qsr.get("result") or {})
    if not quoted:
        return "", ""
    qleg = quoted.get("legacy") if isinstance(quoted.get("legacy"), dict) else {}
    quser = ((quoted.get("core") or {}).get("user_results") or {}).get("result") or {}
    _qname, qscreen = _user_core_fields(quser)
    return (
        qscreen,
        str(qleg.get("full_text") or qleg.get("text") or "").strip(),
    )


def _tweet_from_graphql(item: dict) -> dict | None:
    tweet = _unwrap_tweet_result(item)
    legacy = tweet.get("legacy") if isinstance(tweet.get("legacy"), dict) else {}
    tweet_id = str(legacy.get("id_str") or tweet.get("rest_id") or "").strip()
    if not tweet_id:
        return None
    text = _graphql_tweet_text(tweet, legacy)
    user = ((tweet.get("core") or {}).get("user_results") or {}).get("result") or {}
    name, screen = _user_core_fields(user)
    author = name or _screen()
    screen = screen or _screen()
    # 仅保留目标账号原创主帖；跳过回复 / RT / QT 与他人推文
    if screen.lower() != _screen().lower():
        return None
    if _is_reply_fields(
        in_reply_to_status_id=legacy.get("in_reply_to_status_id"),
        in_reply_to_status_id_str=legacy.get("in_reply_to_status_id_str"),
        in_reply_to_screen_name=legacy.get("in_reply_to_screen_name"),
        conversation_id_str=legacy.get("conversation_id_str"),
        tweet_id=tweet_id,
    ):
        return None
    if _is_retweet_or_quote(tweet, legacy, text=text):
        return None
    reply_to = ""
    quote_user, quote_text = "", ""
    body = _compose_body(text, reply_to=reply_to, quote_user=quote_user, quote_text=quote_text)
    url = f"{BASE_URL}/{screen}/status/{tweet_id}"
    created = str(
        legacy.get("created_at")
        or tweet.get("created_at")
        or ((tweet.get("legacy") or {}) if isinstance(tweet.get("legacy"), dict) else {}).get("created_at")
        or ""
    )
    return {
        "id": tweet_id,
        "title": _title_from_text(body),
        "url": url,
        "published_at": _to_iso_shanghai(created),
        "author": author,
        "image": _media_image(legacy.get("entities") if isinstance(legacy.get("entities"), dict) else {}),
        "summary": body,
        "text": body,
        "raw_text": text,
        "reply_to": reply_to,
        "quote_user": quote_user,
        "quote_text": quote_text,
    }


def _iter_timeline_tweet_results(entry: dict) -> list[dict]:
    """从 timeline 条目提取 tweet results。"""
    content = entry.get("content") or {}
    results: list[dict] = []
    single = ((content.get("itemContent") or {}).get("tweet_results") or {}).get("result")
    if isinstance(single, dict):
        results.append(single)
    for sub in content.get("items") or []:
        if not isinstance(sub, dict):
            continue
        item = sub.get("item") or sub
        ic = item.get("itemContent") if isinstance(item, dict) else {}
        if not isinstance(ic, dict):
            continue
        nested = (ic.get("tweet_results") or {}).get("result")
        if isinstance(nested, dict):
            results.append(nested)
    return results


def _parse_user_tweets(data: dict) -> list[dict]:
    result = ((data.get("data") or {}).get("user") or {}).get("result") or {}
    timeline = ((result.get("timeline_v2") or result.get("timeline") or {}).get("timeline")) or {}
    instructions = timeline.get("instructions") or []
    tweets: list[dict] = []
    seen: set[str] = set()
    for inst in instructions:
        if not isinstance(inst, dict):
            continue
        if inst.get("type") not in ("TimelineAddEntries", "TimelinePinEntry"):
            continue
        entries = inst.get("entries")
        if inst.get("type") == "TimelinePinEntry":
            entry = inst.get("entry")
            entries = [entry] if isinstance(entry, dict) else []
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            entry_id = str(entry.get("entryId") or "")
            # tweet-* 单帖；profile-conversation-* 为自建 thread（根帖原创，后续楼由 reply 字段过滤）
            if not (
                entry_id.startswith("tweet-")
                or entry_id.startswith("profile-conversation-")
            ):
                continue
            for raw in _iter_timeline_tweet_results(entry):
                item = _tweet_from_graphql(raw)
                if item is None or item["id"] in seen:
                    continue
                seen.add(item["id"])
                tweets.append(item)
    tweets.sort(key=lambda x: x.get("published_at") or "", reverse=True)
    return tweets


def _fetch_graphql_operation(
    operation: str,
    query_ids: tuple[str, ...],
    count: int = 40,
    *,
    soft: bool = False,
) -> list[dict]:
    user = _resolve_user()
    if user.get("avatar"):
        FEED_META["mpCover"] = user["avatar"].replace("_normal.", "_bigger.")
    if user.get("name"):
        FEED_META["mpIntro"] = f"X · {user['name']} (@{user['screen_name']})"
    last_err: Exception | None = None
    # soft 模式只试第一个 queryId，避免过期 id 拖慢
    ids = query_ids[:1] if soft else query_ids
    referer = _entry_url()
    # 原创过滤后首页可能为空（大量 RT/QT）；用 Bottom cursor 多翻几页
    max_pages = 1 if soft else 5
    want = max(5, min(int(count), 40))
    for query_id in ids:
        collected: list[dict] = []
        cursor = ""
        try:
            for page_idx in range(max_pages):
                variables = {
                    "userId": user["rest_id"],
                    "count": want,
                    "includePromotedContent": True,
                    "withQuickPromoteEligibilityTweetFields": True,
                    "withVoice": True,
                    "withV2Timeline": True,
                }
                if cursor:
                    variables["cursor"] = cursor
                params = {
                    "variables": json.dumps(variables, separators=(",", ":")),
                    "features": json.dumps(TIMELINE_FEATURES, separators=(",", ":")),
                    "fieldToggles": json.dumps(TIMELINE_FIELD_TOGGLES, separators=(",", ":")),
                }
                query = urllib.parse.urlencode(params)
                url = f"{API_BASE}/graphql/{query_id}/{operation}?{query}"
                body = _request(
                    url,
                    headers=_session_headers(referer=referer),
                    # 0：429 立刻交给 FxEmbed/syndication，避免 http_client 长退避卡住
                    retries=0,
                )
                data = json.loads(body.decode("utf-8"))
                if not isinstance(data, dict):
                    break
                if data.get("errors"):
                    # queryId 过期等：换下一个 id；不要空耗 cursor
                    break
                tweets = _parse_user_tweets(data)
                if tweets:
                    collected = _merge_tweets(collected, tweets)
                if len(collected) >= want:
                    return collected
                next_cursor = _timeline_bottom_cursor(data)
                if not next_cursor or next_cursor == cursor:
                    break
                cursor = next_cursor
                if page_idx + 1 < max_pages:
                    sleep_between_x_access()
            if collected:
                return collected
        except urllib.error.HTTPError as exc:
            last_err = exc
            # 429：立刻放弃其余 queryId，交给 syndication / Nitter，避免连刷
            if exc.code == 429:
                break
            continue
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            continue
    if last_err and not soft:
        raise last_err
    return []


def _fetch_graphql_tweets(count: int = 40) -> list[dict]:
    # 只抓主帖时间线（不含回复）；UserTweets 失败时再试一次 soft
    tweets = _fetch_graphql_operation(
        "UserTweets", USER_TWEETS_QUERY_IDS, count=count
    )
    if tweets:
        return tweets
    return _fetch_graphql_operation(
        "UserTweets", USER_TWEETS_QUERY_IDS, count=count, soft=True
    )


def _tweet_from_syndication(raw: dict) -> dict | None:
    tweet_id = str(raw.get("id_str") or "").strip()
    if not tweet_id:
        return None
    text = str(raw.get("full_text") or raw.get("text") or "").strip()
    user = raw.get("user") if isinstance(raw.get("user"), dict) else {}
    author = str(user.get("name") or _screen()).strip() or _screen()
    screen = str(user.get("screen_name") or _screen()).strip() or _screen()
    if screen.lower() != _screen().lower():
        return None
    if _is_reply_fields(
        in_reply_to_status_id=raw.get("in_reply_to_status_id"),
        in_reply_to_status_id_str=raw.get("in_reply_to_status_id_str"),
        in_reply_to_screen_name=raw.get("in_reply_to_screen_name"),
        conversation_id_str=raw.get("conversation_id_str"),
        tweet_id=tweet_id,
    ):
        return None
    if isinstance(raw.get("retweeted_status"), dict) or raw.get("is_quote_status") in (
        True,
        1,
        "true",
        "True",
    ):
        return None
    if isinstance(raw.get("quoted_status"), dict):
        return None
    if text.lstrip().upper().startswith("RT @"):
        return None
    reply_to = ""
    quote_user = ""
    quote_text = ""
    body = _compose_body(text, reply_to=reply_to, quote_user=quote_user, quote_text=quote_text)
    permalink = str(raw.get("permalink") or f"/{screen}/status/{tweet_id}")
    if permalink.startswith("http://") or permalink.startswith("https://"):
        url = permalink
    else:
        url = f"{BASE_URL}{permalink if permalink.startswith('/') else '/' + permalink}"
    # 统一成 https://x.com/{screen}/status/{id}，避免相对路径 / 错误 host
    if "/status/" in url:
        url = f"{BASE_URL}/{screen}/status/{tweet_id}"
    return {
        "id": tweet_id,
        "title": _title_from_text(body),
        "url": url,
        "published_at": _to_iso_shanghai(str(raw.get("created_at") or "")),
        "author": author,
        "image": _media_image(raw.get("entities") if isinstance(raw.get("entities"), dict) else {}),
        "summary": body,
        "text": body,
        "raw_text": text,
        "reply_to": reply_to,
        "quote_user": quote_user,
        "quote_text": quote_text,
    }


def _fetch_syndication_tweets() -> list[dict]:
    last_err: Exception | None = None
    page_html = ""
    for url in _syndication_timeline_urls():
        try:
            body = _request(
                url,
                headers={"Referer": _entry_url(), "Accept": "text/html,application/xhtml+xml"},
                retries=2,
            )
            page_html = body.decode("utf-8", "ignore")
            if _NEXT_DATA_RE.search(page_html):
                break
            page_html = ""
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            page_html = ""
            continue
    if not page_html:
        if last_err:
            raise last_err
        raise ValueError("syndication 页面缺少 __NEXT_DATA__")
    match = _NEXT_DATA_RE.search(page_html)
    if not match:
        raise ValueError("syndication 页面缺少 __NEXT_DATA__")
    data = json.loads(match.group(1))
    entries = (
        ((data.get("props") or {}).get("pageProps") or {})
        .get("timeline", {})
        .get("entries")
        or []
    )
    tweets: list[dict] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        content = entry.get("content") or {}
        raw = content.get("tweet") if isinstance(content, dict) else None
        if not isinstance(raw, dict):
            continue
        item = _tweet_from_syndication(raw)
        if item is None or item["id"] in seen:
            continue
        seen.add(item["id"])
        tweets.append(item)
    tweets.sort(key=lambda x: x.get("published_at") or "", reverse=True)
    return tweets


def _parse_nitter_item(username: str, body: str) -> dict | None:
    if username.lower() != _screen().lower():
        return None
    if re.search(r'class="retweet-header"', body[:600]):
        return None
    sid_m = re.search(rf'/{re.escape(_screen())}/status/(\d+)', body)
    if not sid_m:
        return None
    tweet_id = sid_m.group(1)
    content_m = re.search(r'class="tweet-content[^"]*"[^>]*>(.*?)</div>', body, re.DOTALL)
    text = _strip_html(content_m.group(1)) if content_m else ""
    # Nitter：回复 / 引用块一律跳过
    if re.search(r'class="replying-to"', body):
        return None
    if re.search(r'<div class="quote[^"]*">', body):
        return None
    if text.lstrip().upper().startswith("RT @"):
        return None
    quote_user = ""
    quote_text = ""
    date_m = re.search(
        rf'/{re.escape(_screen())}/status/{tweet_id}[^"]*"[^>]*title="([^"]+)"',
        body,
    )
    if not date_m:
        date_m = re.search(r'title="([A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s*[·•][^"]+UTC)"', body)
    published = _to_iso_shanghai(date_m.group(1).strip() if date_m else "")
    name_m = re.search(r'class="fullname"[^>]*title="([^"]+)"', body)
    author = (name_m.group(1).strip() if name_m else _screen()) or _screen()
    img_m = re.search(r'class="attachment[^"]*".*?<img[^>]+src="([^"]+)"', body, re.DOTALL)
    image = img_m.group(1) if img_m else ""
    composed = _compose_body(text, quote_user=quote_user, quote_text=quote_text)
    return {
        "id": tweet_id,
        "title": _title_from_text(composed),
        "url": f"{BASE_URL}/{_screen()}/status/{tweet_id}",
        "published_at": published,
        "author": author,
        "image": image,
        "summary": composed,
        "text": composed,
        "raw_text": text,
        "reply_to": "",
        "quote_user": quote_user,
        "quote_text": quote_text,
    }


def _fetch_nitter_page(mirror: str, path: str) -> list[dict]:
    url = f"{mirror.rstrip('/')}{path}"
    body = _request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "Referer": f"{mirror.rstrip('/')}/",
        },
        retries=1,
    )
    page = body.decode("utf-8", "ignore")
    tweets: list[dict] = []
    seen: set[str] = set()
    for match in _TIMELINE_ITEM_RE.finditer(page):
        item = _parse_nitter_item(match.group(1), match.group(2))
        if item is None or item["id"] in seen:
            continue
        seen.add(item["id"])
        tweets.append(item)
    return tweets


def _fetch_nitter_tweets() -> list[dict]:
    """从 Nitter 镜像拉主页时间线（不含 /with_replies）。"""
    last_err: Exception | None = None
    for mirror in NITTER_MIRRORS:
        try:
            collected = _fetch_nitter_page(mirror, f"/{_screen()}")
            if collected:
                return collected
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            continue
    if last_err:
        raise last_err
    return []


def _merge_tweets(*groups: list[dict]) -> list[dict]:
    seen: set[str] = set()
    merged: list[dict] = []
    for group in groups:
        for item in group:
            tweet_id = str(item.get("id") or "").strip()
            if not tweet_id or tweet_id in seen:
                continue
            seen.add(tweet_id)
            merged.append(item)
    merged.sort(key=lambda x: x.get("published_at") or "", reverse=True)
    return merged


def _fxtwitter_media_image(media: object) -> str:
    if not isinstance(media, dict):
        return ""
    photos = media.get("photos")
    if isinstance(photos, list) and photos:
        first = photos[0] if isinstance(photos[0], dict) else {}
        return str(first.get("url") or first.get("thumbnail_url") or "").strip()
    videos = media.get("videos")
    if isinstance(videos, list) and videos:
        first = videos[0] if isinstance(videos[0], dict) else {}
        return str(first.get("thumbnail_url") or first.get("url") or "").strip()
    return str(media.get("url") or "").strip()


def _tweet_from_fxtwitter(raw: dict) -> dict | None:
    """FxEmbed 公开时间线条目 → 原创主帖。"""
    if not isinstance(raw, dict):
        return None
    if str(raw.get("type") or "status").lower() not in ("status", "tweet", ""):
        return None
    author = raw.get("author") if isinstance(raw.get("author"), dict) else {}
    screen = str(author.get("screen_name") or "").strip()
    if screen.lower() != _screen().lower():
        return None
    # 跳过转推 / 回复
    if raw.get("reposted_by") not in (None, "", {}, []):
        return None
    if raw.get("replying_to") not in (None, "", {}, []):
        return None
    tweet_id = str(raw.get("id") or "").strip()
    if not tweet_id:
        return None
    text = str(raw.get("text") or "").strip()
    if text.lstrip().upper().startswith("RT @"):
        return None
    body = _compose_body(text)
    url = str(raw.get("url") or "").strip() or f"{BASE_URL}/{screen}/status/{tweet_id}"
    if "/status/" in url:
        url = f"{BASE_URL}/{screen}/status/{tweet_id}"
    created = str(raw.get("created_at") or "").strip()
    if not created and raw.get("created_timestamp") not in (None, ""):
        try:
            created = datetime.fromtimestamp(int(raw["created_timestamp"]), tz=timezone.utc).isoformat()
        except (TypeError, ValueError, OSError):
            created = ""
    return {
        "id": tweet_id,
        "title": _title_from_text(body),
        "url": url,
        "published_at": _to_iso_shanghai(created),
        "author": str(author.get("name") or screen).strip() or screen,
        "image": _fxtwitter_media_image(raw.get("media")),
        "summary": body,
        "text": body,
        "raw_text": text,
        "reply_to": "",
        "quote_user": "",
        "quote_text": "",
    }


def _fetch_fxtwitter_tweets(count: int = 40) -> list[dict]:
    """FxEmbed / api.fxtwitter.com 公开 profile statuses（无 Cookie 依赖，作 GraphQL 兜底）。"""
    want = max(5, min(int(count), 40))
    collected: list[dict] = []
    seen: set[str] = set()
    cursor = ""
    last_err: Exception | None = None
    for _ in range(3):
        query = {"count": str(min(want, 20))}
        if cursor:
            query["cursor"] = cursor
        url = (
            f"https://api.fxtwitter.com/2/profile/{urllib.parse.quote(_screen())}/statuses"
            f"?{urllib.parse.urlencode(query)}"
        )
        try:
            body = _request(
                url,
                headers={
                    "Accept": "application/json",
                    "Referer": _entry_url(),
                },
                retries=1,
            )
            data = json.loads(body.decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            break
        if not isinstance(data, dict):
            break
        results = data.get("results")
        if not isinstance(results, list):
            break
        for raw in results:
            item = _tweet_from_fxtwitter(raw) if isinstance(raw, dict) else None
            if item is None or item["id"] in seen:
                continue
            seen.add(item["id"])
            collected.append(item)
        if len(collected) >= want:
            break
        bottom = ""
        cur = data.get("cursor")
        if isinstance(cur, dict):
            bottom = str(cur.get("bottom") or "").strip()
        if not bottom or bottom == cursor:
            break
        cursor = bottom
        sleep_between_x_access()
    collected.sort(key=lambda x: x.get("published_at") or "", reverse=True)
    if collected:
        return collected
    if last_err:
        raise last_err
    return []


def _all_tweets() -> list[dict]:
    # 缺 Cookie 立刻要求授权（不静默走公开镜像）
    _require_x_cookie()
    collected: list[dict] = []
    errors: list[str] = []
    # GraphQL → FxEmbed → syndication → Nitter；任一路有原创即够用
    for fetcher in (
        _fetch_graphql_tweets,
        _fetch_fxtwitter_tweets,
        _fetch_syndication_tweets,
        _fetch_nitter_tweets,
    ):
        try:
            tweets = fetcher()
            if tweets:
                collected = _merge_tweets(collected, tweets)
                if len(collected) >= 5:
                    break
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{fetcher.__name__}: {exc}")
            # 不因 GraphQL「不存在」提前中断：旧 handle 更名后其它源仍可能成功
            continue
    collected = [item for item in collected if not _item_not_original_post(item)]
    if collected:
        return collected
    fallback = [
        dict(item)
        for item in FALLBACK_TWEETS
        if not _item_not_original_post(item)
    ]
    if fallback:
        return fallback
    label = _account_screen() or _screen()
    user_missing = any("不存在" in e or "无法解析用户" in e or "已停用" in e for e in errors)
    if user_missing:
        raise ValueError(f"X 账号 @{label} 不存在，请检查链接是否正确。")
    detail = "; ".join(errors[:3]) if errors else "各源均返回空时间线"
    raise ValueError(
        f"@{label} 时间线无原创主帖。{detail}。"
        "若账号仅有回复/转推或已清空发帖，无法接入；否则请稍后重试。"
    )


def fetch_list_page(page: int = 1, per: int = 20) -> dict:
    page = max(1, int(page or 1))
    per = max(1, min(int(per or 20), 50))
    tweets = _all_tweets()
    start = (page - 1) * per
    end = start + per
    return {
        "items": tweets[start:end],
        "page": page,
        "per": per,
        "total": len(tweets),
    }


def list_items(payload: dict) -> list[dict]:
    items = payload.get("items")
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict) and not _item_not_original_post(item)]


def has_next_page(payload: dict) -> bool:
    page = int(payload.get("page") or 1)
    per = int(payload.get("per") or 20)
    total = int(payload.get("total") or 0)
    return page * per < total


def normalize_list_item(item: dict) -> dict:
    tweet_id = str(item.get("id") or "").strip()
    text = str(item.get("text") or item.get("summary") or "").strip()
    title = str(item.get("title") or "").strip() or _title_from_text(text)
    url = str(item.get("url") or "").strip()
    if not url and tweet_id:
        url = f"{BASE_URL}/{_screen()}/status/{tweet_id}"
    return {
        "id": tweet_id,
        "title": title,
        "url": url,
        "published_at": _to_iso_shanghai(str(item.get("published_at") or "")),
        "author": str(item.get("author") or _screen()).strip(),
        "image": str(item.get("image") or ""),
        "summary": text,
    }


def _fetch_tweet_result(tweet_id: str) -> dict | None:
    query = urllib.parse.urlencode({"id": tweet_id, "lang": "en", "token": "0"})
    url = f"{TWEET_RESULT_API}?{query}"
    try:
        body = _request(
            url,
            headers={"Referer": "https://platform.twitter.com/", "Accept": "application/json"},
        )
        data = json.loads(body.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict) or not data.get("id_str"):
        return None
    return data


def _content_html(
    text: str,
    *,
    url: str,
    author: str,
    reply_to: str = "",
    quote_user: str = "",
    quote_text: str = "",
) -> str:
    parts: list[str] = []
    reply_to = (reply_to or "").lstrip("@").strip()
    if reply_to:
        parts.append(f"<p><em>Replying to @{html.escape(reply_to)}</em></p>")
    body = (text or "").strip()
    if body:
        for para in body.split("\n\n"):
            para = para.strip()
            if para:
                parts.append(f"<p>{html.escape(para)}</p>")
    else:
        parts.append("<p>(media-only post)</p>")
    quote_user = (quote_user or "").lstrip("@").strip()
    quote_text = (quote_text or "").strip()
    if quote_user or quote_text:
        q_label = f"@{html.escape(quote_user)}" if quote_user else "quoted"
        parts.append(
            "<blockquote>"
            f"<p><strong>QT {q_label}</strong></p>"
            f"<p>{html.escape(quote_text) if quote_text else '(media)'}</p>"
            "</blockquote>"
        )
    meta = f"{html.escape(author)} · <a href=\"{html.escape(url)}\">{html.escape(url)}</a>"
    parts.append(f"<p>{meta}</p>")
    return "<article>" + "".join(parts) + "</article>"


def fetch_article_detail(article_id: str, **hints) -> dict:
    tweet_id = str(article_id or "").strip()
    if not tweet_id:
        raise ValueError("缺少 tweet id")

    meta = pick_hints(**hints)
    hint_url = resolve_detail_url(tweet_id, **hints) or meta.get("url") or ""

    remote = _fetch_tweet_result(tweet_id)
    if remote:
        text = str(remote.get("text") or remote.get("full_text") or "").strip()
        user = remote.get("user") if isinstance(remote.get("user"), dict) else {}
        author = str(user.get("name") or meta.get("author") or _screen()).strip() or _screen()
        screen = str(user.get("screen_name") or _screen()).strip() or _screen()
        url = hint_url or f"{BASE_URL}/{screen}/status/{tweet_id}"
        reply_to = str(remote.get("in_reply_to_screen_name") or "").strip()
        parent = remote.get("parent") if isinstance(remote.get("parent"), dict) else {}
        if not reply_to and parent:
            puser = parent.get("user") if isinstance(parent.get("user"), dict) else {}
            reply_to = str(puser.get("screen_name") or "").strip()
        quote_user = ""
        quote_text = ""
        quoted = remote.get("quoted_tweet") if isinstance(remote.get("quoted_tweet"), dict) else {}
        if quoted:
            quser = quoted.get("user") if isinstance(quoted.get("user"), dict) else {}
            quote_user = str(quser.get("screen_name") or "").strip()
            quote_text = str(quoted.get("text") or quoted.get("full_text") or "").strip()
        display = text
        return {
            "id": tweet_id,
            "title": meta.get("title")
            or _title_from_text(
                _compose_body(text, reply_to=reply_to, quote_user=quote_user, quote_text=quote_text)
            ),
            "url": url,
            "author": author,
            "published_at": _to_iso_shanghai(
                str(remote.get("created_at") or meta.get("published_at") or "")
            ),
            "image": _media_image(
                remote.get("entities") if isinstance(remote.get("entities"), dict) else {}
            )
            or meta.get("image")
            or "",
            "content_html": _content_html(
                display,
                url=url,
                author=author,
                reply_to=reply_to,
                quote_user=quote_user,
                quote_text=quote_text,
            ),
        }

    # 已有列表 hints 时禁止再扫整表
    text = str(meta.get("summary") or meta.get("title") or "").strip()
    if hint_url or text:
        url = hint_url or f"{BASE_URL}/{_screen()}/status/{tweet_id}"
        author = str(meta.get("author") or _screen()).strip() or _screen()
        return {
            "id": tweet_id,
            "title": meta.get("title") or _title_from_text(text),
            "url": url,
            "author": author,
            "published_at": _to_iso_shanghai(str(meta.get("published_at") or "")),
            "image": meta.get("image") or "",
            "content_html": _content_html(text or "(media-only post)", url=url, author=author),
        }

    for item in _all_tweets():
        if str(item.get("id")) == tweet_id:
            raw_text = str(item.get("raw_text") or item.get("text") or item.get("summary") or "")
            reply_to = str(item.get("reply_to") or "")
            quote_user = str(item.get("quote_user") or "")
            quote_text = str(item.get("quote_text") or "")
            url = str(item.get("url") or f"{BASE_URL}/{_screen()}/status/{tweet_id}")
            author = str(item.get("author") or _screen())
            return {
                "id": tweet_id,
                "title": str(item.get("title") or _title_from_text(raw_text)),
                "url": url,
                "author": author,
                "published_at": _to_iso_shanghai(str(item.get("published_at") or "")),
                "image": str(item.get("image") or ""),
                "content_html": _content_html(
                    raw_text,
                    url=url,
                    author=author,
                    reply_to=reply_to,
                    quote_user=quote_user,
                    quote_text=quote_text,
                ),
            }

    raise ValueError(f"未找到推文: {tweet_id}")


def main() -> int:
    parser = argparse.ArgumentParser(description="发现 X 推文")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--per", type=int, default=20)
    parser.add_argument("--id", type=str, default="")
    args = parser.parse_args()
    try:
        if args.id:
            output = fetch_article_detail(args.id)
        else:
            payload = fetch_list_page(page=args.page, per=args.per)
            output = {
                "articles": [normalize_list_item(item) for item in list_items(payload)],
                "has_next_page": has_next_page(payload),
            }
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **output}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
