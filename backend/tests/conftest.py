"""pytest 共享 fixture。"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture
def project_root() -> Path:
    return PROJECT_ROOT


@pytest.fixture
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """隔离测试数据目录，避免读写仓库 data/。"""
    path = tmp_path / "data"
    path.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("ASKME_DATA_DIR", str(path))

    import paths

    monkeypatch.setattr(paths, "DATA_DIR", path)
    return path


@pytest.fixture
def isolated_feed_registry(data_dir: Path, monkeypatch: pytest.MonkeyPatch):
    """将全局 feed_registry 指向临时 JSON。"""
    from feed import feed_registry as feed_registry_module
    from feed.feed_registry import FeedRegistry

    registry = FeedRegistry(path=data_dir / "feed_registry.json")
    monkeypatch.setattr(feed_registry_module, "feed_registry", registry)
    return registry


@pytest.fixture
def isolated_discovery_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """将 discovery skill 根目录指向临时目录。"""
    root = tmp_path / "discovery"
    root.mkdir(parents=True, exist_ok=True)

    import paths
    import onboarding.source_skill_writer as source_skill_writer
    import skills.skill_manager as skill_manager
    import skills.skill_registry as skill_registry

    monkeypatch.setattr(paths, "DISCOVERY_SKILLS_ROOT", root)
    monkeypatch.setattr(paths, "SKILLS_LIB", PROJECT_ROOT / "skills" / "discovery" / "_lib")
    monkeypatch.setattr(source_skill_writer, "DISCOVERY_SKILLS_ROOT", root)
    monkeypatch.setattr(skill_manager, "DISCOVERY_SKILLS_ROOT", root)
    monkeypatch.setattr(skill_registry, "DISCOVERY_SKILLS_ROOT", root)
    return root


@pytest.fixture
def mock_feed_client(monkeypatch: pytest.MonkeyPatch):
    """避免导入/删除 skill 时触发真实 feed 刷新。"""
    from unittest.mock import MagicMock

    client = MagicMock()
    client.reload_skills = MagicMock()
    client.ensure_feed_visible = MagicMock()

    import api.deps as deps

    monkeypatch.setattr(deps, "feed_client", client)
    return client


@pytest.fixture
def sample_discovery_skill(isolated_discovery_root: Path) -> str:
    """在隔离目录写入最小可导出 discovery skill，返回 slug。"""
    slug = "pytest-roundtrip"
    skill_dir = isolated_discovery_root / f"{slug}-discovery"
    scripts = skill_dir / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    (skill_dir / "source.yaml").write_text(
        f"id: {slug}\nname: Pytest Roundtrip\n",
        encoding="utf-8",
    )
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {slug}\ndescription: test skill\n---\n\nbody\n",
        encoding="utf-8",
    )
    (scripts / "discover.py").write_text(
        f'''FEED_ID = "website:{slug}"
FEED_META = {{"mpName": "Pytest", "entryUrl": "https://example.com"}}

def fetch_list_page(page, per):
    return {{}}

def list_items(payload):
    return []

def has_next_page(payload):
    return False

def normalize_list_item(item):
    return {{"id": "1", "title": "t", "url": "https://example.com/1", "published_at": ""}}

def fetch_article_detail(article_id, **hints):
    return {{"content_html": "<p>x</p>"}}
''',
        encoding="utf-8",
    )
    return slug


@pytest.fixture
def discovery_validate_script(project_root: Path) -> Path:
    script = project_root / "skills" / "discovery" / "_lib" / "discovery_validate.py"
    assert script.is_file(), f"缺少校验脚本: {script}"
    return script
