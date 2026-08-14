#!/usr/bin/env python3
"""X (Twitter) 发现层适配器 — GraphQL guest + Nitter 镜像（含引用/回复）+ syndication 兜底。"""

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

from http_client import fetch_bytes, fetch_json, fetch_text, sleep_between_pages

SHANGHAI = ZoneInfo("Asia/Shanghai")
SCREEN_NAME = "elonmusk"
BASE_URL = "https://x.com"
ENTRY_URL = f"{BASE_URL}/{SCREEN_NAME}"
API_BASE = "https://api.x.com"
SYNDICATION_TIMELINE = (
    f"https://syndication.twitter.com/srv/timeline-profile/screen-name/{SCREEN_NAME}"
)
TWEET_RESULT_API = "https://cdn.syndication.twimg.com/tweet-result"

# Nitter 系镜像：主时间线含对他人帖子的引用（quote）；with_replies 部分镜像可用
NITTER_MIRRORS = (
    "https://xcancel.com",
    "https://nitter.poast.org",
    "https://nitter.privacyredirect.com",
)

# 公开 Web client bearer（guest 激活用）；queryId 随前端版本可能变化
BEARER_TOKEN = (
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs"
    "%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
)
USER_BY_SCREEN_NAME_ID = "sLVLhk0bGj3MVFEKTdax1w"
USER_TWEETS_QUERY_IDS = (
    "6r5OLCC_wFH4CpRyXKuAmQ",
    "E3opETHurmVJflFsUBVuUQ",
    "HuTx3Meb4alJIJadoiNf1A",
    "V1ze5v3EAAi3RqJTUn70jg",
)
USER_TWEETS_AND_REPLIES_QUERY_IDS = (
    "klja8a2iJX_3to5RdfVlgw",
    "bt4T-SV0ZcekopsKbmUU8w",
    "CdG2Vuc1KJLWVS6ZLwlIYQ",
)

FEED_ID = "website:x"
FEED_META = {
    "id": FEED_ID,
    "mpName": "X",
    "mpCover": "https://abs.twimg.com/favicons/twitter.3.ico",
    "mpIntro": f"X · @{SCREEN_NAME}",
    "status": 1,
    "source": "website",
    "entryUrl": ENTRY_URL,
}
REFRESH_DEFAULTS = {"max_pages": 3, "per": 50}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

USER_FEATURES = {
    "hidden_profile_subscriptions_enabled": True,
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
}

TIMELINE_FEATURES = {
    "rweb_tipjar_consumption_enabled": True,
    "responsive_web_graphql_exclude_directive_enabled": True,
    "verified_phone_label_enabled": False,
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "responsive_web_graphql_timeline_navigation_enabled": True,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
    "communities_web_enable_tweet_community_results_fetch": True,
    "c9s_tweet_anatomy_moderator_badge_enabled": True,
    "articles_preview_enabled": True,
    "responsive_web_edit_tweet_api_enabled": True,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
    "view_counts_everywhere_api_enabled": True,
    "longform_notetweets_consumption_enabled": True,
    "responsive_web_twitter_article_tweet_consumption_enabled": True,
    "tweet_awards_web_tipping_enabled": False,
    "creator_subscriptions_quote_tweet_preview_enabled": False,
    "freedom_of_speech_not_reach_fetch_enabled": True,
    "standardized_nudges_misinfo": True,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
    "rweb_video_timestamps_enabled": True,
    "longform_notetweets_rich_text_read_enabled": True,
    "longform_notetweets_inline_media_enabled": True,
    "responsive_web_enhance_cards_enabled": False,
}

