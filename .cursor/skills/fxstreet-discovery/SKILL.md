---
name: fxstreet-discovery
description: Discovers FXStreet news from google-sitemap-news.xml and article HTML. Use when fetching updates from fxstreet.com.
---

# FXStreet Discovery

用于抓取 FXStreet（`https://www.fxstreet.com/`）财经新闻的 discovery skill。

## 数据来源

- 列表：`https://www.fxstreet.com/google-sitemap-news.xml`（Google News Sitemap，含 title / publication_date）
- 详情：文章页 HTML（`<article>` + `NewsArticle` JSON-LD）
- Feed ID：`website:fxstreet`

## 实现要点

- `published_at` 统一转换为 `Asia/Shanghai` 的 ISO8601。
- 不使用 RSS/Atom；不用需 Turnstile 的 tRPC Algolia 接口。
- 分页对 sitemap 条目做 page/per 切片。
