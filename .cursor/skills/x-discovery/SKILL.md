---
name: x-discovery
description: >-
  Discovers posts from X user timelines (x.com/{screen_name}) via Nitter mirrors
  (quotes/replies) plus GraphQL guest UserTweets and syndication fallback. Use
  when fetching updates from x.com or Twitter profile pages.
---

# X Discovery

抓取 X（原 Twitter）用户主页帖子列表与正文。当前目标账号：`@elonmusk`。

## 快速执行

```bash
python .cursor/skills/x-discovery/scripts/discover.py --page 1 --per 5
python .cursor/skills/x-discovery/scripts/discover.py --id 1518623997054918657
```

## 数据来源

1. **Nitter 镜像**（优先）：`xcancel.com/{screen_name}` 与 `/with_replies`（可用时）— 保留对他人帖子的 **引用 (quote)** 与 **回复 (reply)** 上下文
2. GraphQL guest：`UserByScreenName` → `UserTweetsAndReplies`（软失败）→ `UserTweets`
3. 回退 syndication：`syndication.twitter.com/.../timeline-profile`
4. 详情：`cdn.syndication.twimg.com/tweet-result`（含 `quoted_tweet` / `parent`）
5. 最终兜底：内置公开样本（非 RSS）

## 实现要点

- 不使用 RSS/Atom。
- `published_at` 统一为 `Asia/Shanghai` ISO8601。
- 引用/回复会并入 title、summary 与正文 HTML（blockquote），避免短回应丢失语境。
- 多源按 id 去重后按发布时间倒序，再客户端分页。
