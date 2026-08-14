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

### 接入中 / 接入后自动修复

任一步失败且已启用 `auto_repair`（默认 true）时，系统会用 Cursor Agent **按报错迭代修复**：

1. **API 探测失败**（知乎/金十等脚手架）：先写入脚手架 skill，再 repair → 重探
2. **discovery_validate 失败**：repair → 再验证（最多数次）
3. **首拉 refresh 失败**：repair → reload-skills → 再拉一次

仍失败才标记该源接入失败（skill 文件通常保留，可手动「反馈并修复」）。

可通过请求体 `auto_repair: false` 关闭。缺 Cursor API Key 时无法走 Agent 修复（探测/首拉会给出明确提示）。

例外：未配置 `ZHIHU_COOKIE` 属于用户配置问题，不会触发自动修复。

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

### HTTP 与反爬（强制，所有分组 / 新数据源统一）

- **所有对外 HTTP 请求**必须通过 `_lib/http_client.py`（`fetch_text` / `fetch_json` / `fetch_bytes` 等）
- **禁止**在 discover.py 里直接 `urllib.request.urlopen` 或自定义 `timeout=`
- 统一超时：**5 秒**（`REQUEST_TIMEOUT_SECONDS=5`，http_client 忽略覆盖）；失败自动重试 1 次，对 429/502/503 指数退避
- 脚本内自行分页循环时，页间应调用 `sleep_between_pages()`
- `website_feed.refresh_feed` 在分页之间也会自动等待（约 0.8s + 抖动）
- 验证脚本 `discovery_validate.py` 会拒绝未走 http_client 或自带 timeout 的 skill

```python
from http_client import fetch_json, fetch_text, sleep_between_pages
```

## 正文 pipeline

```text
fetch_list_page → normalize_list_item（含 url/title/…）
批量拉正文 → fetch_article_detail(article_id, **hints)  # hints 来自列表元数据
→ normalize_article_body（skill）→ html_to_text → cache
```

### fetch_article_detail 与 hints（强制）

批量拉正文时，backend 会把列表里已有的 `url` / `title` / `published_at` / `author` / `image` / `summary` 作为 `**hints` 传入：

```python
from detail_hints import pick_hints, resolve_detail_url

def fetch_article_detail(article_id: str, **hints) -> dict:
    meta = pick_hints(**hints)
    url = resolve_detail_url(article_id, **hints) or ...  # 有 hints.url 时禁止再拉整表列表
```

- 签名必须包含 `**hints`（或 `**kwargs`）
- **禁止**在 `fetch_article_detail` 里为查 url/title 而重复请求整页列表 API，或对 sitemap 全量做线性扫描
- **禁止**仅靠首页/第一页列表做 `nid -> path` 映射；批量拉正文时 backend 会传入列表已入库的 `url`
- `discovery_validate.py` 会对有 `url` 的列表项用 hints 实测 `fetch_article_detail`；内联 `fetch_list_page` 且未用 hints 会直接报错
- 大列表 / sitemap：用 `_lib/list_index.py` 的 `ListByIdIndex` 在 `_collect_items` 时建 O(1) 索引
- 快讯 API（如金十）：在 `_request_list` 时把条目写入 `id -> item` 内存索引，详情优先读索引，必要时再分页查找

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
