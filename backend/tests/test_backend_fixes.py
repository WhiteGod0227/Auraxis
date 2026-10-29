import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.exc import OperationalError

from app.api.auth import COOKIE, password_hash
from app.api.foundation import health_data
from app.core.config import Settings, get_settings
from app.data import loader
from app.data.loader import bhav, ingestion_attempts, volume_mismatches
from app.main import app
from tests import test_auth, test_workspaces

account_client = test_auth.account_client
workspace_client = test_workspaces.workspace_client
SAMPLE = Path(__file__).parent / "fixtures/csv_loader/BhavCopyDateWise_01102026.csv"


def test_new_account_has_actual_utc_creation_date_and_keeps_it_after_edit(
    account_client,
):
    client, settings = account_client
    before = datetime.now(UTC)
    assert test_auth.register(client).status_code == 201
    first = client.get("/api/auth/profile").json()["user"]
    timestamp = datetime.fromisoformat(first["created_at"].replace("Z", "+00:00"))
    assert before <= timestamp <= datetime.now(UTC)
    assert timestamp.utcoffset().total_seconds() == 0
    cookie = client.cookies.get(COOKIE)
    updated = client.patch("/api/auth/profile", json={"name": "Updated"})
    assert updated.status_code == 200
    assert updated.json()["user"]["created_at"] == first["created_at"]
    assert client.cookies.get(COOKIE) == cookie
    assert client.post("/api/auth/logout").status_code == 204
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "demo@example.com", "password": "Sample-pass-123"},
        ).status_code
        == 200
    )
    assert (
        client.get("/api/auth/profile").json()["user"]["created_at"]
        == first["created_at"]
    )


def test_new_metadata_does_not_backfill_or_block_legacy_accounts(workspace_client):
    client, settings = workspace_client
    assert client.get("/api/auth/profile").json()["user"]["created_at"] is None
    with sqlite3.connect(settings.auth_database_path) as db:
        db.execute(
            "UPDATE users SET password_hash=? WHERE id=2",
            (password_hash("Legacy-test-password"),),
        )
        before = db.execute("SELECT * FROM users ORDER BY id").fetchall()
    assert test_auth.register(client).status_code == 201
    # Signup intentionally rotates the submitting browser's old session. The
    # other legacy account/session must remain untouched and usable.
    client.cookies.clear()
    client.cookies.set(COOKIE, "test-token-2")
    legacy = client.get("/api/auth/profile")
    assert legacy.status_code == 200
    assert legacy.json()["user"]["id"] == 2
    assert legacy.json()["user"]["created_at"] is None
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "user2@example.test", "password": "Legacy-test-password"},
        ).status_code
        == 200
    )
    assert client.get("/api/auth/profile").json()["user"]["created_at"] is None
    with sqlite3.connect(settings.auth_database_path) as db:
        assert (
            db.execute("SELECT * FROM users WHERE id<=2 ORDER BY id").fetchall()
            == before
        )
        assert db.execute("SELECT count(*) FROM account_metadata").fetchone()[0] == 1


def test_import_attempts_and_row_warnings_are_durable_but_bhav_is_idempotent(tmp_path):
    raw = pd.read_csv(SAMPLE, dtype=str, keep_default_na=False)
    raw.loc[0, "Volume(In 000's)"] = "0.001 GRMS"
    path = tmp_path / SAMPLE.name
    raw.to_csv(path, index=False)
    settings = Settings(
        _env_file=None, database_url=f"sqlite:///{tmp_path / 'market.db'}"
    )
    engine = create_engine(settings.database_url)
    try:
        first = loader.load_file(path, settings=settings, engine=engine)
        second = loader.load_file(path, settings=settings, engine=engine)
        assert first.status == second.status == "ok"
        assert first.volume_warnings[0]["reason"] == "volume_grams_mismatch"
        with engine.connect() as db:
            assert db.scalar(select(func.count()).select_from(bhav)) == first.rows_kept
            assert db.scalar(select(func.count()).select_from(ingestion_attempts)) == 2
            assert db.scalar(select(func.count()).select_from(volume_mismatches)) == (
                len(first.volume_warnings) * 2
            )
        previous = dict(app.dependency_overrides)
        app.dependency_overrides[get_settings] = lambda: settings
        try:
            with TestClient(app) as client:
                response = client.get("/api/data-health?diagnostic_limit=1")
                assert response.status_code == 200
                body = response.json()
                assert body["ingestion_history"]["total_count"] == 2
                assert body["ingestion_history"]["truncated"]
                assert body["volume_mismatches"]["available"]
                assert body["volume_mismatches"]["returned_count"] == 1
                assert "volume_text" not in body["volume_mismatches"]["items"][0]
                assert str(tmp_path) not in json.dumps(body)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous)
    finally:
        engine.dispose()


def test_loader_cli_skips_only_byte_identical_browser_copies(
    tmp_path, monkeypatch, capsys
):
    canonical = tmp_path / SAMPLE.name
    canonical.write_bytes(SAMPLE.read_bytes())
    copy = tmp_path / "BhavCopyDateWise_01102026 (1).csv"
    copy.write_bytes(SAMPLE.read_bytes())
    settings = Settings(
        _env_file=None, database_url=f"sqlite:///{tmp_path / 'market.db'}"
    )
    monkeypatch.setattr(loader, "get_settings", lambda: settings)
    monkeypatch.setattr("sys.argv", ["loader", "--dir", str(tmp_path)])
    loader.main()
    assert "skipped identical copy" in capsys.readouterr().out
    with sqlite3.connect(tmp_path / "market.db") as db:
        assert db.execute("SELECT count(*) FROM data_health").fetchone()[0] == 1
    # A different/malformed copy is not silently treated as the canonical source.
    copy.write_text("different content", encoding="utf-8")
    result = loader.load_file(copy, settings=settings)
    assert result.status == "error"
    assert result.notes.startswith("Expected filename")


def test_persistence_failure_rolls_back_rows_and_success_audit_together(tmp_path):
    settings = Settings(
        _env_file=None, database_url=f"sqlite:///{tmp_path / 'market.db'}"
    )
    engine = create_engine(settings.database_url)
    loader.metadata.create_all(engine)
    failed = False

    def fail_once(connection, cursor, statement, parameters, context, executemany):
        nonlocal failed
        if statement.startswith("INSERT INTO data_health") and not failed:
            failed = True
            raise OperationalError(
                statement, {}, Exception("private database location")
            )

    event.listen(engine, "before_cursor_execute", fail_once)
    try:
        result = loader.load_file(SAMPLE, settings=settings, engine=engine)
        assert result.status == "error" and result.rows_kept == 0
        with engine.connect() as db:
            assert db.scalar(select(func.count()).select_from(bhav)) == 0
            attempts = db.execute(select(ingestion_attempts)).mappings().all()
            assert len(attempts) == 1 and attempts[0]["status"] == "error"
            assert db.scalar(select(func.count()).select_from(volume_mismatches)) == 0
            body = health_data(
                min_volume_grams=None,
                diagnostic_limit=20,
                connection=db,
                settings=settings,
            )
            assert "private database location" not in repr(body)
            assert body["ingestion_history"]["items"][0]["error_summary"] == (
                "Database persistence failed; no partial import."
            )
    finally:
        event.remove(engine, "before_cursor_execute", fail_once)
        engine.dispose()
