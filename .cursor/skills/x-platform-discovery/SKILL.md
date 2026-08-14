---
name: x-platform-discovery
description: >-
  Discovers X (Twitter) user timelines via Nitter mirrors, guest GraphQL, and
  syndication. One skill covers all accounts; screen_name from
  feed_registry.platform_accounts. Use when fetching updates from x.com profiles.
---

# X / Twitter（平台 skill）

多账号共用本 skill。接入时只写入 `feed_registry.platform_accounts`。

## 模型

| 项 | 说明 |
|----|------|
| 目录 | `.cursor/skills/x-platform-discovery/` |
| `account_key` | `screen_name`（不含 `@`） |
| 鉴权 | 公开接口为主，一般不需 Cookie |
| 列表 | Nitter → guest GraphQL → syndication（按可用程度回退） |
| 实现 | `scripts/discover.py`；`BoundPlatformAdapter` + ContextVar |

## 快速执行

```bash
python .cursor/skills/_lib/discovery_validate.py x-platform
```

## 接口

`fetch_list_page` / `list_items` / `has_next_page` / `normalize_list_item` /
`fetch_article_detail(**hints)`。

## auto_repair

可改本目录；逻辑较复杂时优先修 discover.py。禁止空 stub + 仅内存编译脚手架作为唯一运行路径。
