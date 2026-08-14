---
name: deepseek-discovery
description: Discovers articles from deepseek.ai/blog via Supabase REST blog_posts API.
---

# Deepseek Discovery Skill

## 站点信息

- Name: Deepseek
- Slug: `deepseek`
- Feed ID: `website:deepseek`
- Entry URL: `https://deepseek.ai/blog`

## 侦察证据（非 RSS）

1. `https://deepseek.ai/blog` 返回 SPA 壳页面，正文与列表不在静态 HTML。
2. 前端 bundle `https://deepseek.ai/assets/index-BanDFRVJ.js` 明确包含：
   - Supabase 项目：`https://fnlfrdinxtwkhzbmyawv.supabase.co`
   - 列表查询：`from("blog_posts").select("id, title, slug, excerpt, category, published_at").eq("status","published").order("published_at",{ascending:!1})`
   - 详情查询：`from("blog_posts").select("*").eq("slug", t).eq("status","published").maybeSingle()`
3. 用 REST 复现成功：
   - 列表：`GET /rest/v1/blog_posts?select=...&status=eq.published&order=published_at.desc&limit=5&offset=0`
   - 详情：`GET /rest/v1/blog_posts?select=*&slug=eq.{slug}&status=eq.published&limit=1`

## 实现说明

- `scripts/discover.py` 使用 `urllib + json` 访问 Supabase REST。
- 统一将 `published_at` 转换为 `Asia/Shanghai` 的 ISO8601。
- 列表 `id` 使用 `slug`，便于详情接口直接按 slug 查询。
- 正文字段使用 `content`，并通过 `content_utils.clean_html_fragment` 做清洗。

## 验证

运行：

`python .cursor/skills/_lib/discovery_validate.py deepseek`

期望：

- 列表可返回多条文章；
- 能抓取第一篇详情；
- `content_html` 非空；
- 校验输出 `ok: true`。
