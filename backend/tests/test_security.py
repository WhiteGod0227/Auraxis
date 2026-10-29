import base64
import sqlite3

from app.api import security
from tests import test_auth

account_client = test_auth.account_client
PASSWORD = "Sample-pass-123"


def test_rfc6238_sha1_vectors():
    secret = base64.b32encode(b"12345678901234567890").decode().rstrip("=")
    for timestamp, expected in [
        (59, "94287082"),
        (1111111109, "07081804"),
        (1111111111, "14050471"),
        (1234567890, "89005924"),
        (2000000000, "69279037"),
        (20000000000, "65353130"),
    ]:
        assert security.totp(secret, timestamp // 30, 8) == expected


def test_auth_store_rejects_public_and_shared_paths(tmp_path):
    import pytest
    from fastapi import HTTPException

    from app.api.auth import database
    from app.core.config import BACKEND_DIR, Settings

    frontend = BACKEND_DIR.parent / "frontend"
    for target in [
        frontend / "public" / "must-not-create.sqlite3",
        frontend / "dist" / "must-not-create.sqlite3",
        tmp_path / "shared.sqlite3",
    ]:
        settings = Settings(
            auth_database_path=target,
            workspace_database_path=tmp_path / "shared.sqlite3",
        )
        with pytest.raises(HTTPException) as error:
            with database(settings):
                pass
        assert error.value.status_code == 503
        assert not target.exists()


def test_password_change_revokes_sessions_and_requires_current_password(account_client):
    client, _ = account_client
    test_auth.register(client)
    response = client.post(
        "/api/auth/security/password",
        json={"password": "wrong", "new_password": "Replacement-pass-123"},
    )
    assert response.status_code == 401
    assert client.get("/api/auth/me").status_code == 200
    response = client.post(
        "/api/auth/security/password",
        json={"password": PASSWORD, "new_password": "Replacement-pass-123"},
    )
    assert response.status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert (
        client.post(
            "/api/auth/login", json={"email": "demo@example.com", "password": PASSWORD}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "demo@example.com", "password": "Replacement-pass-123"},
        ).status_code
        == 200
    )


def test_offline_recovery_single_use_and_hash_only(account_client):
    client, settings = account_client
    test_auth.register(client)
    response = client.post(
        "/api/auth/security/recovery-codes", json={"password": PASSWORD}
    )
    assert response.status_code == 200
    codes = response.json()["recovery_codes"]
    assert len(set(codes)) == 8
    with sqlite3.connect(settings.auth_database_path) as db:
        raw = str(db.execute("SELECT * FROM recovery_codes").fetchall())
        assert all(code not in raw for code in codes)
    assert client.get("/api/auth/security").json()["email_verified"] is False
    assert client.get("/api/auth/security").json()["recovery_codes_remaining"] == 8
    body = {
        "email": "demo@example.com",
        "recovery_code": codes[0],
        "new_password": "Recovered-pass-123",
    }
    assert client.post("/api/auth/security/recover", json=body).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/security/recover", json=body).status_code == 401
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "demo@example.com", "password": "Recovered-pass-123"},
        ).status_code
        == 200
    )
    assert client.get("/api/auth/security").json()["recovery_codes_remaining"] == 7


def test_mfa_enrollment_required_at_login_and_replay_prevented(
    account_client, monkeypatch
):
    clock = [1700000000]
    monkeypatch.setattr(security.time, "time", lambda: clock[0])
    client, _ = account_client
    test_auth.register(client)
    setup = client.post("/api/auth/security/mfa/setup", json={"password": PASSWORD})
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    assert client.get("/api/auth/security").json()["mfa_enabled"] is False
    assert "secret" not in client.get("/api/auth/security").text
    assert (
        client.post(
            "/api/auth/security/mfa/confirm", json={"password": PASSWORD, "code": "bad"}
        ).status_code
        == 401
    )
    code = security.totp(secret, clock[0] // 30)
    confirmed = client.post(
        "/api/auth/security/mfa/confirm", json={"password": PASSWORD, "code": code}
    )
    assert confirmed.status_code == 200
    assert client.get("/api/auth/me").status_code == 200
    codes = confirmed.json()["recovery_codes"]
    assert client.get("/api/auth/security").json()["mfa_enabled"] is True
    client.cookies.clear()
    login = {"email": "demo@example.com", "password": PASSWORD}
    assert client.post("/api/auth/login", json=login).status_code == 401
    assert (
        client.post("/api/auth/login", json={**login, "otp": code}).status_code == 401
    )
    clock[0] += 30
    assert (
        client.post(
            "/api/auth/login",
            json={**login, "otp": security.totp(secret, clock[0] // 30)},
        ).status_code
        == 200
    )
    assert (
        client.post("/api/auth/login", json={**login, "otp": codes[0]}).status_code
        == 200
    )
    assert (
        client.post("/api/auth/login", json={**login, "otp": codes[0]}).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/security/mfa/disable",
            json={"password": PASSWORD, "code": codes[1]},
        ).status_code
        == 200
    )
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json=login).status_code == 200
    assert client.get("/api/auth/security").json()["recovery_codes_remaining"] == 0


def test_setup_expiry_origin_validation_and_throttling(account_client, monkeypatch):
    clock = [1700000000]
    monkeypatch.setattr(security.time, "time", lambda: clock[0])
    client, _ = account_client
    test_auth.register(client)
    setup = client.post(
        "/api/auth/security/mfa/setup", json={"password": PASSWORD}
    ).json()
    clock[0] += 601
    assert (
        client.post(
            "/api/auth/security/mfa/confirm",
            json={
                "password": PASSWORD,
                "code": security.totp(setup["secret"], clock[0] // 30),
            },
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/api/auth/security/password",
            headers={"Origin": "https://evil.test"},
            json={"password": PASSWORD, "new_password": "Next-password-123"},
        ).status_code
        == 403
    )
    invalid = client.post(
        "/api/auth/security/password",
        json={"password": "PRIVATE-SECRET", "new_password": "short"},
    )
    assert invalid.status_code == 422
    assert "PRIVATE-SECRET" not in invalid.text
    for _ in range(4):
        assert (
            client.post(
                "/api/auth/security/password",
                json={"password": "wrong", "new_password": "Next-password-123"},
            ).status_code
            == 401
        )
    assert (
        client.post(
            "/api/auth/security/password",
            json={"password": "wrong", "new_password": "Next-password-123"},
        ).status_code
        == 429
    )
