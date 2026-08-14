---
name: 36kr-information-ai-discovery
description: >-
  Discovers articles from 36氪 AI channel (36kr.com/information/AI/) via gateway
  subNav/flow API and article page initialState. Use when fetching updates from
  36kr.com AI information or 36Kr · AI.
---

# 36氪 · AI 发现层

从 [36氪 AI 频道](https://36kr.com/information/AI/) 拉取文章，使用官方 gateway JSON API，不依赖 RSS。

## 快速执行

```bash
# 第 1 页列表
python .cursor/skills/36kr-information-ai-discovery/scripts/discover.py --page 1 --per 20

# 单篇详情（含 HTML 正文）
python .cursor/skills/36kr-information-ai-discovery/scripts/discover.py --id 3919191329740675
```

## 发现层 API

| 用途 | 方法 | URL |
|------|------|-----|
| 文章列表 | POST | `https://gateway.36kr.com/api/mis/nav/ifm/subNav/flow` |
| 文章正文 | GET | `https://36kr.com/p/{itemId}`（解析 `window.initialState`） |

**列表请求体（首页）：**

```json
{
  "partner_id": "web",
  "timestamp": 1717000000000,
  "param": {
    "subnavType": 1,
    "subnavNick": "AI",
    "pageSize": 20,
    "pageEvent": 0,
    "pageCallback": "",
    "siteId": 1,
    "platformId": 2
  }
}
```

**翻页：** `pageEvent=1`，`pageCallback` 取上一页响应的 `data.pageCallback`；`hasNextPage` 表示是否还有下一页。

**文章 URL：** `https://36kr.com/p/{itemId}`

## 站点特性

1. 列表走 gateway API，`subnavNick=AI` 对应 `/information/AI/`。
2. `publishTime` 为毫秒时间戳。
3. 正文在文章页 `window.initialState.articleDetail.articleDetailData.data.widgetContent`（HTML 片段）。

## 接入 Askme

| 符号 | 说明 |
|------|------|
| `FEED_ID` | `website:36kr-information-ai` |
| `fetch_list_page` / `list_items` / `has_next_page` | 列表 |
| `normalize_list_item` | 统一元数据 |
| `fetch_article_detail` | 含 `content_html`；优先 hints url |
| `normalize_article_body` | 可选，`_lib/content_utils` |

声明式配置见 [source.yaml](source.yaml)。
