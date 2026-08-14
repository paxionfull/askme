---
name: kimi-discovery
description: >-
  Discovers articles from Kimi Blog (kimi.com/blog) via sitemap-ug-blog.xml
  and article HTML. Use when fetching updates from kimi.com/blog or Moonshot Kimi only.
  Not for onboarding other websites.
---

# Kimi Blog 发现层

官网：https://www.kimi.com/blog/

## 快速执行

```bash
python .cursor/skills/kimi-discovery/scripts/discover.py --page 1 --per 20
python .cursor/skills/kimi-discovery/scripts/discover.py --id kimi-k2-6
```

## 页面结构

| 用途 | URL | 说明 |
|------|-----|------|
| 列表 | `GET /sitemap/sitemap-ug-blog.xml` | 解析 `loc` + `lastmod`；过滤掉 `/blog/` 首页 |
| 标题补全 | `GET /blog/` | 从文章链接内 `<span>` 提取标题/副标题 |
| 详情 | `GET /blog/{slug}` | 解析 `max-w-none markdown` 容器作为正文 HTML |

## 接入 Askme

实现 `WebsiteFeedAdapter` 接口，由 `FeedClient` 自动加载。

| 符号 | 说明 |
|------|------|
| `FEED_ID` | `website:kimi` |
| `fetch_list_page(page, per)` | 拉取 blog sitemap 并切片分页 |
| `fetch_article_detail(article_id, **hints)` | 优先 hints.url，拉取详情页正文 |
| `normalize_article_body(raw_html)` | `clean_html_fragment` 清洗 |

## 验证

```bash
python .cursor/skills/_lib/discovery_validate.py kimi
```
