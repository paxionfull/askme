---
name: weixin-platform-discovery
description: >-
  Discovers articles from WeChat Official Accounts via mp.weixin.qq.com admin
  list_ex API. One skill covers all OA accounts; account params come from
  feed_registry.platform_accounts. Requires 公众号 backend Cookie (not 小程序).
---

# 微信公众号（平台 skill）

多账号共用本 skill。接入时只写入 `feed_registry.platform_accounts`。

## 模型

| 项 | 说明 |
|----|------|
| 目录 | `.cursor/skills/weixin-platform-discovery/` |
| `account_key` | `fakeid` |
| 鉴权 | `auth_slot: weixin`，须【公众号】后台登录；必填 `askme_mp_token` + `slave_sid` |
| 列表 | 公众号后台 `list_ex` |
| 正文 | 公开 `/s/` 文章页 |
| 实现 | `scripts/discover.py` → `_lib/weixin_common` |

## 鉴权

设置页登录【公众号】后台（勿选小程序）。缺凭证报错以
`ASKME_AUTH_REQUIRED:slot=weixin` 开头。

## 快速执行

```bash
python .cursor/skills/_lib/discovery_validate.py weixin-platform
```

## 接口

`fetch_list_page` / `list_items` / `has_next_page` / `normalize_list_item` /
`fetch_article_detail(**hints)` / `normalize_article_body`。

## auto_repair

可改本目录与 `_lib/weixin_common.py`；不要按公众号拆 skill 目录。
