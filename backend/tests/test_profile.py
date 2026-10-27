import hashlib
import sqlite3

import pytest

from app.api.auth import COOKIE
from app.export_snapshots import ROUTES
from tests import test_workspaces as workspace_tests
from tests.test_workspaces import payload

workspace_client = workspace_tests.workspace_client


def test_legacy_profile_update_preserves_identity_sessions_password_and_workspace(
    workspace_client,
):
    client, settings = workspace_client
    workspace = client.post("/api/workspaces", json=payload()).json()
    workspace_hash = hashlib.sha256(
        settings.workspace_database_path.read_bytes()
    ).digest()
    cookie = client.cookies.get(COOKIE)
    with sqlite3.connect(settings.auth_database_path) as db:
        before = db.execute("SELECT * FROM users ORDER BY id").fetchall()
        sessions = db.execute("SELECT * FROM sessions ORDER BY token_hash").fetchall()
        schema = db.execute("SELECT sql FROM sqlite_master ORDER BY name").fetchall()
    loaded = client.get("/api/auth/profile")
    assert loaded.status_code == 200
    assert loaded.json()["user"] == {
        "id": 1,
        "name": "User 1",
        "email": "user1@example.test",
        "created_at": None,
    }
    assert loaded.headers["cache-control"] == "private, no-store"
    response = client.patch("/api/auth/profile", json={"name": "  आयुष सिंह Élodie  "})
    assert (
        response.status_code == 200
        and response.json()["user"]["name"] == "आयुष सिंह Élodie"
    )
    assert response.json()["user"]["created_at"] is None
    assert client.get("/api/auth/me").json()["user"]["name"] == "आयुष सिंह Élodie"
    assert client.cookies.get(COOKIE) == cookie
    assert client.get(f"/api/workspaces/{workspace['id']}").json() == workspace
    assert (
        hashlib.sha256(settings.workspace_database_path.read_bytes()).digest()
        == workspace_hash
    )
    with sqlite3.connect(settings.auth_database_path) as db:
        after = db.execute("SELECT * FROM users ORDER BY id").fetchall()
        assert after[0] == (before[0][0], "आयुष सिंह Élodie", *before[0][2:])
        assert after[1] == before[1]
        assert (
            db.execute("SELECT * FROM sessions ORDER BY token_hash").fetchall()
            == sessions
        )
        assert (
            db.execute("SELECT sql FROM sqlite_master ORDER BY name").fetchall()
            == schema
        )
    client.cookies.set(COOKIE, "test-token-2")
    assert client.get("/api/auth/profile").json()["user"]["id"] == 2
    assert client.get("/api/auth/profile").json()["user"]["name"] == "User 2"
    assert not any("auth" in path or "profile" in path for path in ROUTES)


@pytest.mark.parametrize(
    "name",
    [
        "",
        "   ",
        "x" * 101,
        "x\n",
        "\tx",
        "a\x00b",
        "a\x7fb",
        "a\u202eb",
        "a\u2028b",
        123,
        None,
    ],
)
def test_invalid_name_is_safe_and_does_not_change_profile(workspace_client, name):
    client, _ = workspace_client
    before = client.get("/api/auth/me").json()
    response = client.patch("/api/auth/profile", json={"name": name})
    assert response.status_code == 422
    assert response.headers["cache-control"] == "private, no-store"
    assert "user1@example.test" not in response.text
    assert client.get("/api/auth/me").json() == before


@pytest.mark.parametrize(
    "extra",
    [
        {"id": 2},
        {"user_id": 2},
        {"email": "other@example.test"},
        {"role": "admin"},
        {"created_at": "2026-10-22T00:00:00Z"},
        {"password_hash": "private"},
    ],
)
def test_protected_fields_rejected(workspace_client, extra):
    client, _ = workspace_client
    response = client.patch("/api/auth/profile", json={"name": "Changed", **extra})
    assert response.status_code == 422 and "private" not in response.text
    assert client.get("/api/auth/me").json()["user"]["name"] == "User 1"


def test_unauthenticated_expired_origin_and_safe_errors(workspace_client):
    client, settings = workspace_client
    assert (
        client.patch(
            "/api/auth/profile",
            json={"name": "Changed"},
            headers={"Origin": "https://evil.test"},
        ).status_code
        == 403
    )
    client.cookies.clear()
    for response in (
        client.get("/api/auth/profile"),
        client.patch("/api/auth/profile", json={"name": "Name"}),
    ):
        assert response.status_code == 401
        assert response.headers["cache-control"] == "private, no-store"
    client.cookies.set(COOKIE, "test-token-1")
    with sqlite3.connect(settings.auth_database_path) as db:
        db.execute("UPDATE sessions SET expires_at=0")
    assert client.get("/api/auth/profile").status_code == 401
    settings.auth_database_path = settings.auth_database_path.parent
    response = client.get("/api/auth/profile")
    assert response.status_code == 500
    assert response.headers["cache-control"] == "private, no-store"
    assert str(settings.auth_database_path) not in response.text
