from __future__ import annotations

import base64
import io
import zipfile

import pytest

from skills.skill_package import (
    export_discovery_skills,
    import_discovery_zip,
    parse_discovery_zip_package,
)


def test_parse_discovery_zip_package_reads_skill_tree(
    sample_discovery_skill: str,
    isolated_discovery_root,
) -> None:
    payload, _, _ = export_discovery_skills([sample_discovery_skill])
    package = parse_discovery_zip_package(payload)

    assert len(package["skills"]) == 1
    skill = package["skills"][0]
    assert skill["slug"] == sample_discovery_skill
    assert skill["skill_id"] == f"{sample_discovery_skill}-discovery"
    paths = {item["path"] for item in skill["files"]}
    assert "scripts/discover.py" in paths
    assert "source.yaml" in paths


def test_export_import_roundtrip(
    sample_discovery_skill: str,
    isolated_discovery_root,
    isolated_feed_registry,
    mock_feed_client,
) -> None:
    slug = sample_discovery_skill
    skill_dir = isolated_discovery_root / f"{slug}-discovery"

    payload, filename, count = export_discovery_skills([slug])
    assert count == 1
    assert filename == f"{slug}-discovery.zip"

    import shutil

    shutil.rmtree(skill_dir)
    assert not skill_dir.exists()

    result = import_discovery_zip(payload, overwrite=True)
    assert result["ok"] is True
    assert len(result["imported"]) == 1
    assert result["imported"][0]["slug"] == slug
    assert (skill_dir / "scripts" / "discover.py").is_file()
    mock_feed_client.reload_skills.assert_called()
    mock_feed_client.ensure_feed_visible.assert_called()


def test_import_without_overwrite_raises_when_exists(
    sample_discovery_skill: str,
    isolated_discovery_root,
    mock_feed_client,
) -> None:
    payload, _, _ = export_discovery_skills([sample_discovery_skill])

    with pytest.raises(ValueError, match="请勾选覆盖"):
        import_discovery_zip(payload, overwrite=False)


def test_parse_rejects_empty_zip() -> None:
    with pytest.raises(ValueError, match="zip 文件为空"):
        parse_discovery_zip_package(b"")


def test_parse_bundle_zip_with_platform_accounts() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr(
            "askme-skills/platform-accounts/manifest.json",
            (
                '{"format_version":1,"kind":"platform_accounts","accounts":'
                '[{"feed_id":"website:x:demo","platform":"x","account_key":"demo",'
                '"display_name":"Demo"}]}'
            ),
        )
    package = parse_discovery_zip_package(buffer.getvalue())
    assert package["skills"] == []
    assert len(package["platform_accounts"]) == 1
    assert package["platform_accounts"][0]["feed_id"] == "website:x:demo"


def test_api_parse_zip_endpoint(sample_discovery_skill: str, isolated_discovery_root) -> None:
    from unittest.mock import patch

    from fastapi.testclient import TestClient

    from main import create_app, empty_lifespan

    payload, _, _ = export_discovery_skills([sample_discovery_skill])
    body = {"zip_base64": base64.b64encode(payload).decode("ascii")}

    app = create_app(lifespan_override=empty_lifespan)
    with patch("api.health.feed_client"):
        client = TestClient(app)
        response = client.post("/api/skills/discovery/parse-zip", json=body)

    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    assert data["skills"][0]["slug"] == sample_discovery_skill
