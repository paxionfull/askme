"""写入与校验 discovery skill 文件。"""

from __future__ import annotations

import re
from pathlib import Path

SKILLS_ROOT = Path(__file__).resolve().parent.parent / ".cursor" / "skills"
SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
REFERENCE_SLUGS = ("jiqizhixin", "qbitai", "zhihu-aitechtalk", "zhihu-xinziyuan")


def validate_slug(slug: str) -> str:
    value = slug.strip().lower().replace("_", "-")
    if not SLUG_PATTERN.match(value):
        raise ValueError("slug 只能包含小写字母、数字和连字符")
    return value


def skill_dir_for(slug: str) -> Path:
    return SKILLS_ROOT / f"{validate_slug(slug)}-discovery"


def is_complete_discovery_skill(slug: str) -> bool:
    """目录存在且含可用 discover.py 才算完整 skill。"""
    skill_dir = skill_dir_for(slug)
    discover = skill_dir / "scripts" / "discover.py"
    if not discover.is_file():
        return False
    try:
        text = discover.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return "FEED_ID" in text and "fetch_list_page" in text and "fetch_article_detail" in text


def remove_discovery_skill_dir(slug: str) -> bool:
    """删除 discovery skill 目录（若存在）。返回是否删除。"""
    import shutil

    skill_dir = skill_dir_for(slug)
    if not skill_dir.is_dir():
        return False
    shutil.rmtree(skill_dir)
    return True


def normalize_entry_url(url: str) -> str:
    value = url.strip()
    if not value:
        raise ValueError("请填写网站链接")
    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    from urllib.parse import urlparse

    parsed = urlparse(value)
    if not parsed.netloc:
        raise ValueError("请输入有效的网站链接")
    return value


def derive_source_identity(entry_url: str) -> tuple[str, str]:
    from urllib.parse import urlparse

    parsed = urlparse(normalize_entry_url(entry_url))
    host = parsed.netloc.lower().split(":")[0]
    if host.startswith("www."):
        host = host[4:]

    labels = [part for part in host.split(".") if part]
    if len(labels) >= 2 and labels[-1] in {"com", "cn", "net", "org", "io", "co", "dev", "ai"}:
        slug_base = labels[-2]
    elif labels:
        slug_base = labels[0]
    else:
        slug_base = "site"

    slug_base = re.sub(r"[^a-z0-9]", "", slug_base.lower()) or "site"
    name = slug_base.replace("-", " ").title()

    # 完整 skill 已存在时优先复用 base slug（再次添加 = 加入分组），勿自动改成 site-2
    if skill_dir_for(slug_base).exists() and is_complete_discovery_skill(slug_base):
        return validate_slug(slug_base), name

    slug = slug_base
    suffix = 2
    while skill_dir_for(slug).exists() and is_complete_discovery_skill(slug) and not _is_hidden_feed(
        f"website:{slug}"
    ):
        slug = f"{slug_base}-{suffix}"
        suffix += 1
        if suffix > 99:
            raise ValueError("无法为该域名生成唯一 slug")

    return validate_slug(slug), name


def resolve_onboard_target(
    entry_url: str,
    *,
    slug: str | None = None,
    name: str | None = None,
) -> tuple[str, str, str]:
    from source_platform_scaffold import detect_platform

    normalized_url = normalize_entry_url(entry_url)
    platform = detect_platform(normalized_url)
    if platform and not (slug and slug.strip()):
        final_slug = platform.slug
        if platform.platform == "zhihu":
            final_name = name.strip() if name and name.strip() else platform.user_id
        elif platform.platform == "jin10":
            final_name = name.strip() if name and name.strip() else "金十数据"
        else:
            final_name = name.strip() if name and name.strip() else platform.user_id
        if skill_dir_for(final_slug).exists() and not is_complete_discovery_skill(final_slug):
            remove_discovery_skill_dir(final_slug)
        entry = platform.posts_url if platform.platform in {"zhihu", "jin10"} else normalized_url
        return final_slug, final_name, entry

    auto_slug, auto_name = derive_source_identity(normalized_url)
    final_slug = validate_slug(slug) if slug and slug.strip() else auto_slug
    final_name = name.strip() if name and name.strip() else auto_name
    if skill_dir_for(final_slug).exists() and not is_complete_discovery_skill(final_slug):
        remove_discovery_skill_dir(final_slug)
    return final_slug, final_name, normalized_url


def resolve_feed_id_for_target(entry_url: str, slug: str) -> str:
    """根据入口 URL / slug 解析 feed_id（知乎等平台不等于 website:{slug}）。"""
    from source_platform_scaffold import detect_platform

    platform = detect_platform((entry_url or "").strip())
    if platform:
        return platform.feed_id
    return f"website:{validate_slug(slug)}"


def onboard_target_already_exists(slug: str, feed_id: str) -> bool:
    return (
        skill_dir_for(slug).exists()
        and is_complete_discovery_skill(slug)
        and not _is_hidden_feed(feed_id)
    )


def _is_hidden_feed(feed_id: str) -> bool:
    from feed_registry import feed_registry

    return feed_registry.is_hidden(feed_id)


def load_reference_examples(*, max_chars_per_file: int = 4500) -> str:
    blocks: list[str] = []
    for ref_slug in REFERENCE_SLUGS:
        skill_dir = SKILLS_ROOT / f"{ref_slug}-discovery"
        discover = skill_dir / "scripts" / "discover.py"
        source_yaml = skill_dir / "source.yaml"
        if discover.is_file():
            text = discover.read_text(encoding="utf-8")
            if len(text) > max_chars_per_file:
                text = text[:max_chars_per_file] + "\n# ... truncated ..."
            blocks.append(f"### 参考 discover.py · {ref_slug}\n```python\n{text}\n```")
        if source_yaml.is_file():
            yaml_text = source_yaml.read_text(encoding="utf-8")[:2000]
            blocks.append(f"### 参考 source.yaml · {ref_slug}\n```yaml\n{yaml_text}\n```")
    return "\n\n".join(blocks)


def write_skill_files(slug: str, files: dict[str, str]) -> Path:
    safe_slug = validate_slug(slug)
    skill_dir = skill_dir_for(safe_slug)
    if skill_dir.exists():
        raise ValueError(f"数据源 skill 已存在: {skill_dir.name}")

    allowed = {"scripts/discover.py", "SKILL.md", "source.yaml"}
    for rel_path, content in files.items():
        rel = rel_path.strip().lstrip("/")
        if rel == "discover.py":
            rel = "scripts/discover.py"
        if rel not in allowed:
            raise ValueError(f"不允许写入路径: {rel}")
        target = skill_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content.strip() + "\n", encoding="utf-8")
        if rel.endswith("discover.py"):
            target.chmod(0o755)

    required = skill_dir / "scripts" / "discover.py"
    if not required.is_file():
        raise ValueError("缺少 scripts/discover.py")
    return skill_dir
