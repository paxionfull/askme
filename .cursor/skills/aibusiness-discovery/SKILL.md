---
name: aibusiness-discovery
description: >-
  Discovers articles for Aibusiness (aibusiness.com). The origin is protected by
  Cloudflare browser challenge, so the adapter uses stable indexed snapshots.
---

# Aibusiness 发现层

官网：[Aibusiness](https://aibusiness.com/)

## 快速执行

```bash
python .cursor/skills/aibusiness-discovery/scripts/discover.py --page 1 --per 5
python .cursor/skills/aibusiness-discovery/scripts/discover.py --id meet-gorilla-the-ai-model-that-beats-gpt-4-at-api-calls
```

## 说明

- 目标站点直接 HTTP 访问会返回 Cloudflare challenge 页面（非业务正文）。
- 适配器输出保留原始文章 URL、标题、摘要和可用正文片段，供发现层与缓存管线使用。
- 已实现 `WebsiteFeedAdapter` 所需全部接口，可通过 `discovery_validate.py` 校验。
