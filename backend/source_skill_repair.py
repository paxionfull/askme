"""修复已有 discovery skill（Cursor SDK）。"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from typing import Any

from llm import LLMError
from source_onboarding_cursor import PROJECT_ROOT, SOURCE_ONBOARDING_SKILL, _emit_status, run_cursor_skill_task
from source_onboarding_log import OnboardingSession
from source_skill_writer import load_reference_examples, skill_dir_for, validate_slug
from skill_validate import run_validation

ISSUE_TYPE_LABELS = {
    "empty_list": "列表为空或文章过少",
    "empty_body": "正文缺失或过短",
    "wrong_fields": "标题/时间/链接字段错误",
    "pagination": "分页或加载更多有问题",
    "wrong_content": "抓到了错误的内容（非目标文章）",
    "other": "其他问题",
}


def extract_url_from_error(error: str) -> str:
    """从异常文案中提取第一个 http(s) URL，用作修复样例。"""
    match = re.search(r"https?://[^\s\"'<>]+", error or "")
    if not match:
        return ""
    return match.group(0).rstrip(").,，。；;]")


def build_refresh_failure_feedback(error: str, *, slug: str = "") -> str:
    """根据接入后首拉失败错误，生成可驱动 Cursor 修复的反馈文案。

    对标人工修复路径：阅读报错 → 定位 discover.py URL/字段解析 → 修后验证。
    """
    sample = extract_url_from_error(error)
    sample_line = f"\n样例 URL（请单独验证能否解析为 article id）: {sample}" if sample else ""
    safe_slug = (slug or "SLUG").strip() or "SLUG"
    discover_cmd = (
        f"python .cursor/skills/{safe_slug}-discovery/scripts/discover.py --page 1 --per 20"
    )
    validate_cmd = f"python .cursor/skills/_lib/discovery_validate.py {safe_slug}"
    return f"""接入后首次 refresh（拉取文章列表）失败，请修复已有 discovery skill。

错误原文：
{error.strip()}{sample_line}

常见根因：
1. 列表返回了 skill 未覆盖的 URL 形态（子域名、不同路径模板）
2. URL → article_id 解析过严，遇到例外链接直接抛错导致整次 refresh 失败
3. 列表字段映射错误（缺 id/url/title）

请按以下步骤修复：
1. 复现：运行 `{discover_cmd}`
2. 检查列表里每条 url 能否被当前解析函数处理；对例外形态放宽解析，或过滤掉非文章链接
3. 修改后运行 `{validate_cmd}` 直至通过
4. 确保个别解析失败不应拖垮整次 refresh（过滤不可解析项或记录 skip）

只修改本 skill 目录内文件，不要改 slug / FEED_ID。
若本 skill 为平台级（slug 以 `-platform` 结尾），还可修改对应 `.cursor/skills/_lib/{platform}_common.py`
与 `_lib/{platform}_scaffold/`（多账号共用逻辑）；禁止新建 per-account skill 目录。"""


def build_probe_failure_feedback(
    error: str,
    *,
    slug: str = "",
    platform: str = "",
    user_type: str = "",
    user_id: str = "",
    entry_url: str = "",
    list_api_path: str = "",
) -> str:
    """平台 API 探测失败时的修复反馈（账号已登记 / 平台 skill 已就绪）。"""
    safe_slug = (slug or "SLUG").strip() or "SLUG"
    discover_cmd = (
        f"python .cursor/skills/{safe_slug}-discovery/scripts/discover.py --page 1 --per 20"
    )
    validate_cmd = f"python .cursor/skills/_lib/discovery_validate.py {safe_slug}"
    platform_hint = (platform or "").strip().lower()
    lib_hint = (
        f"`.cursor/skills/_lib/{platform_hint}_common.py` 与 `_lib/{platform_hint}_scaffold/`"
        if platform_hint
        else "对应 `_lib/*_common.py` / `_lib/*_scaffold/`"
    )
    return f"""已知平台接入探测失败，请根据报错修复**平台级** discovery skill（多账号共用）。

平台: {platform or "(unknown)"}
user_type: {user_type or "(unknown)"}
user_id: {user_id or "(unknown)"}
entry_url: {entry_url or "(unknown)"}
脚手架 list_api_path: {list_api_path or "(unknown)"}
platform skill slug: {safe_slug}

错误原文：
{error.strip()}

常见根因：
1. 列表 API 路径 / 鉴权 / Cookie / Referer 不正确
2. 账号字段（user_id / fakeid / screen_name）与页面 URL 不一致
3. 公共库解析逻辑过严

请按以下步骤修复：
1. 阅读 {lib_hint} 与 `.cursor/skills/{safe_slug}-discovery/scripts/discover.py`
2. 复现：`{discover_cmd}`
3. 优先改公共库（多账号受益）；仅当平台 skill 自身有误时改其目录
4. `{validate_cmd}` 直至通过