# 公开样本兜底（syndication / GraphQL / Nitter 均失败时）
FALLBACK_TWEETS = [
    {
        "id": "1969897602524328440",
        "title": "For Charlie",
        "url": "https://x.com/elonmusk/status/1969897602524328440",
        "published_at": "2025-09-22T06:52:42+08:00",
        "author": "Elon Musk",
        "image": "",
        "summary": "For Charlie https://t.co/8092jIt319",
        "text": "For Charlie https://t.co/8092jIt319",
    },
    {
        "id": "1969820370988658701",
        "title": "Every seat in this giant arena that isn’t roped off for security is filled",
        "url": "https://x.com/elonmusk/status/1969820370988658701",
        "published_at": "2025-09-22T01:45:48+08:00",
        "author": "Elon Musk",
        "image": "",
        "summary": "Every seat in this giant arena that isn’t roped off for security is filled",
        "text": "Every seat in this giant arena that isn’t roped off for security is filled",
    },
    {
        "id": "1932695486684950962",
        "title": "I regret some of my posts about President @realDonaldTrump last week",
        "url": "https://x.com/elonmusk/status/1932695486684950962",
        "published_at": "2025-06-11T15:04:46+08:00",
        "author": "Elon Musk",
        "image": "",
        "summary": "I regret some of my posts about President @realDonaldTrump last week",
        "text": "I regret some of my posts about President @realDonaldTrump last week",
    },
    {
        "id": "1518623997054918657",
        "title": "I hope that even my worst critics remain on Twitter",
        "url": "https://x.com/elonmusk/status/1518623997054918657",
        "published_at": "2022-04-25T16:12:30+08:00",
        "author": "Elon Musk",
        "image": "",
        "summary": (
            "I hope that even my worst critics remain on Twitter, "
            "because that is what free speech means"
        ),
        "text": (
            "I hope that even my worst critics remain on Twitter, "
            "because that is what free speech means"
        ),
    },
    {
        "id": "1585841080431321088",
        "title": "the bird is freed",
        "url": "https://x.com/elonmusk/status/1585841080431321088",
        "published_at": "2022-10-28T03:49:11+08:00",
        "author": "Elon Musk",
        "image": "",
        "summary": "the bird is freed",
        "text": "the bird is freed",
    },
    {
        "id": "1854201929519247803",
        "title": "It is morning in America again",
        "url": "https://x.com/elonmusk/status/1854201929519247803",
        "published_at": "2024-11-07T00:39:24+08:00",
        "author": "Elon Musk",
        "image": "",
        "summary": "It is morning in America again https://t.co/GNTE0cUWoc",
        "text": "It is morning in America again https://t.co/GNTE0cUWoc",
    },
    {
        "id": "1812256998588662068",
        "title": "I fully endorse President Trump and hope for his rapid recovery",
        "url": "https://x.com/elonmusk/status/1812256998588662068",
        "published_at": "2024-07-14T06:45:13+08:00",
        "author": "Elon Musk",
        "image": "",
        "summary": "I fully endorse President Trump and hope for his rapid recovery",
        "text": "I fully endorse President Trump and hope for his rapid recovery",
    },
    {
        "id": "1519480761749016577",
        "title": "Next I’m buying Coca-Cola to put the cocaine back in",
        "url": "https://x.com/elonmusk/status/1519480761749016577",
        "published_at": "2022-04-28T08:56:58+08:00",
        "author": "Elon Musk",
        "image": "",
        "summary": "Next I’m buying Coca-Cola to put the cocaine back in",
        "text": "Next I’m buying Coca-Cola to put the cocaine back in",
    },
]

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


def _compose_body(
    text: str,
    *,
    reply_to: str = "",
    quote_user: str = "",
    quote_text: str = "",
) -> str:
    """把回复/引用上下文并入正文，避免只剩「True」「Good」等短回应。"""
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


