from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from paths import DISCOVERY_SKILLS_ROOT

# 默认 CI 跑的快照源：相对稳定、无需登录
FAST_NETWORK_SLUGS = ("bls", "jin10")


def _list_builtin_discovery_slugs() -> list[str]:
    if not DISCOVERY_SKILLS_ROOT.is_dir():
        return []
    slugs: list[str] = []
    for skill_dir in sorted(DISCOVERY_SKILLS_ROOT.iterdir()):
        name = skill_dir.name
        if not skill_dir.is_dir() or not name.endswith("-discovery"):
            continue
        if ".bak" in name:
            continue
        slugs.append(name[: -len("-discovery")])
    return slugs


@pytest.mark.network
@pytest.mark.parametrize("slug", FAST_NETWORK_SLUGS)
def test_discovery_validate_fast(slug: str, discovery_validate_script: Path, project_root: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(discovery_validate_script), slug],
        cwd=project_root,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout


@pytest.mark.network
@pytest.mark.slow
@pytest.mark.parametrize("slug", _list_builtin_discovery_slugs())
def test_discovery_validate_all_builtin(slug: str, discovery_validate_script: Path, project_root: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(discovery_validate_script), slug],
        cwd=project_root,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    assert result.returncode == 0, f"{slug}: {result.stderr or result.stdout}"
