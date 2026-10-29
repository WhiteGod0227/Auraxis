"""Real local HTTP acceptance with disposable auth/workspace storage, no browser."""

import hashlib
import logging
import os
import secrets
import socket
import sys
import tempfile
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
import uvicorn

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.core.config import get_settings  # noqa: E402
from app.export_snapshots import DEFAULT_OUTPUT, verify_snapshot_set  # noqa: E402
from app.main import app  # noqa: E402


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def verify():
    logging.getLogger("httpx").setLevel(logging.WARNING)
    real = get_settings()
    auth_path = (BACKEND / real.auth_database_path).resolve()
    # Main market database is only read by the shared research endpoints.
    from sqlalchemy.engine import make_url

    market = (BACKEND / make_url(real.database_url).database).resolve()
    before = {path: digest(path) for path in (market, auth_path)}
    manifest = DEFAULT_OUTPUT / "manifest.json"
    snapshot_hash = digest(manifest)
    with tempfile.TemporaryDirectory(prefix="auraxis-workspace-check-") as temporary:
        settings = real.model_copy(
            update={
                "auth_database_path": Path(temporary) / "auth.sqlite3",
                "workspace_database_path": Path(temporary) / "workspaces.sqlite3",
                "auth_cookie_secure": False,  # Disposable loopback HTTP only.
                "cors_origins": ["http://localhost:5173"],
            }
        )
        previous = dict(app.dependency_overrides)
        app.dependency_overrides[get_settings] = lambda: settings
        # Bind once, then pass the owned socket to avoid port selection races.
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        # Never bind a verification server to a manually managed service port.
        if port in {8000, 8010, 5173, 5180, 9222}:
            listener.close()
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous)
            raise RuntimeError("Verification selected a reserved service port.")
        print(f"Verification server: PID {os.getpid()}, ephemeral port {port}.")
        server = uvicorn.Server(
            uvicorn.Config(
                app,
                host="127.0.0.1",
                port=port,
                log_level="critical",
                access_log=False,
            )
        )
        thread = threading.Thread(
            target=server.run, kwargs={"sockets": [listener]}, daemon=True
        )
        thread.start()
        try:
            deadline = time.monotonic() + 10
            while not server.started and time.monotonic() < deadline:
                time.sleep(0.05)
            assert server.started, "Disposable HTTP server did not start."
            origin = {"Origin": "http://localhost:5173"}
            with (
                httpx.Client(
                    base_url=f"http://127.0.0.1:{port}", headers=origin
                ) as one,
                httpx.Client(
                    base_url=f"http://127.0.0.1:{port}",
                    headers=origin,
                ) as two,
            ):
                for index, client in enumerate((one, two)):
                    password = secrets.token_urlsafe(24)
                    response = client.post(
                        "/api/auth/signup",
                        json={
                            "name": "Disposable researcher",
                            "email": f"disposable-{index}@example.test",
                            "password": password,
                        },
                    )
                    assert response.status_code == 201
                    assert client.post("/api/auth/logout").status_code == 204
                    assert (
                        client.post(
                            "/api/auth/login",
                            json={
                                "email": f"disposable-{index}@example.test",
                                "password": password,
                            },
                        ).status_code
                        == 200
                    )
                    assert client.get("/api/auth/me").status_code == 200
                saved_ids = []
                for kind, endpoint, query in (
                    (
                        "relative_value",
                        "/api/spreads",
                        {
                            "pair": "GOLDM-GOLDTEN",
                            "purity": False,
                            "carry_adjusted": False,
                        },
                    ),
                    (
                        "term_structure",
                        "/api/curve",
                        {"product": "GOLDTEN", "purity": False},
                    ),
                    (
                        "backtest",
                        "/api/backtest",
                        {
                            "pair": "GOLDTEN-GOLDPETAL",
                            "purity": False,
                            "sizing_mode": "integer_lots",
                        },
                    ),
                ):
                    response = one.get(endpoint, params=query)
                    assert response.status_code == 200
                    data = response.json()
                    cfg = dict(data["configuration"])
                    cfg["purity"] = cfg.pop("use_purity_adjustment")
                    latest = {"mode": "latest", "value": None}
                    if kind == "relative_value":
                        configuration = {"kind": kind, "query": cfg, "expiry": latest}
                    elif kind == "term_structure":
                        roll = one.get("/api/rolldown", params=query).json()[
                            "configuration"
                        ]
                        roll["purity"] = roll.pop("use_purity_adjustment")
                        configuration = {
                            "kind": kind,
                            "curve": cfg,
                            "roll": roll,
                            "curve_expiry": latest,
                            "roll_expiry": latest,
                        }
                    else:
                        keys = (
                            "pair",
                            "window",
                            "min_periods",
                            "z_entry",
                            "z_exit",
                            "max_hold_sessions",
                            "expiry_buffer_calendar_days",
                            "min_volume_grams",
                            "min_oi_grams",
                            "notional_per_leg",
                            "cost_bps_per_leg_per_side",
                            "purity",
                            "sizing_mode",
                        )
                        cfg = {key: cfg[key] for key in keys}
                        cfg["expiry"] = None
                        configuration = {"kind": kind, "query": cfg, "expiry": latest}
                    created = one.post(
                        "/api/workspaces",
                        json={
                            "title": f"HTTP {kind}",
                            "notes": "Disposable plain-text note",
                            "configuration_version": 1,
                            "configuration": configuration,
                            "saved_context": {
                                "data_as_of": data["data_as_of"],
                                "source": "API",
                            },
                        },
                    )
                    assert created.status_code == 201, (
                        f"Create failed for {kind}: HTTP {created.status_code}"
                    )
                    saved = created.json()
                    assert saved["configuration"] == configuration
                    assert created.headers["cache-control"] == "private, no-store"
                    url = f"/api/workspaces/{saved['id']}"
                    assert one.get(url).json() == saved
                    assert two.get(url).status_code == 404
                    edit = {"revision": 1, "title": "Updated", "notes": "Updated note"}
                    assert two.patch(url, json=edit).status_code == 404
                    assert two.delete(url, params={"revision": 1}).status_code == 404
                    assert one.patch(url, json=edit).json()["revision"] == 2
                    assert one.patch(url, json=edit).status_code == 409
                    assert one.delete(url, params={"revision": 1}).status_code == 409
                    saved_ids.append(saved["id"])
                assert one.get("/api/workspaces").json()["total"] == 3
                assert two.get("/api/workspaces").json()["total"] == 0
                profile = one.get("/api/auth/profile")
                assert profile.status_code == 200
                created_at = profile.json()["user"]["created_at"]
                created_time = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                assert created_time.utcoffset().total_seconds() == 0
                assert created_time <= datetime.now(UTC)
                assert profile.headers["cache-control"] == "private, no-store"
                assert (
                    one.patch(
                        "/api/auth/profile", json={"name": "Not applied", "id": 2}
                    ).status_code
                    == 422
                )
                assert (
                    one.patch(
                        "/api/auth/profile", json={"name": "Invalid\nname"}
                    ).status_code
                    == 422
                )
                assert (
                    one.patch(
                        "/api/auth/profile",
                        json={"name": "Not applied"},
                        headers={"Origin": "https://untrusted.example"},
                    ).status_code
                    == 403
                )
                cookie = one.cookies.get("auraxis_session")
                workspaces_before = one.get("/api/workspaces").json()
                updated = one.patch(
                    "/api/auth/profile", json={"name": "  आयुष Élodie  "}
                )
                assert updated.status_code == 200
                assert updated.json()["user"]["name"] == "आयुष Élodie"
                assert updated.json()["user"]["created_at"] == created_at
                assert one.get("/api/auth/me").json()["user"]["name"] == "आयुष Élodie"
                assert one.cookies.get("auraxis_session") == cookie
                assert one.get("/api/workspaces").json() == workspaces_before
                assert (
                    two.get("/api/auth/profile").json()["user"]["name"]
                    == "Disposable researcher"
                )
                for identifier in saved_ids:
                    assert (
                        one.delete(
                            f"/api/workspaces/{identifier}?revision=2"
                        ).status_code
                        == 204
                    )
                assert one.post("/api/auth/logout").status_code == 204
                assert one.get("/api/workspaces").status_code == 401
                assert one.get("/api/auth/profile").status_code == 401
            print(
                "PASS: real local HTTP signup/session, "
                "three applied configurations, CRUD,"
            )
            print("two-user ownership, conflicts, private cache headers and logout.")
            print("PASS: real login -> profile -> Unicode name update -> me -> logout;")
            print("same session and saved workspaces preserved; other user unchanged.")
        finally:
            # Instance-local stop only: no signals, PID lookup or process killing.
            server.should_exit = True
            thread.join(timeout=10)
            listener.close()
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous)
            assert not thread.is_alive(), "Disposable server shutdown incomplete."
    assert all(digest(path) == value for path, value in before.items())
    assert digest(manifest) == snapshot_hash
    verified = verify_snapshot_set(DEFAULT_OUTPUT)
    assert not any("workspace" in entry["endpoint"] for entry in verified["files"])
    print(
        "PASS: market/auth databases unchanged; "
        f"{len(verified['files'])} snapshot schemas/checksums valid and unchanged."
    )
    print(
        "Disposable accounts/storage removed; existing services were not interrupted."
    )
    print(
        "Browser acceptance: NOT TESTED (this is actual HTTP, not browser interaction)."
    )


if __name__ == "__main__":
    verify()
