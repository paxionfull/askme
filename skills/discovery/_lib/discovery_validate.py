#!/usr/bin/env python3
"""验证 *-discovery skill：列表 + 详情 + 正文。"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

SKILLS_ROOT = Path(__file__).resolve().parent.parent
DISCOVER_SCRIPT = Path("scripts") / "discover.py"
MIN_LIST_ITEMS = 1
MIN_BODY_CHARS = 80
_DETAIL_HINTS_TOKENS = (
    "pick_hints",
    "resolve_detail_url",
    "detail_hints",
    'meta.get("url"',
    "meta.get('url'",
    'hints.get("url"',
    "hints.get('url'",
)


def _function_body(script_text: str, func_name: str) -> str:
    pattern = rf"def\s+{re.escape(func_name)}\s*\([^)]*\)[^\n]*:\n"
    match = re.search(pattern, script_text)
    if not match:
        return ""
    lines: list[str] = []
    for line in script_text[match.end() :].splitlines():
        if line and not line[0].isspace():
            break
        lines.append(line)
    return "\n".join(lines)


def _check_fetch_article_detail_hints(script_text: str) -> None:
    body = _function_body(script_text, "fetch_article_detail")
    if not body:
        return
    uses_list = "fetch_list_page" in body
    uses_hints = any(token in body for token in _DETAIL_HINTS_TOKENS)
    if uses_list and not uses_hints:
        raise ValueError(
            "fetch_article_detail 内直接调用 fetch_list_page 定位 url，但未使用 hints："
            "须 from detail_hints import pick_hints, resolve_detail_url，"
            "优先 resolve_detail_url(article_id, **hints) 或 meta.get('url')"
        )
    # 有列表回退时也必须先读 hints.url，避免批量拉正文重复扫表
    if uses_list and uses_hints:
        if not any(
            token in body
            for token in (
                "resolve_detail_url",
                'hints.get("url"',
                "hints.get('url'",
                'meta.get("url"',
                "meta.get('url'",
                "pick_hints",
            )
        ):
            raise ValueError(
                "fetch_article_detail 调用了 fetch_list_page，但未见优先读取 hints.url；"
                "请先 resolve_detail_url / pick_hints，仅在无 url 时再回退列表"
            )


def _fetch_detail_without_list_scan(module, sample_id: str, hint_payload: dict) -> dict:
    """有 hints.url 时禁止再打 fetch_list_page（运行时守卫）。"""
    original = module.fetch_list_page
    calls: list[tuple] = []

    def _guarded(*args, **kwargs):
        calls.append((args, kwargs))
        return original(*args, **kwargs)

    module.fetch_list_page = _guarded  # type: ignore[method-assign]
    try:
        detail = module.fetch_article_detail(sample_id, **hint_payload)
    finally:
        module.fetch_list_page = original  # type: ignore[method-assign]
    if calls:
        raise ValueError(
            "fetch_article_detail 在已提供 hints.url 时仍调用了 fetch_list_page；"
            "批量拉正文会传入列表 url，须优先使用 resolve_detail_url / meta['url']，"
            "禁止为定位正文再拉整表列表"
        )
    return detail

def _load_module(skill_dir: Path):
    script = skill_dir / DISCOVER_SCRIPT
    if not script.is_file():
        raise FileNotFoundError(f"缺少 discover.py: {script}")

    lib_root = SKILLS_ROOT / "_lib"
    for path in (lib_root, SKILLS_ROOT):
        path_str = str(path)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)

    module_name = f"askme_validate_{skill_dir.name.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(module_name, script)
    if spec is None or spec.loader is None:
        raise ImportError(f"无法加载 {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _requires_cookie_for(skill_dir: Path) -> bool:
    source_yaml = skill_dir / "source.yaml"
    if not source_yaml.is_file():
        return False
    text = source_yaml.read_text(encoding="utf-8")
    return bool(re.search(r"requires_cookie\s*:\s*true", text, re.I))


def _min_body_chars_for(skill_dir: Path) -> int:
    source_yaml = skill_dir / "source.yaml"
    if not source_yaml.is_file():
        return MIN_BODY_CHARS
    text = source_yaml.read_text(encoding="utf-8")
    match = re.search(r"^\s*min_body_chars:\s*(\d+)\s*$", text, re.MULTILINE)
    if match:
        return max(1, int(match.group(1)))
    return MIN_BODY_CHARS


def _is_x_platform_skill(skill_dir: Path) -> bool:
    source_yaml = skill_dir / "source.yaml"
    if not source_yaml.is_file():
        return skill_dir.name == "x-platform-discovery"
    text = source_yaml.read_text(encoding="utf-8")
    if re.search(r"^\s*platform:\s*x\s*$", text, re.MULTILINE | re.I):
        return True
    return skill_dir.name == "x-platform-discovery"


def _is_platform_skill(skill_dir: Path) -> bool:
    source_yaml = skill_dir / "source.yaml"
    if not source_yaml.is_file():
        return False
    text = source_yaml.read_text(encoding="utf-8")
    return bool(re.search(r"^\s*platform_skill:\s*true\s*$", text, re.MULTILINE))


def _platform_id_from_slug(slug: str) -> str:
    text = (slug or "").strip().lower()
    if text.endswith("-platform"):
        return text[: -len("-platform")]
    return text


def _load_registry_platform_account(platform: str) -> dict | None:
    """从仓库 data/feed_registry.json 取一个同平台账号，供本地 discovery_validate 绑定。"""
    registry = SKILLS_ROOT.parent.parent / "data" / "feed_registry.json"
    if not registry.is_file():
        return None
    try:
        data = json.loads(registry.read_text(encoding="utf-8"))
    except Exception:
        return None
    accounts = data.get("platform_accounts") if isinstance(data, dict) else None
    if not isinstance(accounts, dict):
        return None
    plat = (platform or "").strip().lower()
    for account in accounts.values():
        if not isinstance(account, dict):
            continue
        if str(account.get("platform") or "").strip().lower() == plat:
            return dict(account)
    return None


def validate_skill(slug: str, *, min_items: int = MIN_LIST_ITEMS) -> dict:
    skill_dir = SKILLS_ROOT / f"{slug}-discovery"
    if not skill_dir.is_dir():
        raise FileNotFoundError(f"未找到 skill 目录: {skill_dir.name}")

    script = skill_dir / DISCOVER_SCRIPT
    script_text = script.read_text(encoding="utf-8")
    detail_sig = re.search(r"def\s+fetch_article_detail\s*\([^)]*\)", script_text)
    if detail_sig and "**" not in detail_sig.group(0):
        raise ValueError(
            "discover.py 的 fetch_article_detail 必须接受 **hints；"
            "批量拉正文会传入 url/title 等列表元数据，详见 _lib/detail_hints.py"
        )
    if "urllib.request.urlopen" in script_text:
        raise ValueError(
            "discover.py 禁止直接使用 urllib.request.urlopen；"
            "请通过 _lib/http_client 发请求（统一 5s 超时、重试与 429/502/503 退避）"
        )
    if not re.search(r"from\s+http_client\s+import\b|import\s+http_client\b", script_text):
        raise ValueError(
            "discover.py 必须 from http_client import ...（统一超时与反爬限流）"
        )
    for match in re.finditer(r"timeout\s*=\s*(\d+(?:\.\d+)?)", script_text):
        raise ValueError(
            f"discover.py 禁止自定义 timeout={match.group(1)}；"
            "请使用 http_client（固定 REQUEST_TIMEOUT_SECONDS=5，含重试退避）"
        )
    _check_fetch_article_detail_hints(script_text)

    module = _load_module(skill_dir)
    required = (
        "fetch_list_page",
        "list_items",
        "has_next_page",
        "normalize_list_item",
        "fetch_article_detail",
    )
    missing = [name for name in required if not hasattr(module, name)]
    if missing:
        raise ValueError(f"discover.py 缺少接口: {', '.join(missing)}")

    from auth_signals_local import looks_like_login_wall, resolve_slot_hint
    from platform_account_ctx import get_account, platform_account_scope

    bound_account = None
    if _is_platform_skill(skill_dir) and get_account() is None:
        bound_account = _load_registry_platform_account(_platform_id_from_slug(slug))
        if not bound_account:
            raise ValueError(
                "平台 skill 未绑定账号上下文（platform_accounts）："
                "请先接入至少一个账号，或由 FeedClient / run_validation_for_account 注入。"
            )

    def _run_checks() -> dict:
        try:
            payload = module.fetch_list_page(1, 5)
        except Exception as exc:
            err = str(exc)
            if err.startswith("ASKME_AUTH_REQUIRED"):
                raise ValueError(err) from exc
            slot_hint = resolve_slot_hint(skill_dir, getattr(module, "FEED_META", {}) or {})
            low = err.lower()
            auth_tokens = ("401", "403", "unauthorized", "login", "cookie", "未登录", "登录")
            matched = [token for token in auth_tokens if token in low]
            not_auth = (
                "cookie 已配置" in low
                or "不存在" in err
                or "已停用" in err
                or "无法解析用户" in err
            )
            wrap_auth = bool(matched) and not not_auth
            if wrap_auth:
                raise ValueError(
                    f"ASKME_AUTH_REQUIRED:slot={slot_hint or 'unknown'} "
                    f"拉取列表失败（疑似需要登录）: {exc}"
                ) from exc
            raise

        # 部分站点把登录墙放在 payload 文本里
        payload_text = ""
        try:
            payload_text = json.dumps(payload, ensure_ascii=False)[:4000]
        except Exception:
            payload_text = str(payload)[:4000]

        items = module.list_items(payload)
        if len(items) < min_items:
            cookie_required = _requires_cookie_for(skill_dir)
            if cookie_required and (
                looks_like_login_wall(payload_text) or len(items) == 0
            ):
                slot_hint = resolve_slot_hint(skill_dir, getattr(module, "FEED_META", {}) or {})
                cookie_present = False
                if slot_hint and not looks_like_login_wall(payload_text):
                    try:
                        from auth_cookie import get_request_cookie

                        cookie_present = bool((get_request_cookie(slot_hint) or "").strip())
                    except Exception:
                        cookie_present = False
                # Cookie 已配置且非登录墙：空列表是拉取失败，不应伪装成未授权门禁
                if cookie_present and len(items) == 0 and not looks_like_login_wall(payload_text):
                    raise ValueError(
                        f"列表文章数不足（{len(items)} < {min_items}）："
                        "已配置登录凭证但仍未拉到内容，可能是限流、账号对当前会话不可见或接口变更。"
                    )
                raise ValueError(
                    f"ASKME_AUTH_REQUIRED:slot={slot_hint or 'unknown'} "
                    f"列表文章数不足（{len(items)} < {min_items}），站点可能需要登录 Cookie。"
                    "请在 Askme 完成登录授权后重试验证。"
                )
            raise ValueError(f"列表文章数不足: {len(items)} < {min_items}")

        normalized = [module.normalize_list_item(item) for item in items[: min(len(items), 3)]]
        for article in normalized:
            for key in ("id", "title", "url", "published_at"):
                if not str(article.get(key, "")).strip():
                    raise ValueError(f"列表项缺少字段 {key}: {article}")

        sample = normalized[0]
        sample_id = sample["id"]

        from detail_hints import hints_from_list_item

        if _is_x_platform_skill(skill_dir):
            from x_access_policy import sleep_between_x_access

            sleep_between_x_access()

        hint_payload = hints_from_list_item(sample)
        if hint_payload.get("url"):
            detail = _fetch_detail_without_list_scan(module, sample_id, hint_payload)
        else:
            detail = module.fetch_article_detail(sample_id)
        html = str(detail.get("content_html", "") or "")
        plain_len = len(html.strip())
        min_body_chars = _min_body_chars_for(skill_dir)
        if plain_len < min_body_chars:
            raise ValueError(
                f"正文过短或为空（{plain_len} 字符，要求 ≥{min_body_chars}），请检查 fetch_article_detail"
            )

        normalize_body = getattr(module, "normalize_article_body", None)
        cleaned_len = plain_len
        if callable(normalize_body):
            cleaned = normalize_body(html, article_id=sample_id)
            cleaned_len = len(str(cleaned or "").strip())

        return {
            "ok": True,
            "slug": slug,
            "feed_id": getattr(module, "FEED_ID", ""),
            "list_count": len(items),
            "sample_id": sample_id,
            "sample_title": sample.get("title", ""),
            "body_chars": plain_len,
            "cleaned_body_chars": cleaned_len,
            "has_next_page": bool(module.has_next_page(payload)),
        }

    if bound_account is not None:
        with platform_account_scope(bound_account):
            return _run_checks()
    return _run_checks()


def main() -> int:
    parser = argparse.ArgumentParser(description="验证 discovery skill")
    parser.add_argument("slug", help="skill slug，如 qbitai、jiqizhixin")
    parser.add_argument("--min-items", type=int, default=MIN_LIST_ITEMS)
    args = parser.parse_args()
    try:
        result = validate_skill(args.slug, min_items=args.min_items)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