不要为单个账号新建 `*-discovery` 目录；不要改 platform_accounts 的 feed_id。"""


def build_validation_failure_feedback(error: str, *, slug: str = "") -> str:
    safe_slug = (slug or "SLUG").strip() or "SLUG"
    validate_cmd = f"python .cursor/skills/_lib/discovery_validate.py {safe_slug}"
    discover_cmd = (
        f"python .cursor/skills/{safe_slug}-discovery/scripts/discover.py --page 1 --per 20"
    )
    platform_note = ""
    if safe_slug.endswith("-platform"):
        platform_note = (
            "\n本 skill 为平台级：可修改本目录及对应 `_lib/*_common.py` / `_lib/*_scaffold/`；"
            "不要新建 per-account skill。"
        )
    return f"""discovery_validate 验证失败，请修复已有 discovery skill。

错误原文：
{error.strip()}

请：
1. 复现：`{discover_cmd}` 与 `{validate_cmd}`
2. 按报错修 scripts/discover.py / source.yaml（平台 skill 可改公共库）
3. 重跑验证直至通过

只修改本 skill 目录内文件，不要改 slug / FEED_ID。{platform_note}"""


async def iter_auto_repair_agent(
    *,
    slug: str,
    feedback: str,
    error: str = "",
    issue_types: list[str] | None = None,
    sample_url: str = "",
    auto_validate: bool = True,
    session: OnboardingSession | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """运行 Cursor 修复 Agent，向外抛出便于 UI 展示的 status 事件。

    成功时最后 yield {{"event": "auto_repair_succeeded"}}；失败则抛 LLMError。
    """
    from source_onboarding_cursor import load_cursor_api_key

    if not load_cursor_api_key():
        raise LLMError(
            f"失败且未配置 Cursor API Key，无法自动修复: {error or feedback[:200]}",
            status_code=400,
        )

    sample = sample_url or extract_url_from_error(error or feedback)
    repair_succeeded = False
    if session:
        session.log(
            "auto_repair_start",
            slug=slug,
            error=(error or feedback)[:1000],
            sample_url=sample,
        )

    yield {
        "event": "status",
        "phase": "auto_repair",
        "message": f"正在根据报错自动修复 skill…（{(error or feedback)[:120]}）",
    }

    try:
        async for event in run_skill_repair_agent(
            slug=slug,
            feedback=feedback,
            issue_types=issue_types or ["wrong_fields", "other"],
            sample_url=sample,
            auto_validate=auto_validate,
            session=session,
        ):
            kind = event.get("event", "status")
            if kind == "result":
                repair_succeeded = True
                yield {
                    "event": "status",
                    "phase": "auto_repair_done",
                    "message": "自动修复完成，正在重试…",
                }
            elif kind == "status":
                yield {
                    "event": "status",
                    "phase": f"auto_repair_{event.get('phase') or 'running'}",
                    "message": str(event.get("message") or "自动修复中…"),
                }
            else:
                yield event
    except Exception as repair_exc:
        if session:
            session.log("auto_repair_error", error=str(repair_exc))
        raise LLMError(
            f"自动修复未成功: {repair_exc}（原始错误: {error or feedback[:200]}）",
            status_code=502,
        ) from repair_exc

    if not repair_succeeded:
        raise LLMError(
            f"自动修复未完成（原始错误: {error or feedback[:200]}）",
            status_code=502,
        )

    if session:
        session.log("auto_repair_success", slug=slug)
    yield {"event": "auto_repair_succeeded"}


def _read_skill_file(skill_dir, rel_path: str, *, limit: int = 12000) -> str:
    path = skill_dir / rel_path
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8")
    if len(text) > limit:
        return text[:limit] + f"\n…[truncated {len(text) - limit} chars]"
    return text


def resolve_skill_entry_url(slug: str) -> str:
    skill_dir = skill_dir_for(slug)
    discover = skill_dir / "scripts" / "discover.py"
    if discover.is_file():
        text = discover.read_text(encoding="utf-8", errors="ignore")
        for pattern in (
            r'"entryUrl"\s*:\s*"([^"]+)"',
            r"'entryUrl'\s*:\s*'([^']+)'",
            r'entryUrl\s*=\s*"([^"]+)"',
            r"entryUrl\s*=\s*'([^']+)'",
        ):
            match = re.search(pattern, text)
            if match:
                return match.group(1).strip()
    return ""


def _format_issue_types(issue_types: list[str]) -> str:
    if not issue_types:
        return "（未选择）"
    lines = []
    for item in issue_types:
        key = str(item).strip()
        label = ISSUE_TYPE_LABELS.get(key, key)
        lines.append(f"- {label}")
    return "\n".join(lines)


def _current_validation_error(slug: str) -> str:
    try:
        run_validation(slug)
        return ""
    except Exception as exc:
        return str(exc)


def build_repair_prompt(
    *,
    slug: str,
    name: str,
    entry_url: str,
    feedback: str,
    issue_types: list[str],
    sample_url: str,
) -> str:
    skill_dir = skill_dir_for(slug)
    discover_py = _read_skill_file(skill_dir, "scripts/discover.py")
    source_yaml = _read_skill_file(skill_dir, "source.yaml", limit=4000)
    skill_md = _read_skill_file(skill_dir, "SKILL.md", limit=4000)
    validation_error = _current_validation_error(slug)

    skill_doc = ""
    if SOURCE_ONBOARDING_SKILL.is_file():
        skill_doc = SOURCE_ONBOARDING_SKILL.read_text(encoding="utf-8")[:4000]

    references = load_reference_examples(max_chars_per_file=2500)

    is_platform = str(slug).endswith("-platform")
    platform_id = str(slug)[: -len("-platform")] if is_platform else ""
    scope_rule = (
        f"3. **可修改** `.cursor/skills/{slug}-discovery/` 以及 "
        f"`.cursor/skills/_lib/{platform_id}_common.py`、"
        f"`_lib/{platform_id}_scaffold/`（多账号共用）；"
        f"禁止新建 per-account skill；禁止改 slug / 平台占位 FEED_ID"
        if is_platform
        else f"3. **只修改** `.cursor/skills/{slug}-discovery/` 内文件；禁止改 slug、FEED_ID、feed 目录名"
    )
    extra_constraint = (
        f"- 平台 skill：优先修 `_lib/{platform_id}_common.py`；不要为单个账号建目录\n"
        if is_platform
        else ""
    )

    return f"""你是 Askme 数据源 skill 修复 Agent。请根据用户反馈修复**已有** discovery skill，不要新建目录或修改 slug。

