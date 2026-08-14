---
name: source-onboarding
description: >-
  Onboards a new website into Askme using Cursor SDK Agent (or deterministic
  scaffold for known platforms). Writes a custom *-discovery skill — not RSS,
  not template fill. Use when adding a new website data source.
---

# 数据源接入（Cursor SDK）

Askme 通过 **Cursor SDK** 为**具体网站**编写 discovery skill，而不是内部 LLM Agent 或固定模板填充。

## 原则

1. **用户只提供网站链接**；名称与 slug 由系统从域名自动推导
2. **先看网站证据**：入口页、API 响应样本
3. **再写专属代码**：URL、字段、Referer、分页逻辑必须来自该站
4. **可参考已有 skill**（jiqizhixin、qbitai、zhihu）的**风格**，不可照搬 URL/字段
5. **禁止 RSS/Atom**
6. 验证失败时由 Cursor Agent **自行修复** discover.py 并重跑

## 自动化流程（UI / API）

### 已知平台（知乎、金十等）— 确定性脚手架

无需 Cursor API Key。

```text
detect_platform（识别 zhihu people/org、jin10.com 等）
  → probe API（知乎需 ZHIHU_COOKIE）
  → scaffold 模板填充 discover.py / source.yaml / SKILL.md
  → write → validate
```

Playbook 示例：`data/onboarding-playbooks/zhihu-people-khazix.md`

### 未知站点 — Cursor SDK Agent

需在 **设置页** 配置 **Cursor API Key**（`CURSOR_API_KEY` 或 `data/integrations.json`）。

```text
AsyncClient.launch_bridge(workspace=项目根)
  → agents.create(model="auto", local.setting_sources=["project"])
  → agent.send(接入 prompt)
  → 流式 tool_call / status
  → run.wait()
  → discovery_validate.py
  → reload feeds
```

接入任务在**后台**运行，可切换 tab；进度显示在顶部横幅，可随时点击「停止」取消（调用 `run.cancel()`）。

日志写入 `data/onboarding-logs/{job_id}.jsonl`：

- `GET /api/sources/onboard/logs`
- `GET /api/sources/onboard/logs/{job_id}`
- `POST /api/sources/onboard/cancel` body: `{ "job_id": "..." }`

### API

```bash
# SSE 流式（不再需要 llm_config）
POST /api/sources/onboard
{
  "entry_url": "https://example.com/articles",
  "stream": true
}
```

SSE 事件：`status` · `result` · `done` · `error`

Cursor API Key 管理：

- `GET /api/settings/cursor-api-key`
- `PUT /api/settings/cursor-api-key` body: `{ "api_key": "cur_..." }`

### 验证

```bash
python .cursor/skills/_lib/discovery_validate.py {slug}
```

## 在 Cursor IDE 中手动执行（无 UI 时）

1. 阅读用户给的 URL，用浏览器/Network 或 curl 收集列表 API、详情 API、样例 JSON
2. 阅读 `.cursor/skills/jiqizhixin-discovery/` 等作为参考
3. 创建 `.cursor/skills/{slug}-discovery/scripts/discover.py`，实现 WebsiteFeedAdapter
4. 写 `source.yaml`、`SKILL.md`
5. 运行 `discovery_validate.py`
6. `POST /api/feeds/reload-skills`

## discover.py 接口

| 符号 | 说明 |
|------|------|
| `FEED_ID` | `website:{slug}` |
| `FEED_META` | mpName、entryUrl 等 |
| `fetch_list_page` / `list_items` / `has_next_page` | 列表 |
| `normalize_list_item` | 统一元数据 |
| `fetch_article_detail` | 含 content_html |
| `normalize_article_body` | 可选，`_lib/content_utils` |

## 正文 pipeline

```text
fetch_article_detail → normalize_article_body（skill）→ html_to_text → cache
```

backend 通用逻辑：`website_feed.py` · `feed_client.py`

## 后端实现

- `backend/source_onboarding_cursor.py` — Cursor SDK 接入入口
- `backend/source_platform_onboard.py` — 已知平台脚手架
- `backend/source_platform_scaffold.py` — 平台探测与模板

安装依赖：

```bash
cd backend && pip install --only-binary=cursor-sdk "cursor-sdk>=0.1.0"
```

## 不支持自动接入的场景

- 需 Cookie/复杂签名（知乎）→ 设置页配置 Cookie + 脚手架
- 强反爬需浏览器渲染 → 需人工介入
