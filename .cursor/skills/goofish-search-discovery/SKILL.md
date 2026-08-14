---
name: goofish-search-discovery
description: >-
  Discovers Goofish (闲鱼) search results for keyword 网球拍 via
  mtop.taobao.idlemtopsearch.pc.search and item detail via
  mtop.taobao.idle.pc.detail. Requires logged-in Cookie (unb, cookie2, _m_h5_tk).
  Use when fetching updates from goofish.com/search for this feed only.
  Not for onboarding other websites.
---

# Goofish · search 发现层

入口：[闲鱼搜索 · 网球拍](https://www.goofish.com/search?q=%E7%BD%91%E7%90%83%E6%8B%8D&spm=a21ybx.home.searchInput.0)

## 快速执行

```bash
python .cursor/skills/goofish-search-discovery/scripts/discover.py --page 1 --per 30
python .cursor/skills/goofish-search-discovery/scripts/discover.py --id <itemId>
```

## API

| 用途 | API |
|------|-----|
| 搜索列表 | `POST h5api.m.goofish.com/.../mtop.taobao.idlemtopsearch.pc.search/1.0/` |
| 商品详情 | `POST .../mtop.taobao.idle.pc.detail/1.0/` |

鉴权：Cookie slot `goofish-com`（`_m_h5_tk` + `unb` + `cookie2`），mtop 签名 `MD5(token&t&appKey&data)`，`appKey=34839810`。

## 接入 Askme

实现 `WebsiteFeedAdapter`；缺 Cookie 时抛出 `ASKME_AUTH_REQUIRED:slot=goofish-com`。
