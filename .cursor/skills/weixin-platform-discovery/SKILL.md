---
name: weixin-platform-discovery
description: >-
  Discovers articles from WeChat Official Accounts via mp.weixin.qq.com admin
  list_ex API. One skill covers all OA accounts; account params come from
  feed_registry.platform_accounts.
---

# 微信公众号（平台 skill）

多账号共用本 skill。接入时只写入 `feed_registry.platform_accounts`，不再为每个号生成目录。

- 列表：公众号后台 `list_ex`（设置页「微信」凭证）
- 正文：公开 `/s/` 文章页
- 账号字段：`account_key` = fakeid
