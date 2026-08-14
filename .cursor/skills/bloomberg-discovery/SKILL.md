---
name: bloomberg-discovery
description: Discovers Bloomberg stories via news sitemap and fetches article HTML with anti-bot fallback.
---

# Bloomberg Discovery Skill

- Feed ID: `website:bloomberg`
- Entry URL: `https://www.bloomberg.com/`
- List source: `https://www.bloomberg.com/sitemaps/news/latest.xml`

## Notes

1. Bloomberg 页面在当前运行环境通常触发 PerimeterX 挑战（HTTP 403 / robot page）。
2. 列表侧使用 `news/latest.xml`（sitemap XML，非 RSS）并提取 `news:title`、`news:publication_date` 等字段。
3. 详情侧优先抓取原文 HTML；若被挑战拦截，返回基于 sitemap 元数据构造的降级正文以保证处理链路稳定。
