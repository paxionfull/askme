"""LLM Agent：针对具体网站定制 discovery skill（非模板填充）。"""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from typing import Any

from llm import LLMError, complete
from source_platform_scaffold import (
    detect_platform,
    fetch_zhihu_profile_name,
    probe_zhihu_api,
    scaffold_zhihu_files,
)
from source_recon import collect_site_evidence
from source_skill_writer import load_reference_examples, skill_dir_for, validate_slug, write_skill_files
from source_onboarding_log import OnboardingCancelled, OnboardingSession
from skill_validate import run_validation

MAX_JSON_ATTEMPTS = 4
MAX_GENERATE_ATTEMPTS = 3
MAX_REPAIR_ATTEMPTS = 5

ADAPTER_CONTRACT = """
WebsiteFeedAdapter 接口（discover.py 必须实现）：
- FEED_ID: str，格式 website:{slug}
- FEED_META: dict，含 id/mpName/mpCover/mpIntro/status/source/entryUrl
- REFRESH_DEFAULTS: dict，可选 max_pages/per
- fetch_list_page(page, per) -> dict
- list_items(payload) -> list[dict]
- has_next_page(payload) -> bool
- normalize_list_item(item) -> {id,title,url,published_at,author,image,summary}
- fetch_article_detail(article_id, **hints) -> 含 content_html；批量拉正文时 backend 会传入 url/title/published_at 等列表元数据，必须优先 resolve_detail_url / meta.get("url")，禁止为查元数据重复拉整表列表或仅靠首页第一页定位 url
- normalize_article_body(raw_html, article_id="") -> str，可选，可委托 content_utils.clean_html_fragment
- 列表项较多时：用 _lib/list_index.ListByIdIndex 建 id 索引；快讯类列表在 _request_list 时写入内存索引，fetch_article_detail 禁止每篇重拉整包列表

约束：
- 仅 urllib / json / 标准库 + skill 内 _lib（http_client、content_utils、zhihu_common 等），不要 import backend
- 所有 HTTP 必须通过 _lib/http_client（统一 5s 超时、失败重试 1 次、429/502/503 退避、页间 sleep_between_pages）；禁止 urllib.request.urlopen 与自定义 timeout
- 自行分页时在页间调用 sleep_between_pages()
- 不要使用 RSS/Atom
- 针对该网站的真实 API/HTML 结构写代码
- 从侦察证据里选真实 URL、字段名、请求头（Referer 等）
- published_at 尽量转 ISO8601（Asia/Shanghai）
"""

ANALYZE_SYSTEM = f"""你是 Askme 数据源接入 Agent 的分析模块。
根据用户提供的网站侦察证据，输出该网站专属接入方案。
{ADAPTER_CONTRACT}

只输出 JSON，不要 markdown，不要代码块：
{{
  "site_summary": "一句话描述如何抓列表和正文",
  "list_mechanism": "列表如何分页、字段从哪来",
  "detail_mechanism": "正文如何获取",
  "required_headers": ["Referer 等"],
  "quirks": ["站点特有注意事项"],
  "similar_reference": "jiqizhixin|qbitai|none"
}}"""

JSON_FIX_SYSTEM = """你上一轮的输出不是合法 JSON。请根据错误信息修正，只输出修正后的 JSON 对象，不要解释，不要 markdown。"""

GENERATE_DISCOVER_SYSTEM = f"""你是 Askme 数据源接入 Agent，负责编写 scripts/discover.py。
根据网站分析结果与侦察证据，为该网站从零编写完整 discover.py。
可参考已有 skill 风格，但 URL/字段/请求头必须匹配当前网站。

{ADAPTER_CONTRACT}

只输出一个 ```python 代码块，内含完整 discover.py（含 CLI: --page --per --id）。
不要输出 JSON，不要输出其他文件。"""

GENERATE_YAML_SYSTEM = """你是 Askme 数据源接入 Agent，负责编写 source.yaml。
根据网站信息与已生成的 discover.py，输出声明式 YAML 配置。
只输出一个 ```yaml 代码块，不要其他内容。"""

