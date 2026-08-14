---
name: investing-discovery
description: >-
  Discovers news from Investing (investing.com/news). Origin is protected by
  Cloudflare challenge, so adapter parses public Wayback snapshots of Next.js
  state (newsStore) and keeps stable fallback samples.
---

# Investing 发现层

官网：[Investing](https://www.investing.com/news)

## 快速执行

```bash
python .cursor/skills/investing-discovery/scripts/discover.py --page 1 --per 5
python .cursor/skills/investing-discovery/scripts/discover.py --id 4237861
```

## 说明

- `https://www.investing.com/news` 直接 HTTP 抓取会命中 Cloudflare challenge。
- 适配器优先从 Wayback 快照页面解析 `__NEXT_DATA__` 的 `state.newsStore` 字段获取列表。
- 详情优先从文章详情页的 `newsStore._article.body` 提取正文；不可用时回退稳定样本，保证发现链路可用。