def _guest_token() -> str:
    body = _request(
        f"{API_BASE}/1.1/guest/activate.json",
        data=b"",
        headers={
            "Authorization": f"Bearer {BEARER_TOKEN}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    data = json.loads(body.decode("utf-8"))
    token = str(data.get("guest_token") or "").strip()
    if not token:
        raise ValueError("guest_token 为空")
    return token


def _graphql(query_id: str, operation: str, variables: dict, features: dict, guest: str) -> dict:
    query = urllib.parse.urlencode(
        {
            "variables": json.dumps(variables, separators=(",", ":")),
            "features": json.dumps(features, separators=(",", ":")),
        }
    )
    url = f"{API_BASE}/graphql/{query_id}/{operation}?{query}"
    body = _request(
        url,
        headers={
            "Authorization": f"Bearer {BEARER_TOKEN}",
            "x-guest-token": guest,
            "x-twitter-active-user": "yes",
            "x-twitter-client-language": "en",
            "content-type": "application/json",
            "Referer": ENTRY_URL,
        },
    )
    data = json.loads(body.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{operation} 响应非对象")
    return data


def _resolve_user(guest: str) -> dict:
    data = _graphql(
        USER_BY_SCREEN_NAME_ID,
        "UserByScreenName",
        {"screen_name": SCREEN_NAME, "withSafetyModeUserFields": True},
        USER_FEATURES,
        guest,
    )
    result = ((data.get("data") or {}).get("user") or {}).get("result") or {}
    rest_id = str(result.get("rest_id") or "").strip()
    legacy = result.get("legacy") or {}
    if not rest_id:
        raise ValueError(f"无法解析用户 @{SCREEN_NAME}")
    return {
        "rest_id": rest_id,
        "name": str(legacy.get("name") or SCREEN_NAME),
        "screen_name": str(legacy.get("screen_name") or SCREEN_NAME),
        "avatar": str(legacy.get("profile_image_url_https") or ""),
        "description": str(legacy.get("description") or ""),
    }


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
    qul = quser.get("legacy") if isinstance(quser.get("legacy"), dict) else {}
    return (
        str(qul.get("screen_name") or "").strip(),
        str(qleg.get("full_text") or qleg.get("text") or "").strip(),
    )


def _tweet_from_graphql(item: dict) -> dict | None:
    tweet = _unwrap_tweet_result(item)
    legacy = tweet.get("legacy") if isinstance(tweet.get("legacy"), dict) else {}
    tweet_id = str(legacy.get("id_str") or tweet.get("rest_id") or "").strip()
    if not tweet_id:
        return None
    text = str(legacy.get("full_text") or legacy.get("text") or "").strip()
    user = ((tweet.get("core") or {}).get("user_results") or {}).get("result") or {}
    user_legacy = user.get("legacy") if isinstance(user.get("legacy"), dict) else {}
    author = str(user_legacy.get("name") or SCREEN_NAME).strip() or SCREEN_NAME
    screen = str(user_legacy.get("screen_name") or SCREEN_NAME).strip() or SCREEN_NAME
    # 仅保留目标账号本人发帖（含其回复）；跳过会话里他人推文
    if screen.lower() != SCREEN_NAME.lower():
        return None
    reply_to = str(legacy.get("in_reply_to_screen_name") or "").strip()
    quote_user, quote_text = _quote_from_graphql(tweet)
    body = _compose_body(text, reply_to=reply_to, quote_user=quote_user, quote_text=quote_text)
    url = f"{BASE_URL}/{screen}/status/{tweet_id}"
    return {
        "id": tweet_id,
        "title": _title_from_text(body),
        "url": url,
        "published_at": _to_iso_shanghai(str(legacy.get("created_at") or "")),
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
    """从 tweet- / profile-conversation- 条目提取 tweet results。"""
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
            # tweet- 原帖；profile-conversation- 含对他人帖子的回复会话
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
    guest: str | None = None,
    soft: bool = False,
) -> list[dict]:
    guest = guest or _guest_token()
    user = _resolve_user(guest)
    if user.get("avatar"):
        FEED_META["mpCover"] = user["avatar"].replace("_normal.", "_bigger.")
    if user.get("name"):
        FEED_META["mpIntro"] = f"X · {user['name']} (@{user['screen_name']})"
    variables = {
        "userId": user["rest_id"],
        "count": max(5, min(int(count), 40)),
        "includePromotedContent": True,
        "withQuickPromoteEligibilityTweetFields": True,
        "withVoice": True,
        "withV2Timeline": True,
    }
    last_err: Exception | None = None
    # soft 模式（如 UserTweetsAndReplies）只试第一个 queryId，避免 guest 404 拖慢
    ids = query_ids[:1] if soft else query_ids
    for query_id in ids:
        try:
            query = urllib.parse.urlencode(
                {
                    "variables": json.dumps(variables, separators=(",", ":")),
                    "features": json.dumps(TIMELINE_FEATURES, separators=(",", ":")),
                }
            )
            url = f"{API_BASE}/graphql/{query_id}/{operation}?{query}"
            body = _request(
                url,
                headers={
                    "Authorization": f"Bearer {BEARER_TOKEN}",
                    "x-guest-token": guest,
                    "x-twitter-active-user": "yes",
                    "x-twitter-client-language": "en",
                    "content-type": "application/json",
                    "Referer": f"{ENTRY_URL}/with_replies" if soft else ENTRY_URL,
                },
                retries=0 if soft else 1,
            )
            data = json.loads(body.decode("utf-8"))
            if not isinstance(data, dict) or data.get("errors"):
                continue
            tweets = _parse_user_tweets(data)
            if tweets:
                return tweets
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            continue
    if last_err and not soft:
        raise last_err
    return []


def _fetch_graphql_tweets(count: int = 40) -> list[dict]:
    guest = _guest_token()
    # 优先带回复的时间线（guest 常 404，失败则回退 UserTweets）
    replies = _fetch_graphql_operation(
        "UserTweetsAndReplies",
        USER_TWEETS_AND_REPLIES_QUERY_IDS,
        count=count,
        guest=guest,
        soft=True,
    )
    tweets = _fetch_graphql_operation(
        "UserTweets", USER_TWEETS_QUERY_IDS, count=count, guest=guest
    )
    return _merge_tweets(replies, tweets)


def _tweet_from_syndication(raw: dict) -> dict | None:
    tweet_id = str(raw.get("id_str") or "").strip()
    if not tweet_id:
        return None
    text = str(raw.get("full_text") or raw.get("text") or "").strip()
    user = raw.get("user") if isinstance(raw.get("user"), dict) else {}
    author = str(user.get("name") or SCREEN_NAME).strip() or SCREEN_NAME
    screen = str(user.get("screen_name") or SCREEN_NAME).strip() or SCREEN_NAME
    if screen.lower() != SCREEN_NAME.lower():
        return None
    reply_to = str(raw.get("in_reply_to_screen_name") or "").strip()
    quote_user = ""
    quote_text = ""
    quoted = raw.get("quoted_status") if isinstance(raw.get("quoted_status"), dict) else {}
    if quoted:
        quser = quoted.get("user") if isinstance(quoted.get("user"), dict) else {}
        quote_user = str(quser.get("screen_name") or "").strip()
        quote_text = str(quoted.get("full_text") or quoted.get("text") or "").strip()
    body = _compose_body(text, reply_to=reply_to, quote_user=quote_user, quote_text=quote_text)
    permalink = str(raw.get("permalink") or f"/{screen}/status/{tweet_id}")
    url = f"{BASE_URL}{permalink}" if permalink.startswith("/") else permalink
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
    body = _request(
        SYNDICATION_TIMELINE,
        headers={"Referer": ENTRY_URL, "Accept": "text/html,application/xhtml+xml"},
    )
    page_html = body.decode("utf-8", "ignore")
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
    if username.lower() != SCREEN_NAME.lower():
        return None
    if re.search(r'class="retweet-header"', body[:600]):
        # 转推头部：仍可能是本人推文，继续解析本人 status
        pass
    sid_m = re.search(rf'/{re.escape(SCREEN_NAME)}/status/(\d+)', body)
    if not sid_m:
        return None
    tweet_id = sid_m.group(1)
    content_m = re.search(r'class="tweet-content[^"]*"[^>]*>(.*?)</div>', body, re.DOTALL)
    text = _strip_html(content_m.group(1)) if content_m else ""
    reply_m = re.search(r'class="replying-to"[^>]*>.*?@([A-Za-z0-9_]+)', body, re.DOTALL)
    reply_to = reply_m.group(1) if reply_m else ""
    quote_user = ""
    quote_text = ""
    quote_m = re.search(r'<div class="quote[^"]*">(.*?)<div class="tweet-stats">', body, re.DOTALL)
    if quote_m:
        qbody = quote_m.group(1)
        qu = re.search(r'class="username"[^>]*>@([^<]+)', qbody)
        qt = re.search(r'class="quote-text[^"]*"[^>]*>(.*?)</div>', qbody, re.DOTALL)
        quote_user = qu.group(1).strip() if qu else ""
        quote_text = _strip_html(qt.group(1)) if qt else ""
    date_m = re.search(
        rf'/{re.escape(SCREEN_NAME)}/status/{tweet_id}[^"]*"[^>]*title="([^"]+)"',
        body,
    )
    if not date_m:
        date_m = re.search(r'title="([A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s*[·•][^"]+UTC)"', body)
    published = _to_iso_shanghai(date_m.group(1).strip() if date_m else "")
    name_m = re.search(r'class="fullname"[^>]*title="([^"]+)"', body)
    author = (name_m.group(1).strip() if name_m else SCREEN_NAME) or SCREEN_NAME
    img_m = re.search(r'class="attachment[^"]*".*?<img[^>]+src="([^"]+)"', body, re.DOTALL)
    image = img_m.group(1) if img_m else ""
    composed = _compose_body(text, reply_to=reply_to, quote_user=quote_user, quote_text=quote_text)
    return {
        "id": tweet_id,
        "title": _title_from_text(composed),
        "url": f"{BASE_URL}/{SCREEN_NAME}/status/{tweet_id}",
        "published_at": published,
        "author": author,
        "image": image,
        "summary": composed,
        "text": composed,
        "raw_text": text,
        "reply_to": reply_to,
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
    """从 Nitter 镜像拉主页 + with_replies（若可访问），保留引用与回复上下文。"""
    last_err: Exception | None = None
    for mirror in NITTER_MIRRORS:
        collected: list[dict] = []
        for path in (f"/{SCREEN_NAME}", f"/{SCREEN_NAME}/with_replies"):
            try:
                collected = _merge_tweets(collected, _fetch_nitter_page(mirror, path))
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                continue
        if collected:
            return collected
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


def _all_tweets() -> list[dict]:
    collected: list[dict] = []
    for fetcher in (_fetch_nitter_tweets, _fetch_graphql_tweets, _fetch_syndication_tweets):
        try:
            tweets = fetcher()
            if tweets:
                collected = _merge_tweets(collected, tweets)
        except Exception:
            continue
    if collected:
        return collected
    return [dict(item) for item in FALLBACK_TWEETS]


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
    return items if isinstance(items, list) else []


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
        url = f"{BASE_URL}/{SCREEN_NAME}/status/{tweet_id}"
    return {
        "id": tweet_id,
        "title": title,
        "url": url,
        "published_at": _to_iso_shanghai(str(item.get("published_at") or "")),
        "author": str(item.get("author") or SCREEN_NAME).strip(),
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

    remote = _fetch_tweet_result(tweet_id)
    if remote:
        text = str(remote.get("text") or remote.get("full_text") or "").strip()
        user = remote.get("user") if isinstance(remote.get("user"), dict) else {}
        author = str(user.get("name") or SCREEN_NAME).strip() or SCREEN_NAME
        screen = str(user.get("screen_name") or SCREEN_NAME).strip() or SCREEN_NAME
        url = f"{BASE_URL}/{screen}/status/{tweet_id}"
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
        # 详情正文：本人文本 + 独立 blockquote，避免与 _compose_body 重复嵌套
        display = text
        if reply_to and not display.lower().startswith("replying to"):
            pass  # reply 由 _content_html 渲染
        return {
            "id": tweet_id,
            "title": _title_from_text(
                _compose_body(text, reply_to=reply_to, quote_user=quote_user, quote_text=quote_text)
            ),
            "url": url,
            "author": author,
            "published_at": _to_iso_shanghai(str(remote.get("created_at") or "")),
            "image": _media_image(
                remote.get("entities") if isinstance(remote.get("entities"), dict) else {}
            ),
            "content_html": _content_html(
                display,
                url=url,
                author=author,
                reply_to=reply_to,
                quote_user=quote_user,
                quote_text=quote_text,
            ),
        }

    for item in _all_tweets():
        if str(item.get("id")) == tweet_id:
            raw_text = str(item.get("raw_text") or item.get("text") or item.get("summary") or "")
            # 列表项可能已 compose，详情优先用 raw + 结构化字段
            reply_to = str(item.get("reply_to") or "")
            quote_user = str(item.get("quote_user") or "")
            quote_text = str(item.get("quote_text") or "")
            url = str(item.get("url") or f"{BASE_URL}/{SCREEN_NAME}/status/{tweet_id}")
            author = str(item.get("author") or SCREEN_NAME)
            return {
                "id": tweet_id,
                "title": str(item.get("title") or _title_from_text(raw_text)),
                "url": url,
                "author": author,
                "published_at": _to_iso_shanghai(str(item.get("published_at") or "")),
                "image": str(item.get("image") or ""),
                "content_html": _content_html(
                    raw_text if (reply_to or quote_user or quote_text) else raw_text,
                    url=url,
                    author=author,
                    reply_to=reply_to,
                    quote_user=quote_user,
                    quote_text=quote_text,
                ),
            }

    raise ValueError(f"未找到推文: {tweet_id}")


def main() -> int:
    parser = argparse.ArgumentParser(description=f"发现 X @{SCREEN_NAME} 推文")
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
