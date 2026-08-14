from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient

from main import create_app, empty_lifespan


def test_list_skills_endpoint() -> None:
    app = create_app(lifespan_override=empty_lifespan)
    with patch("api.health.feed_client"):
        client = TestClient(app)
        response = client.get("/api/skills")

    assert response.status_code == 200
    payload = response.json()
    assert "discovery" in payload
    assert "digest" in payload
    assert "chat" in payload
    assert isinstance(payload["discovery"], list)
    assert len(payload["discovery"]) >= 1


def test_list_digest_skills_endpoint() -> None:
    app = create_app(lifespan_override=empty_lifespan)
    with patch("api.health.feed_client"):
        client = TestClient(app)
        response = client.get("/api/skills/digest")

    assert response.status_code == 200
    payload = response.json()
    assert "skills" in payload
    assert "default_digest_skill" in payload
    assert isinstance(payload["skills"], list)


def test_get_discovery_skill_detail() -> None:
    detail = {
        "id": "demo",
        "name": "demo",
        "category": "discovery",
        "description": "demo source",
        "builtin": True,
        "readonly": True,
        "deletable": True,
        "path": "skills/discovery/demo-discovery",
        "skill_md": "---\nname: demo\ndescription: d\n---\n\n",
        "source_yaml": "id: demo\n",
        "files": [{"path": "source.yaml", "content": "id: demo\n"}],
    }
    app = create_app(lifespan_override=empty_lifespan)
    with patch("api.skills.get_discovery_skill_detail", return_value=detail):
        with patch("api.health.feed_client"):
            client = TestClient(app)
            response = client.get("/api/skills/discovery/demo")

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "demo"
    assert payload["category"] == "discovery"
    assert payload["source_yaml"]


def test_get_unknown_discovery_skill_returns_404() -> None:
    app = create_app(lifespan_override=empty_lifespan)
    with patch("api.health.feed_client"):
        client = TestClient(app)
        response = client.get("/api/skills/discovery/not-a-real-slug-xyz")

    assert response.status_code == 404
