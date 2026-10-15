import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from app.api.auth import COOKIE, fingerprint, password_matches
from app.core.config import Settings, get_settings
from app.main import app


@pytest.fixture
def account_client(tmp_path):
    settings = Settings(auth_database_path=tmp_path / "accounts.sqlite3")
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        with TestClient(
            app,
            base_url="http://localhost:8010",
            headers={"Origin": "http://localhost:5173"},
        ) as client:
            yield client, settings
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def register(client):
    return client.post(
        "/api/auth/signup",
        json={
            "name": "Researcher",
            "email": "Demo@Example.com",
            "password": "Sample-pass-123",
        },
    )


def test_signup_hash_cookie_restore_rotation_and_logout(account_client):
    client, settings = account_client
    created = register(client)
    assert created.status_code == 201
    assert created.json()["user"] == {
        "id": 1,
        "name": "Researcher",
        "email": "demo@example.com",
    }
    assert "password" not in created.text
    assert "httponly" in created.headers["set-cookie"].lower()
    assert "samesite=lax" in created.headers["set-cookie"].lower()
    assert created.headers["access-control-allow-credentials"] == "true"
    assert created.headers["cache-control"] == "no-store"
    token = client.cookies.get(COOKIE)
    with sqlite3.connect(settings.auth_database_path) as db:
        hashed = db.execute("SELECT password_hash FROM users").fetchone()[0]
        stored = db.execute("SELECT token_hash FROM sessions").fetchone()[0]
    assert hashed != "Sample-pass-123" and password_matches("Sample-pass-123", hashed)
    assert stored == fingerprint(token) and stored != token
    assert client.get("/api/auth/me").json() == created.json()
    logged_in = client.post(
        "/api/auth/login",
        json={"email": "DEMO@example.com", "password": "Sample-pass-123"},
    )
    assert logged_in.status_code == 200 and "password" not in logged_in.text
    assert client.cookies.get(COOKIE) != token
    old = client.get("/api/auth/me", headers={"Cookie": f"{COOKIE}={token}"})
    assert old.status_code == 401
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_invalid_login_duplicate_signup_and_safe_validation(account_client):
    client, _ = account_client
    assert register(client).status_code == 201
    assert register(client).status_code == 409
    for email in ("demo@example.com", "missing@example.com"):
        response = client.post(
            "/api/auth/login", json={"email": email, "password": "Wrong-password-123"}
        )
        assert (
            response.status_code == 401
            and response.json()["detail"] == "Email or password is incorrect."
        )
    invalid = client.post(
        "/api/auth/signup", json={"name": "x", "email": "bad", "password": "secret"}
    )
    assert invalid.status_code == 422 and "secret" not in invalid.text


def test_origin_guard_and_login_rate_limit(account_client):
    client, _ = account_client
    denied = client.post(
        "/api/auth/signup",
        headers={"Origin": "https://untrusted.example"},
        json={"name": "x", "email": "a@example.com", "password": "Sample-pass-123"},
    )
    assert denied.status_code == 403
    assert register(client).status_code == 201
    for _ in range(5):
        assert (
            client.post(
                "/api/auth/login",
                json={"email": "demo@example.com", "password": "wrong"},
            ).status_code
            == 401
        )
    assert (
        client.post(
            "/api/auth/login", json={"email": "demo@example.com", "password": "wrong"}
        ).status_code
        == 429
    )


def test_expiry_secure_cookie_and_separate_storage(account_client):
    client, settings = account_client
    settings.auth_cookie_secure = True
    client.base_url = "https://localhost:8010"
    created = register(client)
    assert (
        created.status_code == 201 and "secure" in created.headers["set-cookie"].lower()
    )
    assert client.get("/api/auth/me").status_code == 200
    with sqlite3.connect(settings.auth_database_path) as db:
        db.execute("UPDATE sessions SET expires_at=?", (int(time.time()) - 1,))
    assert client.get("/api/auth/me").status_code == 401


def test_auth_database_cannot_be_market_database(account_client):
    from app.api.auth import database

    _, settings = account_client
    settings.database_url = f"sqlite:///{settings.auth_database_path.as_posix()}"
    with pytest.raises(RuntimeError, match="separate"):
        with database(settings):
            pass
