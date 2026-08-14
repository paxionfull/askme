---
name: x-platform-discovery
description: >-
  Discovers X (Twitter) user original posts only (no replies, retweets, or quote
  tweets) via logged-in GraphQL (Cookie auth_token+ct0), with Nitter/syndication
  fallback. One skill covers all accounts; screen_name from
  feed_registry.platform_accounts. Use when fetching updates from x.com profiles.
  Requires X Cookie (auth_slot=x).
---

# X / Twitter（平台 skill）

多账号共用本 skill。接入时只写入 `feed_registry.platform_accounts`。

## 模型

| 项 | 说明 |
|----|------|
| 目录 | `skills/discovery/x-platform-discovery/` |
| `account_key` | `screen_name`（不含 `@`） |
| 鉴权 | 需要 X Cookie（`auth_token` + `ct0`），slot=`x` |
| 列表 | 登录态 GraphQL `UserTweets` → Nitter 主页 → syndication |
| 范围 | **只抓原创主帖**；跳过回复、RT、QT 与 `/with_replies` |
| 实现 | `scripts/discover.py`；`BoundPlatformAdapter` + ContextVar |

## 授权

设置页完成 X 登录并保存 Cookie。缺 Cookie / 缺 `auth_token`·`ct0` 时报错以
`ASKME_AUTH_REQUIRED:slot=x` 开头。

## 快速执行

```bash
python skills/discovery/_lib/discovery_validate.py x-platform
```

## 接口

`fetch_list_page` / `list_items` / `has_next_page` / `normalize_list_item` /
`fetch_article_detail(**hints)`。

## auto_repair

可改本目录；逻辑较复杂时优先修 discover.py。禁止空 stub + 仅内存编译脚手架作为唯一运行路径。
