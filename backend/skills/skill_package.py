"""Discovery skill 目录导入/导出（导出为 zip 包，内含明文 skill 目录）。"""

from __future__ import annotations

import io
import json
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from feed.feed_registry import UNGROUPED_GROUP_ID, feed_registry
from onboarding.source_skill_writer import skill_dir_for, validate_slug
from skills.skill_manager import _collect_skill_files, _extract_feed_id, _validate_skill_id
from skills.skill_registry import PLATFORM_SKILL_SLUGS

ALLOWED_SUFFIXES = {".md", ".yaml", ".yml", ".py", ".txt", ".json"}
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_SKILL_BYTES = 8 * 1024 * 1024
MAX_PACKAGE_BYTES = 16 * 1024 * 1024

_PLATFORM_SLUGS = set(PLATFORM_SKILL_SLUGS.values())
PLATFORM_ACCOUNTS_DIR = "platform-accounts"
PLATFORM_ACCOUNTS_MANIFEST = f"{PLATFORM_ACCOUNTS_DIR}/manifest.json"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def is_platform_skill_slug(slug: str) -> bool:
    value = (slug or "").strip().lower()
    if not value:
        return False
    if value in _PLATFORM_SLUGS or value.endswith("-platform"):
        return True
    return bool(re.match(r"^(x|zhihu|reddit)-platform(-discovery)?$", value))


def _skill_dir_name(slug: str) -> str:
    return f"{validate_slug(slug)}-discovery"


def _build_manifest(slug: str, *, name: str = "") -> dict[str, Any]:
    slug = validate_slug(slug)
    skill_dir = skill_dir_for(slug)
    skill_id = _skill_dir_name(slug)
    feed_id = _extract_feed_id(skill_dir) or f"website:{slug}"
    display_name = name.strip()
    if not display_name:
        skill_md = skill_dir / "SKILL.md"
        if skill_md.is_file():
            from skills.skill_md import skill_meta_from_md

            display_name, _ = skill_meta_from_md(skill_md.read_text(encoding="utf-8"), fallback_id=slug)
        else:
            display_name = slug.replace("-", " ")
    return {
        "slug": slug,
        "skill_id": skill_id,
        "feed_id": feed_id,
        "name": display_name,
        "exported_at": _utc_now_iso(),
    }


def _iter_skill_files(skill_dir: Path) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for entry in _collect_skill_files(skill_dir):
        rel = str(entry.get("path") or "").strip()
        content = entry.get("content")
        if not rel or not isinstance(content, str):
            continue
        path = Path(rel)
        if path.suffix.lower() not in ALLOWED_SUFFIXES:
            continue
        items.append({"path": rel.replace("\\", "/"), "content": content})
    return items


def export_discovery_skills(
    skill_ids: list[str] | None = None,
    *,
    platform_feed_ids: list[str] | None = None,
) -> tuple[bytes, str, int]:
    """打包为 zip。可含站级 *-discovery 目录与 platform-accounts 配置。"""
    payload, filename, stats = export_discovery_package(
        skill_ids=skill_ids or [],
        platform_feed_ids=platform_feed_ids or [],
    )
    return payload, filename, int(stats.get("skill_count") or 0)


def _feed_id_to_account_filename(feed_id: str) -> str:
    safe = feed_id.replace(":", "-").replace("/", "_")
    return f"{PLATFORM_ACCOUNTS_DIR}/accounts/{safe}.json"


def _account_export_record(feed_id: str) -> dict[str, Any] | None:
    account = feed_registry.get_platform_account(feed_id)
    if not account:
        return None
    record = {key: value for key, value in account.items() if value not in (None, "")}
    group_id = feed_registry.group_id_for_feed(feed_id)
    if group_id:
        record["group_id"] = group_id
    return record


def _collect_platform_accounts_for_export(feed_ids: list[str]) -> list[dict[str, Any]]:
    accounts: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in feed_ids:
        fid = str(raw or "").strip()
        if not fid or fid in seen:
            continue
        record = _account_export_record(fid)
        if not record:
            continue
        seen.add(fid)
        accounts.append(record)
    return accounts


