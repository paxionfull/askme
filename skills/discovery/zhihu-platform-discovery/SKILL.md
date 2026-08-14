---
name: zhihu-platform-discovery
description: >-
  Discovers Zhihu user/org articles via official API. One skill covers all
  accounts; params from feed_registry.platform_accounts. Requires Zhihu Cookie
  (d_c0 + z_c0 login). Use when fetching updates from zhihu.com people/org pages.
---

# 知乎（平台 skill）

多账号共用本 skill。接入时只写入 `feed_registry.platform_accounts`，不按用户建目录。

## 模型

| 项 | 说明 |
|----|------|
| 目录 | `skills/discovery/zhihu-platform-discovery/` |
| `account_key` | 知乎 `user_id`（URL 路径段） |
| `user_type` | `people` 或 `org` |
| 鉴权 | `auth_slot: zhihu`，必填 Cookie 键 `d_c0` + `z_c0` |
| 实现 | `scripts/discover.py` → `_lib/zhihu_common`；运行时 `BoundPlatformAdapter` + ContextVar |

## 鉴权

设置页完成知乎**真实登录**后保存 Cookie，或注入 `ASKME_COOKIE_ZHIHU`。

- 必须同时含 `d_c0`（x-zse-96 签名）与 `z_c0`（登录 ticket）
- 仅有 `d_c0` / `__zse_ck` 仍是访客态：`/api/v4/members/{id}/articles` 会返回 HTTP 401 / code 602
- 缺 Cookie / 访客态报错以 `ASKME_AUTH_REQUIRED:slot=zhihu` 开头

## 快速执行（需绑定账号上下文）

```bash
# 本地调试（显式绑定账号）
python skills/discovery/zhihu-platform-discovery/scripts/discover.py \
  --account-key aitechtalk --user-type people --page 1 --per 20

# 平台 skill 验证（discovery_validate 会从 feed_registry 自动绑定一个知乎账号）
python skills/discovery/_lib/discovery_validate.py zhihu-platform
```

## 接口

与站级 skill 相同：`fetch_list_page` / `list_items` / `has_next_page` /
`normalize_list_item` / `fetch_article_detail`（支持 `**hints`）。

## auto_repair

可改本目录与 `_lib/zhihu_common.py`；不要为单个账号新建 skill 目录。
