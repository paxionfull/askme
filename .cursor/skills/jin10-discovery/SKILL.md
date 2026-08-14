---
name: jin10-discovery
description: Discovers flash news from 金十数据 (jin10.com) via flash-api.
---

# 金十数据

入口：https://www.jin10.com/

Flash API 必须带 `x-app-id` / `x-version` 请求头。

```bash
python .cursor/skills/jin10-discovery/scripts/discover.py --page 1 --per 20
python .cursor/skills/_lib/discovery_validate.py jin10
```

Feed ID：`website:jin10`
