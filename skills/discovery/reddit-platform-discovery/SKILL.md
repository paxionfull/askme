---
name: reddit-platform-discovery
description: >-
  Discovers Reddit subreddit posts via arctic-shift / pullpush public archive
  (optional login Cookie for www.reddit.com JSON). One skill covers all subs;
  account_key is the subreddit name from feed_registry.platform_accounts.
---

# Reddit（平台 skill）

多 subreddit 共用本 skill。接入时只写入 `feed_registry.platform_accounts`。

## 模型

| 项 | 说明 |
|----|------|
| 目录 | `skills/discovery/reddit-platform-discovery/` |
| `account_key` | subreddit 名（不含 `r/`） |
| 鉴权 | **无需**登录 Cookie；默认 arctic-shift → pullpush 公开归档 |
| 实现 | `scripts/discover.py` → `_lib/reddit_common` |

## 快速执行

```bash
python skills/discovery/_lib/discovery_validate.py reddit-platform
```

## 接口

`fetch_list_page` / `list_items` / `has_next_page` / `normalize_list_item` /
`fetch_article_detail(**hints)`。

## auto_repair

可改本目录与 `_lib/reddit_common.py`。
