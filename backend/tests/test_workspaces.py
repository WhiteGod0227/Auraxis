import hashlib
import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.auth import COOKIE, fingerprint
from app.core.config import Settings, get_settings
from app.main import app

ORIGIN = {"Origin": "http://localhost:5173"}


def configuration(kind="relative_value"):
    selection = {"mode": "explicit", "value": "2026-10-30"}
    if kind == "relative_value":
        return dict(
            kind=kind,
            query=dict(
                pair="GOLDM-GOLDTEN",
                window=10,
                min_periods=5,
                purity=False,
                carry_adjusted=False,
                min_volume_grams=0,
                min_oi_grams=0,
                expiry=None,
                start=None,
                end=None,
            ),
            expiry=selection,
        )
    if kind == "term_structure":
        return dict(
            kind=kind,
            curve=dict(product="GOLDTEN", purity=False, date=None),
            roll=dict(
                product="GOLDTEN", purity=False, expiry=None, start=None, end=None
            ),
            curve_expiry=selection,
            roll_expiry={"mode": "latest", "value": None},
        )
    return dict(
        kind=kind,
        query=dict(
            pair="GOLDTEN-GOLDPETAL",
            expiry=None,
            window=10,
            min_periods=5,
            z_entry=1,
            z_exit=0,
            max_hold_sessions=5,
            expiry_buffer_calendar_days=0,
            min_volume_grams=0,
            min_oi_grams=0,
            notional_per_leg=1000000,
            cost_bps_per_leg_per_side=0,
            purity=False,
            sizing_mode="integer_lots",
        ),
        expiry=selection,
    )


def payload(kind="relative_value"):
    return dict(
        title="October research",
        notes="<script>alert('plain text')</script>",
        configuration_version=1,
        configuration=configuration(kind),
        saved_context={"data_as_of": "2026-10-01", "source": "Offline snapshot"},
    )


@pytest.fixture
def workspace_client(tmp_path):
    settings = Settings(
        auth_database_path=tmp_path / "auth.sqlite3",
        workspace_database_path=tmp_path / "private.sqlite3",
        database_url=f"sqlite:///{(tmp_path / 'market.sqlite3').as_posix()}",
    )
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app, headers=ORIGIN, raise_server_exceptions=False) as client:
        # Real disposable sessions without repeating expensive password hashes.
        from app.api.auth import database

        with database(settings) as db:
            for owner in (1, 2):
                db.execute(
                    "INSERT INTO users VALUES (?,?,?,?)",
                    (
                        owner,
                        f"User {owner}",
                        f"user{owner}@example.test",
                        "not-a-password",
                    ),
                )
                db.execute(
                    "INSERT INTO sessions VALUES (?,?,?)",
                    (fingerprint(f"test-token-{owner}"), owner, 9999999999),
                )
        client.cookies.set(COOKIE, "test-token-1")
        yield client, settings
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)


@pytest.mark.parametrize("kind", ["relative_value", "term_structure", "backtest"])
def test_roundtrip_crud_plaintext_and_revision(workspace_client, kind):
    client, _ = workspace_client
    body = payload(kind)
    response = client.post("/api/workspaces", json=body)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved.items() >= body.items()
    assert saved["owner_id"] == 1 and saved["revision"] == 1
    assert "private" in response.headers["cache-control"]
    url = f"/api/workspaces/{saved['id']}"
    assert client.get(url).json() == saved
    assert client.get("/api/workspaces").json()["items"] == [saved]
    edit = {"revision": 1, "title": "Renamed", "notes": "personal"}
    updated = client.patch(url, json=edit).json()
    assert (
        updated["revision"] == 2 and updated["configuration"] == saved["configuration"]
    )
    assert updated["created_at"] == saved["created_at"]
    assert updated["updated_at"] >= updated["created_at"]
    assert client.patch(url, json=edit).status_code == 409
    assert client.delete(url, params={"revision": 1}).status_code == 409
    assert client.delete(url, params={"revision": 2}).status_code == 204
    assert client.get(url).status_code == 404


def test_two_users_and_missing_indistinguishable(workspace_client):
    client, _ = workspace_client
    saved = client.post("/api/workspaces", json=payload()).json()
    client.cookies.set(COOKIE, "test-token-2")
    assert client.get("/api/workspaces").json()["total"] == 0
    for id_ in (saved["id"], str(uuid4())):
        url = f"/api/workspaces/{id_}"
        for response in (
            client.get(url),
            client.patch(url, json={"revision": 1, "title": "x", "notes": ""}),
            client.delete(url, params={"revision": 1}),
        ):
            assert response.status_code == 404 and response.json() == {
                "detail": "Workspace not found."
            }
    assert (
        client.post("/api/workspaces", json=payload("backtest")).json()["owner_id"] == 2
    )


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("get", "", None),
        ("post", "", payload()),
        ("get", f"/{uuid4()}", None),
        ("patch", f"/{uuid4()}", {"revision": 1, "title": "x", "notes": ""}),
        ("delete", f"/{uuid4()}?revision=1", None),
    ],
)
def test_auth_required_every_operation(workspace_client, method, path, body):
    client, _ = workspace_client
    client.cookies.clear()
    response = client.request(method, "/api/workspaces" + path, json=body)
    assert response.status_code == 401
    assert response.headers["cache-control"] == "private, no-store"


