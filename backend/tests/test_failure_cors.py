from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.mark.parametrize(
    "origin,allowed",
    [
        ("http://localhost:5173", True),
        ("http://localhost:5180", True),
        ("https://untrusted.example", False),
    ],
)
def test_server_failure_keeps_cors_so_browser_sees_http_error(origin, allowed):
    with TestClient(app, raise_server_exceptions=False) as client:
        with patch(
            "app.api.foundation._read",
            side_effect=RuntimeError("private local details"),
        ):
            response = client.get("/api/meta", headers={"Origin": origin})
    assert response.status_code == 500
    assert response.json() == {"detail": "Unable to read research data."}
    assert response.headers.get("access-control-allow-origin") == (
        origin if allowed else None
    )
