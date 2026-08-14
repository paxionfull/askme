---
name: openai-discovery
description: Discovers OpenAI News pages from OpenAI sitemap and fetches article HTML.
---

# OpenAI Discovery

用于抓取 OpenAI 官网新闻页面（`https://openai.com/zh-Hans-CN/news/`）的 discovery skill。

## 数据来源

- 列表：`https://openai.com/sitemap.xml` 中的 `*news-listed*` 子 sitemap（当前可用 `global-affairs-news-listed`）
- 字段：`loc`、`lastmod`、`xhtml:link hreflang=zh-Hans-CN`
- 详情：按 `https://openai.com/{id}/` 拉取 HTML

## 实现要点

- `published_at` 统一转换为 `Asia/Shanghai` 的 ISO8601。
- 若详情页遇到 Cloudflare challenge，保留可用回退正文，避免任务中断。
- 不使用 RSS/Atom。
