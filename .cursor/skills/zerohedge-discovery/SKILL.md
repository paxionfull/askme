---
name: zerohedge-discovery
description: Discovers articles from ZeroHedge (zerohedge.com) via Next.js __NEXT_DATA__ on list and detail pages.
---

# ZeroHedge Discovery

用于抓取 ZeroHedge（https://www.zerohedge.com/）文章列表与正文。

## 快速执行

```bash
python .cursor/skills/zerohedge-discovery/scripts/discover.py --page 1 --per 20
python .cursor/skills/zerohedge-discovery/scripts/discover.py --id 1117423
```

## 数据来源

- 列表：`/` 与 `/page/{n}` 页面中的 `__NEXT_DATA__.props.pageProps.results`
- 详情：文章 URL 页面中的 `__NEXT_DATA__.props.pageProps.node.body`

## 实现要点

- 不使用 RSS/Atom。
- 列表与详情都从 SSR 注水 JSON 读取，避免脆弱的 DOM 解析。
- `published_at` 统一转换为 `Asia/Shanghai` ISO8601。
- 详情 **优先** 使用 backend 传入的 `hints.url`（列表入库时已有），再 fallback 翻页列表按 `nid` 定位 path。
- 禁止仅在首页第一页列表中查找 `nid`；老文章掉出首页后仍应能拉正文。