def test_validation_origin_pagination_legacy_and_no_private_input_echo(
    workspace_client,
):
    client, settings = workspace_client
    invalid = [
        dict(owner_id=2),
        dict(title=" "),
        dict(notes="x" * 5001),
        dict(title="x" * 121),
        dict(configuration_version=2),
        dict(created_at="2000-01-01"),
    ]
    for change in invalid:
        body = payload() | change
        response = client.post("/api/workspaces", json=body)
        assert response.status_code == 422 and "<script>" not in response.text
    for mutate in (
        lambda c: c["query"].update(pair="GOLD"),
        lambda c: c["query"].update(purity="false"),
        lambda c: c["query"].update(window=2),
        lambda c: c["expiry"].update(mode="latest"),
        lambda c: c["query"].update(secret="private"),
        lambda c: c["query"].update(start="2026-10-31", end="2026-10-01"),
        lambda c: c["query"].update(expiry="2026-11-30"),
        lambda c: c["expiry"].update(value=12345),
        lambda c: c["query"].update(window=True),
    ):
        body = payload()
        mutate(body["configuration"])
        assert client.post("/api/workspaces", json=body).status_code == 422
    assert (
        client.post(
            "/api/workspaces", json=payload(), headers={"Origin": "https://evil.test"}
        ).status_code
        == 403
    )
    saved = []
    for index in range(4):
        saved.append(
            client.post(
                "/api/workspaces", json=payload() | {"title": str(index)}
            ).json()
        )
    first = client.get("/api/workspaces?limit=2").json()
    second = client.get("/api/workspaces?limit=2&offset=2").json()
    assert first["total"] == 4 and first["items"] == list(reversed(saved))[:2]
    assert len({w["id"] for w in first["items"] + second["items"]}) == 4
    assert client.get("/api/workspaces?limit=51").status_code == 422
    assert client.get("/api/workspaces?offset=10001").status_code == 422
    with sqlite3.connect(settings.workspace_database_path) as db:
        db.execute(
            "UPDATE workspaces SET configuration_version=99 WHERE id=?",
            (saved[0]["id"],),
        )
    assert client.get(f"/api/workspaces/{saved[0]['id']}").status_code == 409


def test_expired_session_and_storage_guards_keep_auth_and_market(workspace_client):
    client, settings = workspace_client
    auth_hash = hashlib.sha256(settings.auth_database_path.read_bytes()).digest()
    market = settings.auth_database_path.parent / "market.sqlite3"
    market.write_bytes(b"untouched market sentinel")
    assert client.post("/api/workspaces", json=payload()).status_code == 201
    assert (
        hashlib.sha256(settings.auth_database_path.read_bytes()).digest() == auth_hash
    )
    assert market.read_bytes() == b"untouched market sentinel"
    for bad_path in (settings.auth_database_path, market):
        settings.workspace_database_path = bad_path
        response = client.get("/api/workspaces")
        assert response.status_code == 503 and str(bad_path) not in response.text
    with sqlite3.connect(settings.auth_database_path) as db:
        db.execute("UPDATE sessions SET expires_at=0")
    assert client.get("/api/workspaces").status_code == 401


def test_explicit_curve_date_and_latest_roundtrip(workspace_client):
    client, _ = workspace_client
    for date in (None, "2026-09-14"):
        body = payload("term_structure")
        body["configuration"]["curve"]["date"] = date
        result = client.post("/api/workspaces", json=body).json()
        assert result["configuration"] == body["configuration"]
    body = payload("relative_value")
    body["configuration"]["expiry"] = {"mode": "latest", "value": None}
    assert (
        client.post("/api/workspaces", json=body).json()["configuration"]
        == body["configuration"]
    )


def test_safe_server_error_and_workspaces_never_exported(workspace_client):
    from app.export_snapshots import ROUTES

    client, settings = workspace_client
    settings.workspace_database_path = settings.auth_database_path.parent
    response = client.post("/api/workspaces", json=payload())
    assert response.status_code == 500
    assert response.headers["cache-control"] == "private, no-store"
    assert "<script>" not in response.text
    assert str(settings.workspace_database_path) not in response.text
    assert not any("workspace" in endpoint for endpoint in ROUTES)
