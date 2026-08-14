"""仓库根路径（backend 的上一级）。各模块应从此处取 data / skills 路径，勿再手写 parent.parent。"""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_ROOT.parent


def _resolve_data_dir() -> Path:
    override = os.environ.get("ASKME_DATA_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return PROJECT_ROOT / "data"


DATA_DIR = _resolve_data_dir()
SKILLS_ROOT = PROJECT_ROOT / "skills"
DISCOVERY_SKILLS_ROOT = SKILLS_ROOT / "discovery"
CHAT_SKILLS_BUILTIN_ROOT = SKILLS_ROOT / "chat"
DIGEST_SKILLS_BUILTIN_ROOT = SKILLS_ROOT / "digest"
ONBOARDING_SKILLS_ROOT = SKILLS_ROOT / "onboarding"
SKILLS_LIB = DISCOVERY_SKILLS_ROOT / "_lib"