GENERATE_SKILL_SYSTEM = """你是 Askme 数据源接入 Agent，负责编写 SKILL.md。
包含 YAML frontmatter（name/description），说明如何验证、站点 quirks。
只输出 Markdown 正文（含 frontmatter），不要代码块包裹整个文件。"""

REPAIR_SYSTEM = f"""你是 Askme 数据源接入 Agent 的修复模块。
上一次运行失败，请根据错误信息修复 scripts/discover.py（必要时改 source.yaml）。

{ADAPTER_CONTRACT}

只输出 ```python 代码块（完整 discover.py）。若还需改 source.yaml，在其后再输出 ```yaml 代码块。"""


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("LLM 未返回 JSON 对象")
    return data


def _extract_fenced_code(text: str, lang: str = "") -> str:
    text = text.strip()
    if lang:
        pattern = rf"```{re.escape(lang)}\s*([\s\S]*?)```"
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()
    match = re.search(r"```(?:\w+)?\s*([\s\S]*?)```", text)
    if match:
        return match.group(1).strip()
    return text.strip()


def _extract_skill_md(text: str) -> str:
    text = text.strip()
    if text.startswith("---"):
        return text
    fence = re.search(r"```(?:markdown|md)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    if fence:
        return fence.group(1).strip()
    return text


def _emit_status(
    session: OnboardingSession | None,
    *,
    phase: str,
    message: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if session:
        session.check_cancelled()
        session.log("status", phase=phase, message=message)
    event: dict[str, Any] = {"event": "status", "phase": phase, "message": message}
    if session:
        event["job_id"] = session.job_id
    if extra:
        event.update(extra)
    return event


def _emit_analysis(session: OnboardingSession | None, data: dict[str, Any]) -> dict[str, Any]:
    if session:
        session.check_cancelled()
        session.log("analysis", data=data)
    return {"event": "analysis", "data": data, **({"job_id": session.job_id} if session else {})}


async def _llm_complete(
    system: str,
    user: str,
    llm_config: dict[str, Any] | None,
    *,
    session: OnboardingSession | None = None,
    phase: str = "llm",
) -> str:
    if session:
        session.check_cancelled()
        session.log("llm_request", phase=phase, system_chars=len(system), user_chars=len(user))
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    raw = await complete(messages, llm_config)
    if session:
        session.check_cancelled()
        session.log("llm_response", phase=phase, response_chars=len(raw))
    return raw


async def _llm_json_with_retry(
    system: str,
    user: str,
    llm_config: dict[str, Any] | None,
    *,
    phase: str = "analyze",
    session: OnboardingSession | None = None,
) -> dict[str, Any]:
    last_error = ""
    last_raw = ""
    user_content = user

    for attempt in range(MAX_JSON_ATTEMPTS):
        if session:
            session.check_cancelled()
        raw = await _llm_complete(
            JSON_FIX_SYSTEM if attempt > 0 else system,
            user_content,
            llm_config,
            session=session,
            phase=f"{phase}:{attempt + 1}",
        )
        last_raw = raw
        try:
            return _extract_json(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            last_error = str(exc)
            user_content = json.dumps(
                {
                    "phase": phase,
                    "error": last_error,
                    "instruction": "返回合法 JSON 对象",
                    "previous_response": last_raw[:12000],
                },
                ensure_ascii=False,
            )
            if attempt >= MAX_JSON_ATTEMPTS - 1:
                raise LLMError(
                    f"Agent 分析输出解析失败（已重试 {MAX_JSON_ATTEMPTS} 次）: {last_error}",
                    status_code=502,
                ) from exc

    raise LLMError(f"Agent JSON 解析失败: {last_error}", status_code=502)


async def _llm_python_with_retry(
    system: str,
    user: str,
    llm_config: dict[str, Any] | None,
    *,
    min_chars: int = 200,
    phase: str = "generate",
    session: OnboardingSession | None = None,
) -> str:
    last_error = ""
    user_content = user

    for attempt in range(MAX_GENERATE_ATTEMPTS):
        if session:
            session.check_cancelled()
        raw = await _llm_complete(
            system,
            user_content,
            llm_config,
            session=session,
            phase=f"{phase}:{attempt + 1}",
        )
        code = _extract_fenced_code(raw, "python")
        if len(code) >= min_chars and "def fetch_list_page" in code:
            return code
        last_error = f"生成的 discover.py 过短或不完整（{len(code)} 字符）"
        user_content = json.dumps(
            {
                "phase": phase,
                "error": last_error,
                "previous_response": raw[:12000],
                "instruction": "输出完整可运行的 discover.py，含 WebsiteFeedAdapter 全部接口",
            },
            ensure_ascii=False,
        )
        if attempt >= MAX_GENERATE_ATTEMPTS - 1:
            raise LLMError(
                f"Agent 生成 discover.py 失败（已重试 {MAX_GENERATE_ATTEMPTS} 次）: {last_error}",
                status_code=502,
            )

    raise LLMError(f"Agent 生成 discover.py 失败: {last_error}", status_code=502)


def _apply_file_patch(slug: str, patch_files: dict[Any, Any]) -> None:
    for rel, content in patch_files.items():
        rel_path = str(rel).lstrip("/")
        if rel_path == "discover.py":
            rel_path = "scripts/discover.py"
        target = skill_dir_for(slug) / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(str(content).strip() + "\n", encoding="utf-8")
        if rel_path.endswith("discover.py"):
            target.chmod(0o755)


def _apply_repair_response(slug: str, raw: str) -> None:
    discover_py = _extract_fenced_code(raw, "python")
    if discover_py:
        _apply_file_patch(slug, {"scripts/discover.py": discover_py})
    yaml_text = ""
    yaml_match = re.search(r"```ya?ml\s*([\s\S]*?)```", raw, flags=re.IGNORECASE)
    if yaml_match:
        yaml_text = yaml_match.group(1).strip()
        if yaml_text:
            _apply_file_patch(slug, {"source.yaml": yaml_text})


def _context_payload(
    *,
    slug: str,
    name: str,
    entry_url: str,
    evidence: dict[str, Any],
    analysis: dict[str, Any],
    references: str,
    hints: str = "",
    list_api_hint: str = "",
) -> str:
    return json.dumps(
        {
            "target": {
                "slug": slug,
                "name": name,
                "feed_id": f"website:{slug}",
                "entry_url": entry_url,
                "user_hints": hints,
                "list_api_hint": list_api_hint,
            },
            "site_analysis": analysis,
            "evidence": evidence,
            "reference_examples_note": "以下仅为风格参考，必须按当前网站证据实现",
            "reference_examples": references[:10000],
        },
        ensure_ascii=False,
        indent=2,
    )


async def _run_platform_scaffold_onboarding(
    *,
    platform,
    slug: str,
    name: str,
    auto_validate: bool,
    llm_config: dict[str, Any] | None,
    session: OnboardingSession | None = None,
) -> AsyncIterator[dict[str, Any]]:
    yield _emit_status(
        session,
        phase="detect",
        message=f"识别为已知平台：{platform.platform}（{platform.user_type}/{platform.user_id}）",
    )

    yield _emit_status(session, phase="recon", message="正在探测平台 API…")
    if session:
        session.check_cancelled()
    probe = probe_zhihu_api(platform) if platform.platform == "zhihu" else {}
    yield _emit_analysis(session, {"platform": platform.platform, "probe": probe})

    if platform.requires_cookie and not probe.get("ok"):
        detail = probe.get("error") or "平台 API 探测失败"
        if "ZHIHU_COOKIE" in detail or not probe.get("cookie_configured"):
            raise LLMError(
                "知乎接入需要先在设置页配置 ZHIHU_COOKIE（从浏览器复制 d_c0、__zse_ck 等）",
                status_code=400,
            )
        raise LLMError(f"知乎 API 探测失败: {detail}", status_code=502)

    display_name = name
    if platform.platform == "zhihu":
        display_name = probe.get("display_name") or fetch_zhihu_profile_name(platform)

    yield _emit_status(
        session,
        phase="scaffold",
        message=f"使用 {platform.platform} 模板生成 skill（{display_name}）…",
    )
    file_map = scaffold_zhihu_files(platform, display_name=display_name)

    yield _emit_status(session, phase="write", message="正在写入 skill 文件…")
    write_skill_files(slug, file_map)
    if session:
        session.mark_files_written()

    validation: dict[str, Any] | None = None
    if auto_validate:
        last_error = ""
        for attempt in range(MAX_REPAIR_ATTEMPTS):
            yield _emit_status(
                session,
                phase="validate" if attempt == 0 else "repair",
                message="正在验证 skill…"
                if attempt == 0
                else f"验证失败，自动修复中（{attempt}/{MAX_REPAIR_ATTEMPTS - 1}）…",
            )
            if session:
                session.check_cancelled()
            try:
                validation = run_validation(slug)
                if session:
                    session.log("validation", ok=True, result=validation)
                break
            except Exception as exc:
                last_error = str(exc)
                if session:
                    session.log("validation", ok=False, error=last_error, attempt=attempt + 1)
                if attempt >= MAX_REPAIR_ATTEMPTS - 1:
                    raise LLMError(
                        f"skill 验证失败（已重试 {MAX_REPAIR_ATTEMPTS - 1} 次）: {last_error}",
                        status_code=502,
                    ) from exc
                # 知乎脚手架失败时重新生成文件（确定性），不依赖 LLM
                if platform.platform == "zhihu":
                    write_skill_files(slug, scaffold_zhihu_files(platform, display_name=display_name))
                else:
                    discover_path = skill_dir_for(slug) / "scripts" / "discover.py"
                    source_path = skill_dir_for(slug) / "source.yaml"
                    repair_user = json.dumps(
                        {
                            "validation_error": last_error,
                            "current_discover_py": discover_path.read_text(encoding="utf-8"),
                            "current_source_yaml": source_path.read_text(encoding="utf-8")
                            if source_path.is_file()
                            else "",
                            "platform": platform.platform,
                            "probe": probe,
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                    repaired_raw = await _llm_complete(
                        REPAIR_SYSTEM,
                        repair_user,
                        llm_config,
                        session=session,
                        phase=f"repair:{attempt + 1}",
                    )
                    _apply_repair_response(slug, repaired_raw)

    result_data = {
        "ok": True,
        "slug": slug,
        "feed_id": platform.feed_id,
        "skill_dir": f"{slug}-discovery",
        "analysis": {
            "platform": platform.platform,
            "scaffold": True,
            "display_name": display_name,
            "probe": probe,
        },
        "validation": validation,
    }
    if session:
        session.log("result", data=result_data)
    yield {"event": "result", "data": result_data, **({"job_id": session.job_id} if session else {})}


async def run_onboarding_agent(
    *,
    slug: str,
    name: str,
    entry_url: str,
    hints: str = "",
    list_api_hint: str = "",
    llm_config: dict[str, Any] | None = None,
    auto_validate: bool = True,
    session: OnboardingSession | None = None,
) -> AsyncIterator[dict[str, Any]]:
    safe_slug = validate_slug(slug)
    if skill_dir_for(safe_slug).exists():
        raise LLMError(f"数据源 skill 已存在: {safe_slug}-discovery", status_code=400)

    platform = detect_platform(entry_url.strip())
    if platform:
        async for event in _run_platform_scaffold_onboarding(
            platform=platform,
            slug=safe_slug,
            name=name.strip(),
            auto_validate=auto_validate,
            llm_config=llm_config,
            session=session,
        ):
            yield event
        return

    yield _emit_status(session, phase="recon", message="正在收集网站证据…")
    if session:
        session.check_cancelled()
    evidence = await collect_site_evidence(
        entry_url.strip(),
        hints=hints,
        list_api_hint=list_api_hint,
    )
    if session:
        session.log("recon", evidence=evidence)

    references = load_reference_examples()
    analyze_user = _context_payload(
        slug=safe_slug,
        name=name.strip(),
        entry_url=entry_url.strip(),
        evidence=evidence,
        analysis={},
        references=references,
        hints=hints,
        list_api_hint=list_api_hint,
    )

    yield _emit_status(session, phase="analyze", message="Agent 正在分析网站结构…")
    analysis = await _llm_json_with_retry(
        ANALYZE_SYSTEM,
        analyze_user,
        llm_config,
        phase="analyze",
        session=session,
    )
    yield _emit_analysis(session, analysis)

    ctx = _context_payload(
        slug=safe_slug,
        name=name.strip(),
        entry_url=entry_url.strip(),
        evidence=evidence,
        analysis=analysis,
        references=references,
        hints=hints,
        list_api_hint=list_api_hint,
    )

    yield _emit_status(session, phase="generate", message="Agent 正在编写 discover.py…")
    discover_py = await _llm_python_with_retry(
        GENERATE_DISCOVER_SYSTEM,
        ctx,
        llm_config,
        session=session,
    )

    yield _emit_status(session, phase="generate", message="Agent 正在编写 source.yaml…")
    yaml_raw = await _llm_complete(
        GENERATE_YAML_SYSTEM,
        ctx + "\n\n已生成的 discover.py:\n```python\n" + discover_py[:6000] + "\n```",
        llm_config,
        session=session,
        phase="generate_yaml",
    )
    source_yaml = _extract_fenced_code(yaml_raw, "yaml") or yaml_raw.strip()

    yield _emit_status(session, phase="generate", message="Agent 正在编写 SKILL.md…")
    skill_raw = await _llm_complete(
        GENERATE_SKILL_SYSTEM,
        ctx,
        llm_config,
        session=session,
        phase="generate_skill_md",
    )
    skill_md = _extract_skill_md(skill_raw)

    file_map = {
        "scripts/discover.py": discover_py,
        "source.yaml": source_yaml,
        "SKILL.md": skill_md,
    }

    yield _emit_status(session, phase="write", message="正在写入 skill 文件…")
    write_skill_files(safe_slug, file_map)
    if session:
        session.mark_files_written()

    validation: dict[str, Any] | None = None
    if auto_validate:
        last_error = ""
        for attempt in range(MAX_REPAIR_ATTEMPTS):
            yield _emit_status(
                session,
                phase="validate" if attempt == 0 else "repair",
                message="正在验证 skill…"
                if attempt == 0
                else f"验证失败，Agent 自动修复中（{attempt}/{MAX_REPAIR_ATTEMPTS - 1}）…",
            )
            if session:
                session.check_cancelled()
            try:
                validation = run_validation(safe_slug)
                if session:
                    session.log("validation", ok=True, result=validation)
                break
            except Exception as exc:
                last_error = str(exc)
                if session:
                    session.log("validation", ok=False, error=last_error, attempt=attempt + 1)
                if attempt >= MAX_REPAIR_ATTEMPTS - 1:
                    raise LLMError(
                        f"skill 验证失败（已自动修复 {MAX_REPAIR_ATTEMPTS - 1} 次）: {last_error}",
                        status_code=502,
                    ) from exc
                discover_path = skill_dir_for(safe_slug) / "scripts" / "discover.py"
                source_path = skill_dir_for(safe_slug) / "source.yaml"
                repair_user = json.dumps(
                    {
                        "validation_error": last_error,
                        "current_discover_py": discover_path.read_text(encoding="utf-8"),
                        "current_source_yaml": source_path.read_text(encoding="utf-8")
                        if source_path.is_file()
                        else "",
                        "site_analysis": analysis,
                        "evidence": evidence,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                repaired_raw = await _llm_complete(
                    REPAIR_SYSTEM,
                    repair_user,
                    llm_config,
                    session=session,
                    phase=f"repair:{attempt + 1}",
                )
                _apply_repair_response(safe_slug, repaired_raw)

    result_data = {
        "ok": True,
        "slug": safe_slug,
        "feed_id": f"website:{safe_slug}",
        "skill_dir": f"{safe_slug}-discovery",
        "analysis": analysis,
        "validation": validation,
    }
    if session:
        session.log("result", data=result_data)
    yield {"event": "result", "data": result_data, **({"job_id": session.job_id} if session else {})}
