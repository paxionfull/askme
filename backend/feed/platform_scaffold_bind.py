"""从 _lib/*_scaffold 模板按账号参数内存编译适配器。

历史兼容：平台运行时已统一为 `{platform}-platform-discovery` + BoundPlatformAdapter。
本模块仅供旧脚手架生成 / 探测脚本偶发使用，新代码勿再作为主路径。
"""

from __future__ import annotations

import importlib.util
import sys
from typing import Any

from paths import DISCOVERY_SKILLS_ROOT, SKILLS_LIB

_LIB = SKILLS_LIB

_compiled: dict[str, Any] = {}


def _replacements(platform: str, account: dict[str, Any]) -> dict[str, str]:
    feed_id = str(account.get("feed_id") or "")
    key = str(account.get("account_key") or "")
    display = str(account.get("display_name") or key)
    entry = str(account.get("entry_url") or "")
    posts = str(account.get("posts_url") or entry)
    user_type = str(account.get("user_type") or "people")

    if platform == "x":
        return {
            "__ASKME_SCREEN_NAME__": key,
            "__ASKME_FEED_ID__": feed_id,
            "__ASKME_DISPLAY_NAME__": display,
        }
    if platform == "zhihu":
        return {
            "__ASKME_USER_ID__": key,
            "__ASKME_USER_TYPE__": user_type,
            "__ASKME_PAGE_URL__": posts or entry,
            "__ASKME_FEED_ID__": feed_id,
            "__ASKME_DISPLAY_NAME__": display,
        }
    if platform == "reddit":
        return {
            "__ASKME_SUBREDDIT__": key,
            "__ASKME_FEED_ID__": feed_id,
            "__ASKME_DISPLAY_NAME__": display,
        }
    raise ValueError(f"不支持的平台脚手架: {platform}")


def compile_scaffold_adapter(platform: str, account: dict[str, Any]) -> Any:
    feed_id = str(account.get("feed_id") or "").strip()
    if not feed_id:
        raise ValueError("缺少 feed_id")
    cache_key = f"{platform}:{feed_id}"
    if cache_key in _compiled:
        return _compiled[cache_key]

    # reddit scaffold 用字面量替换名，检查模板占位符
    template = _LIB / f"{platform}_scaffold" / "discover.py"
    if not template.is_file():
        raise FileNotFoundError(f"缺少脚手架模板: {template}")
    text = template.read_text(encoding="utf-8")
    for old, new in _replacements(platform, account).items():
        text = text.replace(old, new)

    # reddit 模板可能是「indiehackers」直接写死的旧式；优先占位符
    if platform == "reddit" and "__ASKME_SUBREDDIT__" not in template.read_text(encoding="utf-8"):
        # 旧模板：SUBREDDIT = "indiehackers" 等已在 scaffold 里用占位？检查
        pass

    module_name = f"askme_bound_{feed_id.replace(':', '_').replace('-', '_')}"
    if str(_LIB) not in sys.path:
        sys.path.insert(0, str(_LIB))
    if str(DISCOVERY_SKILLS_ROOT) not in sys.path:
        sys.path.insert(0, str(DISCOVERY_SKILLS_ROOT))

    spec = importlib.util.spec_from_loader(module_name, loader=None)
    if spec is None:
        raise RuntimeError(f"无法创建模块: {module_name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    exec(compile(text, str(template), "exec"), module.__dict__)  # noqa: S102
    _compiled[cache_key] = module
    return module


def clear_compiled_adapters() -> None:
    for key in list(_compiled.keys()):
        mod = _compiled.pop(key)
        name = getattr(mod, "__name__", "")
        if name:
            sys.modules.pop(name, None)
