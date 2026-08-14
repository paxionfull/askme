---
name: xiaohongshu-platform-discovery
description: >-
  Discovers Xiaohongshu user notes via profile SSR and edith APIs. One skill
  covers all users; params from feed_registry.platform_accounts. Requires real
  login Cookie (web_session + loggedIn). Use for xiaohongshu.com profile URLs.
---

# 小红书（平台 skill）

多账号共用本 skill。接入时只写入 `feed_registry.platform_accounts`，不按用户建目录。

## 模型

| 项 | 说明 |
|----|------|
| 目录 | `.cursor/skills/xiaohongshu-platform-discovery/` |
| `account_key` | 用户 `user_id` |
| `xsec_token` | 主页分享链接中的 token（可选，利于列表） |
| 鉴权 | `auth_slot: xiaohongshu`；访客态 `web_session` 不够，须真实登录 |
| 列表 | 主页 SSR；分页可尝试 edith `user_posted` |
| 详情 | edith feed / 笔记页 SSR（须笔记级 xsec_token） |
| 实现 | `scripts/discover.py` → `_lib/xiaohongshu_common`；`BoundPlatformAdapter` + ContextVar |

## 鉴权

设置页完成小红书扫码登录。缺 Cookie / 访客态报错以
`ASKME_AUTH_REQUIRED:slot=xiaohongshu` 开头。

## 快速执行

```bash
python .cursor/skills/_lib/discovery_validate.py xiaohongshu-platform
```

## 接口

与站级 skill 相同；`fetch_article_detail` 必须尊重 `**hints`（含 url / xsec_token）。

## auto_repair

可改本目录与 `_lib/xiaohongshu_common.py`。禁止再写空 stub 或按账号编译脚手架作为唯一运行路径。
