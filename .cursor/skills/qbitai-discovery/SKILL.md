---
name: qbitai-discovery
description: >-
  Discovers articles from 量子位 (qbitai.com) via WordPress REST API.
  Use when fetching updates from qbitai.com or 量子位 only.
  Not for onboarding other websites.
---

# 量子位发现层

官网：[量子位](https://www.qbitai.com/)

## 快速执行

```bash
python .cursor/skills/qbitai-discovery/scripts/discover.py --page 1 --per 20
python .cursor/skills/qbitai-discovery/scripts/discover.py --id 442024
```

## API

| 用途 | URL |
|------|-----|
| 文章列表 | `GET /wp-json/wp/v2/posts?page={page}&per_page={per}` |
| 文章详情 | `GET /wp-json/wp/v2/posts/{id}` |

分页响应头：`X-WP-TotalPages`

## 接入 Askme

实现 `WebsiteFeedAdapter` 接口，由 `FeedClient` 自动加载。

| 符号 | 说明 |
|------|------|
| `fetch_article_detail(article_id)` | WordPress 详情，`content.rendered` → `content_html` |
| `normalize_article_body(raw_html)` | 可选，清洗 WordPress HTML 片段 |

正文由 backend pipeline 拉取详情 → skill 清洗 → 写入 `article_bodies.db`。