def export_discovery_package(
    *,
    skill_ids: list[str] | None = None,
    platform_feed_ids: list[str] | None = None,
) -> tuple[bytes, str, dict[str, int]]:
    slugs: list[str] = []
    for raw in skill_ids or []:
        slug = _validate_skill_id(str(raw or "").strip())
        if slug.endswith("-discovery"):
            slug = slug[: -len("-discovery")]
        slug = validate_slug(slug)
        if is_platform_skill_slug(slug):
            raise ValueError(f"内置平台 skill 不可导出: {slug}")
        skill_dir = skill_dir_for(slug)
        if not skill_dir.is_dir():
            raise ValueError(f"discovery skill 不存在: {slug}")
        if slug not in slugs:
            slugs.append(slug)

    platform_accounts = _collect_platform_accounts_for_export(platform_feed_ids or [])
    if not slugs and not platform_accounts:
        raise ValueError("请选择至少一个可导出的 skill 或平台账号")

    packed: list[tuple[str, list[dict[str, str]]]] = []
    for slug in slugs:
        skill_dir = skill_dir_for(slug)
        skill_id = _skill_dir_name(slug)
        files = _iter_skill_files(skill_dir)
        if not files:
            raise ValueError(f"skill 无可导出文件: {skill_id}")
        packed.append((skill_id, files))

    use_bundle_root = len(packed) + len(platform_accounts) != 1 or bool(packed and platform_accounts)
    root_prefix = "askme-skills" if use_bundle_root else ""

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        if use_bundle_root:
            lines = [f"- {skill_id}/" for skill_id, _ in packed]
            if platform_accounts:
                lines.append(f"- {PLATFORM_ACCOUNTS_DIR}/ ({len(platform_accounts)} 个平台账号)")
            zf.writestr(
                f"{root_prefix}/README.txt",
                (
                    f"Askme skills export\n"
                    f"exported_at: {_utc_now_iso()}\n"
                    f"discovery_skills: {len(packed)}\n"
                    f"platform_accounts: {len(platform_accounts)}\n\n"
                    + "\n".join(lines)
                    + "\n"
                ),
            )

        for skill_id, files in packed:
            base = f"{root_prefix}/{skill_id}" if root_prefix else skill_id
            zf.writestr(f"{base}/", b"")
            for item in files:
                zf.writestr(f"{base}/{item['path']}", item["content"].encode("utf-8"))

        if platform_accounts:
            manifest = {
                "format_version": 1,
                "kind": "platform_accounts",
                "exported_at": _utc_now_iso(),
                "count": len(platform_accounts),
                "accounts": platform_accounts,
            }
            manifest_path = (
                f"{root_prefix}/{PLATFORM_ACCOUNTS_MANIFEST}" if root_prefix else PLATFORM_ACCOUNTS_MANIFEST
            )
            zf.writestr(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
            for account in platform_accounts:
                feed_id = str(account.get("feed_id") or "")
                rel = _feed_id_to_account_filename(feed_id)
                if root_prefix:
                    rel = f"{root_prefix}/{rel}"
                zf.writestr(rel, json.dumps(account, ensure_ascii=False, indent=2).encode("utf-8"))

    if len(packed) == 1 and not platform_accounts and not root_prefix:
        filename = f"{packed[0][0]}.zip"
    elif platform_accounts and not packed:
        filename = f"askme-platform-accounts-{len(platform_accounts)}.zip"
    else:
        total = len(packed) + len(platform_accounts)
        filename = f"askme-skills-{total}.zip"

    return (
        buffer.getvalue(),
        filename,
        {"skill_count": len(packed), "platform_account_count": len(platform_accounts)},
    )


def _parse_platform_accounts_from_zip(zf: zipfile.ZipFile) -> list[dict[str, Any]]:
    accounts: list[dict[str, Any]] = []
    manifest_paths = [
        name
        for name in zf.namelist()
        if name.replace("\\", "/").endswith(PLATFORM_ACCOUNTS_MANIFEST)
    ]
    for manifest_path in manifest_paths:
        try:
            payload = json.loads(zf.read(manifest_path).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("platform-accounts/manifest.json 无效") from exc
        if not isinstance(payload, dict):
            continue
        raw_accounts = payload.get("accounts")
        if isinstance(raw_accounts, list):
            for item in raw_accounts:
                if isinstance(item, dict):
                    accounts.append(item)

    if accounts:
        return _dedupe_platform_accounts(accounts)

    prefix = f"{PLATFORM_ACCOUNTS_DIR}/accounts/"
    for name in zf.namelist():
        normalized = name.replace("\\", "/")
        if not normalized.endswith(".json"):
            continue
        idx = normalized.find(prefix)
        if idx < 0:
            continue
        try:
            item = json.loads(zf.read(name).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(item, dict):
            accounts.append(item)
    return _dedupe_platform_accounts(accounts)


def _dedupe_platform_accounts(accounts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in accounts:
        if not isinstance(item, dict):
            continue
        feed_id = str(item.get("feed_id") or "").strip()
        if not feed_id or feed_id in seen:
            continue
        seen.add(feed_id)
        deduped.append(item)
    return deduped


def parse_discovery_zip_package(data: bytes) -> dict[str, Any]:
    """解析 zip，返回 skills 与 platform_accounts。"""
    if not data:
        raise ValueError("zip 文件为空")
    if len(data) > MAX_PACKAGE_BYTES:
        raise ValueError("zip 过大")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ValueError("无效的 zip 文件") from exc

    grouped: dict[str, dict[str, str]] = {}
    with zf:
        platform_accounts = _parse_platform_accounts_from_zip(zf)
        for name in zf.namelist():
            if not name or name.endswith("/"):
                continue
            normalized = name.replace("\\", "/")
            if normalized.startswith("__MACOSX/") or "/__MACOSX/" in normalized:
                continue
            if PLATFORM_ACCOUNTS_DIR in normalized.split("/"):
                continue
            parts = [part for part in normalized.split("/") if part]
            if not parts or parts[-1] in {".DS_Store", "README.txt"}:
                continue
            discovery_index = next((index for index, part in enumerate(parts) if part.endswith("-discovery")), -1)
            if discovery_index < 0:
                continue
            skill_id = parts[discovery_index]
            if is_platform_skill_slug(skill_id[: -len("-discovery")] if skill_id.endswith("-discovery") else skill_id):
                continue
            rel = "/".join(parts[discovery_index + 1 :])
            if not rel or ".." in rel.split("/"):
                continue
            suffix = Path(rel).suffix.lower()
            if suffix not in ALLOWED_SUFFIXES:
                continue
            payload = zf.read(name)
            if len(payload) > MAX_FILE_BYTES:
                raise ValueError(f"文件过大: {skill_id}/{rel}")
            try:
                text = payload.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ValueError(f"无法读取文本文件: {skill_id}/{rel}") from exc
            bucket = grouped.setdefault(skill_id, {})
            bucket[rel] = text
            total = sum(len(value.encode("utf-8")) for value in bucket.values())
            if total > MAX_SKILL_BYTES:
                raise ValueError(f"skill 目录过大: {skill_id}")

    skills: list[dict[str, Any]] = []
    for skill_id, files_map in sorted(grouped.items()):
        slug = skill_id[: -len("-discovery")] if skill_id.endswith("-discovery") else skill_id
        if is_platform_skill_slug(slug):
            raise ValueError(f"内置平台 skill 不可导入: {skill_id}")
        if "scripts/discover.py" not in files_map:
            raise ValueError(f"{skill_id} 缺少 scripts/discover.py")
        files = [{"path": path, "content": content} for path, content in sorted(files_map.items())]
        skill_dir = skill_dir_for(slug) if slug else None
        feed_id = _extract_feed_id(skill_dir) if skill_dir and skill_dir.is_dir() else f"website:{slug}"
        skills.append(
            {
                "skill_id": skill_id,
                "slug": slug,
                "feed_id": feed_id or f"website:{slug}",
                "name": slug.replace("-", " "),
                "files": files,
            }
        )

    if not skills and not platform_accounts:
        raise ValueError("zip 内未找到有效的 skill 或平台账号配置")

    return {"skills": skills, "platform_accounts": platform_accounts}


def parse_discovery_zip(data: bytes) -> list[dict[str, Any]]:
    """解析导出的 skill zip，返回可交给 import_discovery_directories 的 skills 列表。"""
    return parse_discovery_zip_package(data)["skills"]


def import_discovery_zip(data: bytes, *, overwrite: bool = False, group_id: str | None = None) -> dict[str, Any]:
    package = parse_discovery_zip_package(data)
    return import_discovery_package(
        package.get("skills") or [],
        package.get("platform_accounts") or [],
        overwrite=overwrite,
        group_id=group_id,
    )


def _safe_join(base: Path, rel: str) -> Path:
    rel = rel.replace("\\", "/").lstrip("/")
    if not rel or rel.endswith("/") or ".." in rel.split("/"):
        raise ValueError(f"非法文件路径: {rel}")
    target = (base / rel).resolve()
    base_resolved = base.resolve()
    if base_resolved not in target.parents and target != base_resolved:
        raise ValueError(f"非法文件路径: {rel}")
    return target


def _write_skill_tree(skill_dir: Path, files: dict[str, str]) -> None:
    if skill_dir.exists():
        shutil.rmtree(skill_dir)
    skill_dir.mkdir(parents=True, exist_ok=True)
    for rel, content in sorted(files.items()):
        if rel == "manifest.json":
            continue
        data = content.encode("utf-8")
        if len(data) > MAX_FILE_BYTES:
            raise ValueError(f"文件过大: {rel}")
        target = _safe_join(skill_dir, rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def _slug_from_source_yaml(files: dict[str, str]) -> str | None:
    raw = files.get("source.yaml") or files.get("source.yml")
    if not raw:
        return None
    try:
        payload = yaml.safe_load(raw)
    except yaml.YAMLError:
        return None
    if not isinstance(payload, dict):
        return None
    value = str(payload.get("id") or "").strip()
    if not value:
        return None
    try:
        return validate_slug(value)
    except ValueError:
        return None


def _resolve_import_slug(
    *,
    skill_id: str,
    slug: str,
    files: dict[str, str],
) -> str:
    if slug:
        return validate_slug(slug)

    normalized_skill_id = (skill_id or "").strip()
    if normalized_skill_id.endswith("-discovery"):
        return validate_slug(normalized_skill_id[: -len("-discovery")])

    from_yaml = _slug_from_source_yaml(files)
    if from_yaml:
        return from_yaml

    raise ValueError("无法识别 skill：请确保目录名为 *-discovery 或包含 source.yaml")


def _normalize_import_files(files: list[dict[str, Any]]) -> dict[str, str]:
    if not files:
        raise ValueError("skill 目录缺少文件")
    normalized: dict[str, str] = {}
    total = 0
    for item in files:
        if not isinstance(item, dict):
            raise ValueError("files 项格式无效")
        rel = str(item.get("path") or "").strip().replace("\\", "/")
        content = item.get("content")
        if not rel or not isinstance(content, str):
            continue
        path = Path(rel)
        if path.suffix.lower() not in ALLOWED_SUFFIXES:
            continue
        payload = content.encode("utf-8")
        if len(payload) > MAX_FILE_BYTES:
            raise ValueError(f"文件过大: {rel}")
        total += len(payload)
        if total > MAX_SKILL_BYTES:
            raise ValueError("skill 目录过大")
        normalized[rel] = content
    if not normalized:
        raise ValueError("skill 目录缺少可识别文件")
    return normalized


def _resolve_import_group_id(group_id: str | None) -> str | None:
    raw = (group_id or "").strip()
    if not raw or raw == UNGROUPED_GROUP_ID:
        return None
    groups = feed_registry.list_groups()
    if any(str(group.get("id", "")) == raw for group in groups):
        return raw
    raise ValueError(f"分组不存在: {raw}")


def import_discovery_directories(
    skills: list[dict[str, Any]],
    *,
    overwrite: bool = False,
    group_id: str | None = None,
) -> dict[str, Any]:
    return import_discovery_package(skills, [], overwrite=overwrite, group_id=group_id)


def _import_one_platform_account(
    account: dict[str, Any],
    *,
    overwrite: bool,
) -> dict[str, Any]:
    from feed.platform_accounts import ensure_platform_skill

    feed_id = str(account.get("feed_id") or "").strip()
    if not feed_id:
        raise ValueError("平台账号缺少 feed_id")
    exists = feed_registry.get_platform_account(feed_id) is not None
    if exists and not overwrite:
        display = str(account.get("display_name") or feed_id)
        raise ValueError(f"本地已有平台账号「{display}」，请勾选覆盖后再导入")

    platform = str(account.get("platform") or "").strip().lower()
    ensure_platform_skill(platform)
    saved = feed_registry.upsert_platform_account(account)

    return {
        "feed_id": saved["feed_id"],
        "platform": saved.get("platform"),
        "account_key": saved.get("account_key"),
        "name": saved.get("display_name") or saved.get("account_key"),
        "overwritten": exists,
    }


def _needs_auth_slots_for_platform_accounts(accounts: list[dict[str, Any]]) -> list[str]:
    from auth.credential_store import slot_configured
    from onboarding.platform_registry import get_platform_spec

    slots: set[str] = set()
    for account in accounts:
        platform = str(account.get("platform") or "").strip().lower()
        spec = get_platform_spec(platform)
        if not spec or not spec.auth_slot:
            continue
        if not slot_configured(spec.auth_slot):
            slots.add(spec.auth_slot)
    return sorted(slots)


def import_discovery_package(
    skills: list[dict[str, Any]],
    platform_accounts: list[dict[str, Any]],
    *,
    overwrite: bool = False,
    group_id: str | None = None,
) -> dict[str, Any]:
    if not skills and not platform_accounts:
        raise ValueError("请选择至少一个 skill 或平台账号")

    resolved_group_id = _resolve_import_group_id(group_id)

    imported: list[dict[str, Any]] = []
    for entry in skills:
        if not isinstance(entry, dict):
            raise ValueError("skills 项格式无效")
        files = _normalize_import_files(entry.get("files") or [])
        slug = _resolve_import_slug(
            skill_id=str(entry.get("skill_id") or ""),
            slug=str(entry.get("slug") or "").strip(),
            files=files,
        )
        if is_platform_skill_slug(slug):
            raise ValueError("内置平台 skill 不可导入")
        manifest = {
            "slug": slug,
            "skill_id": _skill_dir_name(slug),
            "feed_id": str(entry.get("feed_id") or f"website:{slug}"),
            "name": str(entry.get("name") or slug),
        }
        imported.append(_import_one_skill(slug, files, overwrite=overwrite, manifest=manifest))

    imported_platform: list[dict[str, Any]] = []
    for entry in platform_accounts:
        if not isinstance(entry, dict):
            raise ValueError("platform_accounts 项格式无效")
        imported_platform.append(
            _import_one_platform_account(entry, overwrite=overwrite)
        )

    from api.deps import feed_client
    from skills.skill_registry import clear_loaded_skill_modules

    clear_loaded_skill_modules()
    feed_client.reload_skills()
    for item in imported:
        feed_client.ensure_feed_visible(item["feed_id"])
        _attach_imported_feed(item["feed_id"], resolved_group_id)
    for item in imported_platform:
        feed_client.ensure_feed_visible(item["feed_id"])
        _attach_imported_feed(item["feed_id"], resolved_group_id)

    try:
        from onboarding.discovery_skill_catalog import write_discovery_skill_catalog

        write_discovery_skill_catalog()
    except Exception:
        pass

    needs_auth = _needs_auth_slots_for_platform_accounts(imported_platform)

    return {
        "ok": True,
        "imported": imported,
        "imported_platform_accounts": imported_platform,
        "group_id": resolved_group_id or UNGROUPED_GROUP_ID,
        "needs_auth": needs_auth,
    }


def _attach_imported_feed(feed_id: str, group_id: str | None = None) -> None:
    fid = (feed_id or "").strip()
    if not fid:
        return
    if feed_registry.is_hidden(fid):
        feed_registry.unhide_feed(fid)
    feed_registry.assign_feed_to_group(fid, group_id)


def _import_one_skill(
    slug: str,
    files: dict[str, str],
    *,
    overwrite: bool,
    manifest: dict[str, Any],
) -> dict[str, Any]:
    slug = validate_slug(slug)
    if is_platform_skill_slug(slug):
        raise ValueError("内置平台 skill 不可导入")

    skill_dir = skill_dir_for(slug)
    exists = skill_dir.is_dir()
    if exists and not overwrite:
        raise ValueError(f"本地已有 skill「{_skill_dir_name(slug)}」，请勾选覆盖后再导入")

    _write_skill_tree(skill_dir, files)
    discover = skill_dir / "scripts" / "discover.py"
    if not discover.is_file():
        raise ValueError(f"{slug} 目录缺少 scripts/discover.py")

    feed_id = str(manifest.get("feed_id") or _extract_feed_id(skill_dir) or f"website:{slug}")
    return {
        "slug": slug,
        "skill_id": _skill_dir_name(slug),
        "feed_id": feed_id,
        "name": str(manifest.get("name") or slug),
        "overwritten": exists,
    }


def discovery_skill_exists(slug: str) -> bool:
    try:
        normalized = validate_slug(slug)
    except ValueError:
        return False
    return skill_dir_for(normalized).is_dir()
