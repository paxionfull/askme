---
name: zhihu-zhi-dong-xi-82-discovery
description: >-
  Discovers articles from 知乎智东西 (zhi-dong-xi-82).
  Requires ZHIHU_COOKIE for server-side access.
---

# 知乎 · 智东西

主页：https://www.zhihu.com/org/zhi-dong-xi-82/posts

## 配置

```bash
ZHIHU_COOKIE='d_c0=...; __zse_ck=...; _zap=...'
```

## 快速执行

```bash
export ZHIHU_COOKIE='...'
python .cursor/skills/zhihu-zhi-dong-xi-82-discovery/scripts/discover.py --page 1 --per 20
```

## 接入 Askme

Feed ID：`website:zhihu:zhi-dong-xi-82`

委托 `_lib/zhihu_common` 处理签名与 API。
