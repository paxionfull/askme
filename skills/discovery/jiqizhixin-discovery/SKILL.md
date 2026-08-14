---
name: jiqizhixin-discovery
description: >-
  Discovers articles from 机器之心 (jiqizhixin.com) via the official article
  library JSON API. Returns title, URL, publish time, author, tags, and summary.
  Use when fetching updates from jiqizhixin.com or 机器之心 only.
---

# 机器之心发现层

从 [机器之心文章库](https://www.jiqizhixin.com/articles) 拉取文章元数据，不依赖微信读书 / wewe-rss。

## 快速执行

```bash
# 最近 1 天文章（默认）
python skills/discovery/jiqizhixin-discovery/scripts/discover.py

# 最近 3 天
python skills/discovery/jiqizhixin-discovery/scripts/discover.py --days 3

# 仅第 1 页（20 篇）
python skills/discovery/jiqizhixin-discovery/scripts/discover.py --mode page --page 1 --per 20

# 单篇详情（含完整 HTML 正文）
python skills/discovery/jiqizhixin-discovery/scripts/discover.py --slug 2026-07-02-9
```

输出为 JSON，`articles[]` 每项包含：`title`、`url`、`published_at`、`author`、`tags`、`summary`。

## 发现层 API（声明式配置见 [source.yaml](source.yaml)）

| 用途 | 方法 | URL |
|------|------|-----|
| 文章列表 | GET | `https://www.jiqizhixin.com/api/article_library/articles.json?sort=time&page={page}&per={per}` |
| 文章详情 | GET | `https://www.jiqizhixin.com/api/article_library/articles/{slug}.json` |

**必需请求头：**

```
Accept: application/json
Referer: https://www.jiqizhixin.com/articles
X-Requested-With: XMLHttpRequest
```

**文章 URL 规则：** `https://www.jiqizhixin.com/articles/{slug}`（如 `2026-07-02-9`）

**列表响应字段：**

- `articles[]`：`id`, `title`, `slug`, `publishedAt`, `author`, `tagList`, `coverImageUrl`, `content`（摘要）
- `totalCount`, `hasNextPage`

**时间格式：** `publishedAt` 为 `YYYY/MM/DD HH:mm`（北京时间）

## 站点特性（维护时注意）

1. **不要用首页做发现**：`https://www.jiqizhixin.com/` 已是数据服务落地页。
2. **旧 RSS 已失效**：`/rss` 不再返回文章 feed。
3. **必须带 Referer**：否则可能拿到 HTML 落地页而非 JSON。
4. **列表 `content` 是摘要**：完整正文走详情 API 的 `content` 字段（HTML）。
5. **分页**：`page` 从 1 开始，用 `hasNextPage` 判断是否继续。

## 接入 Askme

后端 `FeedClient` 启动时会扫描 `skills/discovery/*-discovery/scripts/discover.py`，加载实现了 **WebsiteFeedAdapter** 的模块。

每个 skill 的 `discover.py` 需提供：

| 符号 | 说明 |
|------|------|
| `FEED_ID` | 如 `website:jiqizhixin` |
| `FEED_META` | `id`, `mpName`, `mpCover`, `mpIntro`, `status`, `source` |
| `REFRESH_DEFAULTS` | 可选，`max_pages`, `per` |
| `fetch_list_page(page, per)` | 拉取一页列表原始 JSON |
| `list_items(payload)` | 从响应中提取文章数组 |
| `has_next_page(payload)` | 是否还有下一页 |
| `normalize_list_item(item)` | 转为 `{id, title, url, published_at, author, image, summary}` |
| `fetch_article_detail(article_id)` | 返回 `{id, title, url, content_html, image, published_at, author}` |
| `normalize_article_body(raw_html, article_id=)` | 可选，站点 HTML 清洗；缺省走 backend 通用 `extract_article_html` |

通用正文 pipeline（`backend/website_feed.py` → `feed_client.py`）：

```text
fetch_article_detail → normalize_article_body（skill）→ html_to_text → article_bodies.db
```

机器之心详情 API 返回 HTML 片段，`normalize_article_body` 使用 `_lib/content_utils.clean_html_fragment` 去脚本/样式。

通用逻辑（刷新入库、列表查询、正文缓存、定时任务）在 `backend/feed/website_feed.py` + `backend/feed/feed_client.py` + `backend/feed/article_service.py`。

声明式 API 说明见 [source.yaml](source.yaml)。

```text
discovery output          → Askme article meta
title, url, published_at  → 列表展示 / 去重
summary 或 detail.content → article_body_store / RAG
```

## 失效检测

运行脚本后若 `articles` 为空或 HTTP 非 JSON，检查：

1. Referer 是否仍为 `/articles`
2. API 路径是否变更（可查 `article_library-*.js` 中的 `/api/article_library/`）
3. 更新 [source.yaml](source.yaml) 的 `last_verified_at` 与 `sample_slugs`
