from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import create_app, empty_lifespan


def test_health_endpoint() -> None:
    app = create_app(lifespan_override=empty_lifespan)
    with patch("api.health.feed_client") as mock_feed_client:
        mock_feed_client.list_feeds = AsyncMock(return_value=[{"id": "website:demo"}])
        client = TestClient(app)
        response = client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["feed_count"] == 1
