---
name: ithome-discovery
description: >-
  Discovers articles from IT之家 (ithome.com) via json/newslist API and
  getmorenews cursor pagination, with newscontent detail HTML. Use when
  fetching updates from ithome.com or IT之家.
---

# IT之家发现层

从 [IT之家](https://www.ithome.com) 拉取新闻列表与正文，不依赖 RSS。

## 快速执行

```bash
python .cursor/skills/ithome-discovery/scripts/discover.py --page 1 --per 20
python .cursor/skills/ithome-discovery/scripts/discover.py --id 976680
```

## 发现层 API

| 用途 | 方法 | URL |
|------|------|-----|
| 最新列表 | GET | `https://api.ithome.com/json/newslist/news` |
| 加载更多 | POST | `https://www.ithome.com/getmorenews?ot={unix_ms}` |
| 文章详情 | GET | `https://api.ithome.com/json/newscontent/{newsid}` |

**要点：**

- 列表取 `newslist[]`（`newsid` / `title` / `postdate` / `description` / `image` / `url`）
- 分页 cursor `ot` 为文章 `orderdate` 的 **Unix 毫秒**；勿传 ISO 字符串
- 详情正文在 `detail`（HTML）；作者多在 `newsauthor`
- 文章路径：`/0/{newsid//1000}/{newsid%1000:03d}.htm`

## 接入 Askme

`FEED_ID` = `website:ithome`。实现 WebsiteFeedAdapter：`fetch_list_page` / `list_items` / `has_next_page` / `normalize_list_item` / `fetch_article_detail` / `normalize_article_body`。
