---
name: federalreserve-discovery
description: Discovers Federal Reserve recent postings from HTML event list and fetches article detail pages.
---

# Federal Reserve Discovery Skill

- Feed ID: `website:federalreserve`
- Entry URL: `https://www.federalreserve.gov/`
- List source: `https://www.federalreserve.gov/recentpostings.htm`

## Notes

1. 列表源使用 Recent Postings 页面 HTML（`eventlist`），避免 RSS/Atom。
2. 列表项为全站更新聚合，按页面顺序切片分页。
3. 详情页优先抽取 `div#article` 作为正文，结构异常时回退整页 HTML，保障可用性。
