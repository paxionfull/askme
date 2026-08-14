---
name: cls-discovery
description: Discovers flash telegraphs from 财联社 (cls.cn) via signed roll API and detail __NEXT_DATA__.
---

# 财联社

入口：https://www.cls.cn/（发现层使用电报页 https://www.cls.cn/telegraph）

列表：`GET /v1/roll/get_roll_list`（需 `sign`：MD5(SHA1(sorted query))）  
详情：`https://www.cls.cn/detail/{id}` 解析 `__NEXT_DATA__`

```bash
python .cursor/skills/cls-discovery/scripts/discover.py --page 1 --per 20
python .cursor/skills/_lib/discovery_validate.py cls
```

Feed ID：`website:cls`
