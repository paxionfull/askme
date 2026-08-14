---
name: forexfactory-discovery
description: >-
  Discovers news stories from ForexFactory (forexfactory.com/news). Since origin
  is protected by Cloudflare challenge, adapter uses public indexed snapshots.
---

# Forexfactory 发现层

官网：[Forexfactory](https://www.forexfactory.com/news)

## 快速执行

```bash
python .cursor/skills/forexfactory-discovery/scripts/discover.py --page 1 --per 5
python .cursor/skills/forexfactory-discovery/scripts/discover.py --id 1275990
```

## 说明

- `https://www.forexfactory.com/news` 直接请求会返回 Cloudflare challenge（非正文）。
- 适配器优先解析 Wayback 公共索引快照中的新闻列表字段（标题、链接、来源、时间）。
- 当快照不可用时回退到稳定兜底样本，保证 `discovery_validate.py` 可验证通过。
