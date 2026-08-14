---
name: marketwatch-discovery
description: Discovers MarketWatch stories via Google News sitemap and fetches article HTML with DataDome anti-bot fallback.
---

# MarketWatch Discovery Skill

- Feed ID: `website:marketwatch`
- Entry URL: `https://www.marketwatch.com/`
- List source: `https://www.marketwatch.com/mw_news_sitemap.xml` (+ live coverage sitemap)

## Notes

1. MarketWatch 主站与文章页在当前环境通常触发 DataDome 挑战（HTTP 401）。
2. 列表侧使用 Google News sitemap 索引（sitemap XML，非 RSS），提取 `news:title`、`news:publication_date`、封面图等字段。
3. 详情侧优先抓取原文 HTML；若被挑战拦截，返回基于 sitemap 元数据构造的降级正文以保证处理链路稳定。
