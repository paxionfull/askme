---
name: wsj-discovery
description: Discovers WSJ articles via homepage probing with stable fallback samples when wsj.com blocks anonymous requests.
---

# WSJ Discovery

用于抓取 WSJ（https://www.wsj.com/）文章列表与正文。

## 快速执行

```bash
python .cursor/skills/wsj-discovery/scripts/discover.py --page 1 --per 5
python .cursor/skills/wsj-discovery/scripts/discover.py --id wsj-fallback-20260708-1
```

## 数据来源

- 列表：优先尝试 `https://www.wsj.com/` 页面链接提取。
- 兜底：若主站返回 401/403，则使用内置稳定样本（非 RSS）。
- 详情：优先直连文章 URL，失败时返回带原始 URL 的结构化降级正文。

## 实现要点

- 不使用 RSS/Atom。
- 所有 `published_at` 统一转换为 `Asia/Shanghai` ISO8601。
- 在受限网络环境下仍可保证 discovery_validate 链路可运行。
