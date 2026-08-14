---
name: anthropic-discovery
description: >-
  Discovers articles from Anthropic News (anthropic.com/news) via static HTML parsing.
  Use when fetching updates from anthropic.com/news.
---

# Anthropic News 发现层

官网：[Anthropic News](https://www.anthropic.com/news)

## 快速执行

```bash
python .cursor/skills/anthropic-discovery/scripts/discover.py --page 1 --per 20
python .cursor/skills/anthropic-discovery/scripts/discover.py --id claude-sonnet-5
```

## 页面结构

| 用途 | URL | 说明 |
|------|-----|------|
| 列表 | `GET /news` | 解析 `PublicationList` 列表中的日期/分类/标题/链接 |
| 详情 | `GET /news/{slug}` | 解析 `Body-module...__body` 容器作为正文 HTML |

## 接入 Askme

实现 `WebsiteFeedAdapter` 接口，由 `FeedClient` 自动加载。

| 符号 | 说明 |
|------|------|
| `fetch_list_page(page, per)` | 拉取 News 页并解析列表 |
| `fetch_article_detail(article_id)` | 拉取详情页并返回 `content_html` |
| `normalize_article_body(raw_html)` | 使用 `_lib/content_utils.clean_html_fragment` 清洗正文 |
