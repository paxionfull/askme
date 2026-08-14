"""运行 discovery skill 验证（供 backend 调用）。"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SKILLS_ROOT = Path(__file__).resolve().parent.parent / ".cursor" / "skills"
VALIDATE_SCRIPT = SKILLS_ROOT / "_lib" / "discovery_validate.py"


def run_validation(slug: str, *, min_items: int = 1) -> dict:
    spec = importlib.util.spec_from_file_location("askme_discovery_validate", VALIDATE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载 discovery_validate.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["askme_discovery_validate"] = module
    spec.loader.exec_module(module)
    return module.validate_skill(slug, min_items=min_items)
