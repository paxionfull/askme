---
name: source-onboarding
description: >-
  Create or repair Askme website discovery skills (*-discovery / *-platform-discovery).
  ALWAYS use this skill when onboarding a new site from a URL, implementing
  WebsiteFeedAdapter, writing discover.py / source.yaml / SKILL.md, fixing
  discovery_validate or refresh failures, login/cookie ASKME_AUTH_REQUIRED, or
  http_client / hints / list_index rules. Prefer this over any existing
  *-discovery skill. Do NOT use site-specific *-discovery skills as onboarding
  guides — those are only for fetching that one site. Not for day-to-day
  fetching of an already-onboarded source.
---

# 数据源接入（source-onboarding）

Askme 为**具体网站**编写 discovery skill（Cursor Agent / SDK），不是 RSS，不是模板填空。

**动手前必读契约：** [CONTRACT.md](CONTRACT.md)（接口、HTTP、hints、登录墙）。违反契约则 pipeline 无法复用。

## 原则

1. 用户通常只提供网站链接；名称与 slug 由系统从域名推导（任务 prompt 会给出最终 slug）
2. 先看网站证据（入口页、API 样本），再写专属代码；URL/字段/Referer/分页必须来自该站
3. **参考已有 discovery skill（强制）**：从 `.cursor/skills/*-discovery/` 中自选样例（见下节），学结构与 `_lib` 用法，**不可照搬** URL/字段
4. **禁止 RSS/Atom**
5. 验证失败则自行修复并重跑 `discovery_validate.py`

## 如何选参考 skill（强制，至少 2 个）

仓库内已有站级 / 平台级 discovery（含内置与用户接入的）都是合法参考；**不要**另找 playbook 目录。

1. 浏览 `.cursor/skills/` 下名称以 `-discovery` 结尾的目录（跳过本 skill `source-onboarding`，跳过无完整 `scripts/discover.py` 的残缺目录）
2. 根据侦察结果（JSON API / HTML 列表 / sitemap / 需 Cookie 等）选出 **至少 2 个**形态最接近的 skill
3. 若目标站已有同站或同平台 skill，优先列入参考
4. 打开其 `scripts/discover.py`、`source.yaml`（必要时 `SKILL.md`），只学：
   - WebsiteFeedAdapter 组织方式
   - `http_client` / `detail_hints` / `list_index` / `auth_cookie` 用法
5. **禁止**复制其 API URL、字段路径、Referer、假数据；字段必须来自目标站证据

## 未知站 — 任务步骤

1. 用 curl / Python 侦察真实列表与正文 API
2. 阅读 [CONTRACT.md](CONTRACT.md)
3. 按上节选 ≥2 个参考 skill 并阅读
4. 创建 `.cursor/skills/{slug}-discovery/`：
   - `scripts/discover.py`（完整 WebsiteFeedAdapter）
   - `source.yaml`、`SKILL.md`（description 只描述本站，勿写成通用接入指南）
5. 运行：`python .cursor/skills/_lib/discovery_validate.py {slug}`
6. 失败则按报错修到通过；完成后一句话说明 `feed_id` 与验证结果（若停在 `ASKME_AUTH_REQUIRED`，写出 slot）

IDE 手动接入同样遵循上述步骤；完成后可 `POST /api/feeds/reload-skills`。

## 修复已有 discovery skill

1. 先加载本 skill + [CONTRACT.md](CONTRACT.md)，**不得破坏契约**
2. 按用户反馈 / 验证报错定位 `discover.py` / `source.yaml`（平台 skill 优先 `_lib/{platform}_common.py`）
3. 必要时再打开 1～2 个相近 `*-discovery` 对照实现，仍禁止照搬 URL/字段
4. 站级：只改 `.cursor/skills/{slug}-discovery/`；禁止改 slug、`FEED_ID`、删目录
5. 平台级（slug 以 `-platform` 结尾）：可改平台 skill 与对应 `_lib`；禁止新建 per-account skill
6. 跑通 `discovery_validate.py`

## 已知平台（系统侧确定性接入）

多账号平台由 backend `detect_platform` + `platform_registry` 走脚手架，**不**为每个号新建目录：

```text
detect → 缺 Cookie 则 ASKME_AUTH_REQUIRED → probe → platform_accounts + 平台 skill → validate
```

- 一平台一个 skill：`.cursor/skills/{platform}-platform-discovery/`
- 同构：`SKILL.md` + `source.yaml`（`platform_skill: true`）+ 真实 `discover.py`（`require_account()` + `boundPlatformAdapter`）
- 金十仍为单例 `jin10-discovery`
- 缺 Cookie **不**触发 auto_repair；须用户授权

平台 skill 文件要求与运行时约定亦须满足 [CONTRACT.md](CONTRACT.md) 的接口/HTTP/鉴权规则。

## 自动化与 API（产品说明）

需配置 Cursor API Key（`CURSOR_API_KEY` 或 `data/integrations.json`）。SDK 使用 `local.setting_sources=["project"]`，以便发现本 skill。

```text
agents.create → agent.send(短任务 prompt，须遵循本 skill)
  → discovery_validate → reload feeds
```

失败且 `auto_repair` 时按报错迭代修平台/站级 skill；`ASKME_AUTH_REQUIRED` 不走自动修复。

- `POST /api/sources/onboard`（SSE）
- 日志：`data/onboarding-logs/{job_id}.jsonl`
- 后端入口：`backend/onboarding/source_onboarding_cursor.py`、`source_platform_onboard.py`、`platform_registry.py`
