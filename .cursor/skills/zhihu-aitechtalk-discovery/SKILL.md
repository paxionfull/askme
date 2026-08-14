---
name: zhihu-aitechtalk-discovery
description: >-
  Discovers articles from 知乎用户 AI科技评论 (aitechtalk).
  Requires ZHIHU_COOKIE for server-side access.
---

# 知乎 · AI科技评论

主页：https://www.zhihu.com/people/aitechtalk/posts

## 配置

知乎服务端访问需要浏览器 Cookie，在 `.env` 或环境变量中设置：

```bash
ZHIHU_COOKIE='d_c0=...; __zse_ck=...; _zap=...'
```

从浏览器登录知乎后，在 DevTools → Network 任意请求中复制 `Cookie` 请求头。

## 快速执行

```bash
export ZHIHU_COOKIE='...'
python .cursor/skills/zhihu-aitechtalk-discovery/scripts/discover.py --page 1 --per 20
```

## 接入 Askme

由 `FeedClient` 自动加载，Feed ID：`website:zhihu:aitechtalk`

| 符号 | 说明 |
|------|------|
| `fetch_article_detail(article_id)` | 委托 `_lib/zhihu_common.fetch_article_by_id` |
| `normalize_article_body(raw_html)` | 委托 `_lib/zhihu_common`，去除知乎卡片链接等 |

正文 pipeline 在 backend；签名与 API 在 `_lib/zhihu_common.py`。
