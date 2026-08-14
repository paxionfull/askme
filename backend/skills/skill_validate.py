"""运行 discovery skill 验证（供 backend 调用）。"""

from __future__ import annotations

import importlib.util
import sys

from paths import SKILLS_LIB, SKILLS_ROOT

VALIDATE_SCRIPT = SKILLS_LIB / "discovery_validate.py"
if str(SKILLS_LIB) not in sys.path:
    sys.path.insert(0, str(SKILLS_LIB))


def run_validation(slug: str, *, min_items: int = 1) -> dict:
    spec = importlib.util.spec_from_file_location("askme_discovery_validate", VALIDATE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载 discovery_validate.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["askme_discovery_validate"] = module
    spec.loader.exec_module(module)
    return module.validate_skill(slug, min_items=min_items)


def run_validation_for_account(account: dict, *, min_items: int = 1) -> dict:
    """验证平台账号：统一走平台 skill + ContextVar 绑定。"""
    platform = str(account.get("platform") or "").strip().lower()
    from platform_account_ctx import platform_account_scope
    from skills.skill_registry import platform_skill_slug

    slug = platform_skill_slug(platform) if platform else str(account.get("slug") or "")
    if platform == "jin10":
        slug = "jin10"
    with platform_account_scope(account):
        return run_validation(slug, min_items=min_items)


def _validate_adapter_module(module, *, min_items: int, label: str | None = None) -> dict:
    """对已绑定账号的 adapter 模块做与 discovery_validate 类似的最小检查。"""
    required = (
        "fetch_list_page",
        "list_items",
        "has_next_page",
        "normalize_list_item",
        "fetch_article_detail",
    )
    missing = [name for name in required if not hasattr(module, name)]
    if missing:
        raise ValueError(f"adapter 缺少接口: {', '.join(missing)}")
    payload = module.fetch_list_page(1, 5)
    items = module.list_items(payload)
    if len(items) < min_items:
        raise ValueError(f"列表文章数不足: {len(items)} < {min_items} ({label or ''})")
    normalized = [module.normalize_list_item(item) for item in items[: min(len(items), 3)]]
    for article in normalized:
        for key in ("id", "title", "url", "published_at"):
            if not str(article.get(key, "")).strip():
                raise ValueError(f"列表项缺少字段 {key}: {article}")
    first = normalized[0]
    detail = module.fetch_article_detail(
        first["id"],
        url=first.get("url", ""),
        title=first.get("title", ""),
        published_at=first.get("published_at", ""),
    )
    html = str(detail.get("content_html") or "")
    if len(html.strip()) < 40:
        raise ValueError("正文过短或为空")
    return {
        "ok": True,
        "list_count": len(items),
        "sample_title": first.get("title"),
        "feed_id": label,
    }

