---
name: reuters-discovery
description: Discovers Reuters stories via Arc news sitemap and fetches article HTML with DataDome anti-bot fallback.
---

# Reuters Discovery Skill

- Feed ID: `website:reuters`
- Entry URL: `https://www.reuters.com/`
- List source: `https://www.reuters.com/arc/outboundfeeds/news-sitemap/?outputType=xml`

## Notes

1. Reuters 主站与文章页在当前环境通常触发 DataDome 挑战（HTTP 401）。
2. 列表侧使用 Arc `news-sitemap`（sitemap XML，非 RSS），提取 `news:title`、`news:publication_date`、封面图等字段。
3. 详情侧优先抓取原文 HTML；若被挑战拦截，返回基于 sitemap 元数据构造的降级正文以保证处理链路稳定。
