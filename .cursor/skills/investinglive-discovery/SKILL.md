---
name: investinglive-discovery
description: Discovers Investinglive stocks articles from latest.xml and parses NewsArticle JSON-LD bodies.
---

# Investinglive Discovery Skill

- Feed ID: `website:investinglive`
- Entry URL: `https://investinglive.com/stocks/`
- List source: `https://investinglive.com/latest.xml`

## Notes

1. 站点入口页为 SSR HTML，稳定列表源是 `latest.xml`（news sitemap）。
2. 列表仅保留 URL 前缀为 `/stocks/` 的文章，避免混入 news/forex/commodities 等频道。
3. 详情页正文优先提取 `application/ld+json` 中 `NewsArticle.articleBody`，无该字段时回退原始 HTML。