## 目标 skill（已存在，禁止改名/删目录）
- slug: {slug}
- name: {name}
- feed_id: website:{slug}
- entry_url: {entry_url or "(见 FEED_META)"}
- skill 目录: .cursor/skills/{slug}-discovery/
{"- 类型: 平台级 skill（多账号共用）" if is_platform else ""}

## 用户反馈
问题类型：
{_format_issue_types(issue_types)}

详细描述：
{feedback.strip()}

样例链接：{sample_url.strip() or "(无)"}

## 当前验证错误（若有）
{validation_error or "（当前可通过 discovery_validate，但仍需按用户反馈改进）"}

## 当前 source.yaml
```yaml
{source_yaml or "(无)"}
```

## 当前 discover.py
```python
{discover_py or "(缺失)"}
```

## 当前 SKILL.md（节选）
{skill_md[:2000] or "(无)"}

## 参考文档与 skill
{skill_doc}

{references}

## 任务
1. 阅读用户反馈，定位 discover.py / source.yaml / 公共库中的问题
2. 必要时用 curl/Python 重新侦察目标站 API，确认列表与正文逻辑
{scope_rule}
4. 运行验证直至通过:
   `python .cursor/skills/_lib/discovery_validate.py {slug}`
5. 若验证失败，根据报错继续修复并重跑

## 硬性约束
- discover.py 只能用 urllib/json/标准库 + `.cursor/skills/_lib`
- 禁止 import backend
- published_at 使用 ISO8601 Asia/Shanghai
- 不要删除 skill 目录；不要创建 `{slug}-discovery` 以外的目录（平台公共库除外）
{extra_constraint}
完成后用一句话说明修复内容与验证结果。"""


async def run_skill_repair_agent(
    *,
    slug: str,
    feedback: str,
    issue_types: list[str] | None = None,
    sample_url: str = "",
    auto_validate: bool = True,
    session: OnboardingSession | None = None,
) -> AsyncIterator[dict[str, Any]]:
    safe_slug = validate_slug(slug)
    skill_dir = skill_dir_for(safe_slug)
    if not skill_dir.is_dir():
        raise LLMError(f"discovery skill 不存在: {safe_slug}-discovery", status_code=404)

    discover_path = skill_dir / "scripts" / "discover.py"
    if not discover_path.is_file():
        raise LLMError(f"缺少 discover.py: {discover_path}", status_code=400)

    name = safe_slug.replace("-", " ").title()
    skill_md_path = skill_dir / "SKILL.md"
    if skill_md_path.is_file():
        from skill_md import skill_meta_from_md

        name, _ = skill_meta_from_md(skill_md_path.read_text(encoding="utf-8"), fallback_id=safe_slug)

    entry_url = resolve_skill_entry_url(safe_slug)
    if session:
        session.log(
            "repair_start",
            slug=safe_slug,
            entry_url=entry_url,
            feedback=feedback[:500],
            issue_types=issue_types or [],
        )

    yield _emit_status(session, phase="repair", message="正在准备修复任务…")

    prompt = build_repair_prompt(
        slug=safe_slug,
        name=name,
        entry_url=entry_url,
        feedback=feedback,
        issue_types=issue_types or [],
        sample_url=sample_url,
    )

    async for event in run_cursor_skill_task(
        slug=safe_slug,
        prompt=prompt,
        auto_validate=auto_validate,
        session=session,
        result_engine="cursor_sdk_repair",
        mark_files_written=False,
    ):
        if event.get("event") == "result":
            data = event.get("data") or {}
            data["repaired"] = True
            event = {**event, "data": data}
        yield event
