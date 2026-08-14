---
name: zhihu-xinziyuan-discovery
description: >-
  Discovers articles from 知乎机构号 新智元 (xin-zhi-yuan-88-3).
  Requires ZHIHU_COOKIE for server-side access.
---

# 知乎 · 新智元

主页：https://www.zhihu.com/people/xin-zhi-yuan-88-3/posts

## 配置

```bash
ZHIHU_COOKIE='d_c0=...; __zse_ck=...; _zap=...'
```

## 快速执行

```bash
export ZHIHU_COOKIE='...'
python .cursor/skills/zhihu-xinziyuan-discovery/scripts/discover.py --page 1 --per 20
```

## 接入 Askme

Feed ID：`website:zhihu:xinziyuan`

| 符号 | 说明 |
|------|------|
| `fetch_article_detail(article_id)` | 委托 `_lib/zhihu_common.fetch_article_by_id` |
| `normalize_article_body(raw_html)` | 委托 `_lib/zhihu_common`，去除知乎卡片链接等 |

正文 pipeline 在 backend；签名与 API 在 `_lib/zhihu_common.py`。
