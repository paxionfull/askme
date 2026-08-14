"""仓库根路径（backend 的上一级）。各模块应从此处取 data / skills 路径，勿再手写 parent.parent。"""
from __future__ import annotations

from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_ROOT.parent
DATA_DIR = PROJECT_ROOT / "data"
SKILLS_ROOT = PROJECT_ROOT / ".cursor" / "skills"
SKILLS_LIB = SKILLS_ROOT / "_lib"
