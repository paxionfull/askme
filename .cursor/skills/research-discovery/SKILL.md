---
name: research-discovery
description: Discovers posts from Google Research Blog (research.google/blog) via HTML pagination and article detail parsing.
---

# Research Discovery

适用于 Google Research Blog：`https://research.google/blog/`。

## 数据来源

- 列表页：`/blog/?page={n}`（服务端渲染 HTML）
- 正文页：`/blog/{slug}/`

## 解析策略

1. 列表页仅提取 `glue-card--blog` 卡片，过滤其它导航链接。
2. 用 `data-page` 提取总页数，判断 `has_next_page`。
3. 详情页从 `basic-hero--blog-detail__description` 提取日期和作者。
4. 正文聚合 `rich-text --mode-standalone` 区块，输出 `content_html`。

## 字段约定

- `id`: 文章 slug（`/blog/{slug}/`）
- `title`: 卡片标题/文章 H1
- `url`: 详情链接
- `published_at`: 转为 `Asia/Shanghai` 的 ISO8601
- `author`: 详情页作者行，缺失时回退 `Google Research`
- `content_html`: 详情正文 HTML
