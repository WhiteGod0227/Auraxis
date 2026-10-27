"""Offline exports: exact requests, pinned reads and atomic publication."""

import hashlib
import json
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import delete, update

from app import export_snapshots as exporter
from app.api import analytics
from app.api.analytics_schemas import BacktestResponse
from app.api.foundation import overview
from app.api.schemas import OverviewResponse
from app.data.loader import bhav
from tests.test_api_analytics import analytics_api as _source_fixture

analytics_api = _source_fixture


def read_payload(output, entry):
    return json.loads((output / entry["path"]).read_text())


def test_export_without_http_files_schemas_checksums_and_builders(
    analytics_api, tmp_path
):
    _, engine, settings = analytics_api
    output = tmp_path / "public"
    before = hashlib.sha256((tmp_path / "api.db").read_bytes()).hexdigest()
    with patch("httpx.Client", side_effect=AssertionError("No HTTP permitted")):
        manifest = exporter.export_snapshots(settings=settings, output_dir=output)
    assert len(manifest["files"]) == 49
    assert exporter.verify_snapshot_set(output) == manifest
    assert manifest["data_as_of"] == "2026-10-13"
    assert manifest["generated_at_utc"].endswith("Z")
    assert manifest["purity_verification_status"] == "unverified"
    assert len(set(manifest["supported_offline_configurations"])) == 49
    with engine.connect() as connection:
        for entry in manifest["files"]:
            payload = read_payload(output, entry)
            direct = exporter.build_payload(
                entry["endpoint"], entry["parameters"], connection, settings
            )
            assert payload == direct
            text = (output / entry["path"]).read_text()
            assert "NaN" not in text and "Infinity" not in text
            assert "database_url" not in text and str(tmp_path) not in text
            assert len((output / entry["path"]).read_bytes()) == entry["size_bytes"]
        entry = next(e for e in manifest["files"] if e["endpoint"] == "/api/overview")
        direct = OverviewResponse.model_validate(
            overview(purity=False, connection=connection, settings=settings)
        )
        assert read_payload(output, entry) == direct.model_dump(mode="json")
    assert hashlib.sha256((tmp_path / "api.db").read_bytes()).hexdigest() == before
    assert len(list(output.rglob("*.json"))) == 50


def test_canonical_matching_defaults_booleans_dates_and_customs(analytics_api):
    _, _, settings = analytics_api
    key = exporter.request_key
    path = "/api/spreads"
    query = dict(pair="GOLDM-GOLDTEN")
    applied = exporter.canonical_parameters(path, query, settings=settings)
    assert key(path, query, settings=settings) == key(path, applied, settings=settings)
    assert key(path, query) == key(
        path, dict(query, purity="false", carry_adjusted="true")
    )
    assert key(path, query) != key(path, dict(query, purity=True))
    assert key(path, query) != key(path, dict(query, carry_adjusted=False))
    assert key(path, query) != key(path, dict(query, window=12))
    assert key(path, dict(query, expiry=date(2026, 10, 30))) == key(
        path, dict(query, expiry="2026-10-30")
    )
    with pytest.raises(ValueError):
        key(path, dict(query, unknown=1))
    requests = {
        key(endpoint, params, settings=settings)
        for endpoint, params in exporter.supported_requests(settings)
    }
    assert key(path, dict(query, window=12)) not in requests
    assert key("/api/backtest", dict(pair="GOLDM-GOLDTEN")) not in requests


def test_empty_and_missing_database_exports(analytics_api, tmp_path):
    _, engine, settings = analytics_api
    with engine.begin() as connection:
        connection.execute(delete(bhav))
    output = tmp_path / "empty"
    manifest = exporter.export_snapshots(settings=settings, output_dir=output)
    assert manifest["data_as_of"] is None
    assert manifest["data_window"] == dict(first_trade_date=None, last_trade_date=None)
    for entry in manifest["files"]:
        payload = read_payload(output, entry)
        assert payload["data_available"] is False
        for field in ("reports", "series", "points"):
            if field in payload:
                assert not payload[field] or all(
                    not s["history"] for s in payload[field]
                )
    exporter.verify_snapshot_set(output)
    settings.database_url = f"sqlite:///{tmp_path / 'not-created.db'}"
    exporter.export_snapshots(settings=settings, output_dir=tmp_path / "missing")
    assert not (tmp_path / "not-created.db").exists()


@pytest.mark.parametrize("failure", ["builder", "publish"])
def test_failed_export_preserves_previous_valid_set(analytics_api, tmp_path, failure):
    _, _, settings = analytics_api
    output = tmp_path / "public"
    output.mkdir()
    unrelated = output / "unrelated.txt"
    unrelated.write_text("keep")
    old = exporter.export_snapshots(settings=settings, output_dir=output)
    saved = {e["path"]: (output / e["path"]).read_bytes() for e in old["files"]}
    manifest_bytes = (output / "manifest.json").read_bytes()
    if failure == "builder":
        original = exporter.build_payload
        calls = 0

        def fail_after_partial_stage(*args):
            nonlocal calls
            calls += 1
            if calls == 4:
                raise RuntimeError("failure")
            return original(*args)

        context = patch.object(
            exporter, "build_payload", side_effect=fail_after_partial_stage
        )
    else:
        replace = exporter.os.replace

        def fail_manifest(source, target):
            if str(target).endswith("manifest.json"):
                raise OSError("publish failed")
            return replace(source, target)

        context = patch.object(exporter.os, "replace", side_effect=fail_manifest)
    with context, pytest.raises((RuntimeError, OSError)):
        exporter.export_snapshots(settings=settings, output_dir=output)
    assert (output / "manifest.json").read_bytes() == manifest_bytes
    assert all((output / path).read_bytes() == data for path, data in saved.items())
    assert unrelated.read_text() == "keep"
    assert not list(output.glob(".staging-*"))
    assert not list(output.glob(".manifest-*"))
    exporter.verify_snapshot_set(output)


def test_consistent_view_with_concurrent_writer(analytics_api, tmp_path):
    _, engine, settings = analytics_api
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
    original = exporter.build_payload
    changed = False
    expected = None
    with engine.connect() as connection:
        expected = original("/api/overview", {"purity": False}, connection, settings)

    def interleave(endpoint, parameters, connection, settings):
        nonlocal changed
        payload = original(endpoint, parameters, connection, settings)
        if not changed:
            with engine.begin() as writer:
                writer.execute(update(bhav).values(close=99999))
            changed = True
        return payload

    with patch.object(exporter, "build_payload", side_effect=interleave):
        manifest = exporter.export_snapshots(
            settings=settings, output_dir=tmp_path / "consistent"
        )
    entry = next(e for e in manifest["files"] if e["endpoint"] == "/api/overview")
    assert read_payload(tmp_path / "consistent", entry) == expected


def test_unresolved_positions_nulls_and_flags_survive(analytics_api, tmp_path):
    _, engine, settings = analytics_api
    days = [
        date(2026, 9, 21) + timedelta(days=i)
        for i in range(23)
        if (date(2026, 9, 21) + timedelta(days=i)).weekday() < 5
    ]
    rows = []
    for i, day in enumerate(days):
        for symbol, close in [
            ("GOLDTEN", 110 if day >= date(2026, 10, 7) else 100 + i % 2),
            ("GOLDPETAL", 10),
        ]:
            rows.append(
                dict(
                    symbol=symbol,
                    trade_date=day,
                    expiry_date=date(2026, 10, 12),
                    close=close,
                    has_trade=day < date(2026, 10, 9),
                    volume_lots=1000,
                    volume_text="10 GRMS",
                    volume_grams=10000,
                    open_interest_lots=1000,
                    open_interest_grams=10000,
                )
            )
    with engine.begin() as connection:
        connection.execute(delete(bhav))
        connection.execute(bhav.insert(), rows)
    with engine.connect() as connection:
        direct = BacktestResponse.model_validate(
            analytics.backtest_api(
                pair="GOLDTEN-GOLDPETAL",
                window=10,
                min_periods=5,
                max_hold_sessions=5,
                expiry_buffer_calendar_days=3,
                connection=connection,
                settings=settings,
            )
        ).model_dump(mode="json")
    assert direct["reports"][0]["unresolved_positions"]
    output = tmp_path / "unresolved"
    manifest = exporter.export_snapshots(settings=settings, output_dir=output)
    entry = next(
        e
        for e in manifest["files"]
        if e["endpoint"] == "/api/backtest"
        and e["parameters"]["pair"] == "GOLDTEN-GOLDPETAL"
        and e["parameters"]["purity"] is False
    )
    payload = read_payload(output, entry)
    assert payload == direct
    report = payload["reports"][0]
    assert report["metrics"]["warnings"]
    assert report["unresolved_positions"][0]["mark_quality_a"].startswith("stale")
    spread = next(
        e
        for e in manifest["files"]
        if e["endpoint"] == "/api/spreads"
        and e["parameters"]["pair"] == "GOLDTEN-GOLDPETAL"
    )
    assert read_payload(output, spread)["series"][0]["rows"][0]["z"] is None
    roll = next(
        e
        for e in manifest["files"]
        if e["endpoint"] == "/api/rolldown" and e["parameters"]["product"] == "GOLDTEN"
    )
    assert read_payload(output, roll)["invalid_count"] > 0


def test_strict_encoding_and_checksum_tampering(analytics_api, tmp_path):
    _, _, settings = analytics_api
    with pytest.raises(ValueError):
        exporter._json_bytes({"value": float("inf")})
    manifest = exporter.export_snapshots(
        settings=settings, output_dir=tmp_path / "verify"
    )
    first = tmp_path / "verify" / manifest["files"][0]["path"]
    first.write_text("{}")
    with pytest.raises(ValueError, match="checksum"):
        exporter.verify_snapshot_set(tmp_path / "verify")


def test_nonfinite_market_values_become_null(analytics_api, tmp_path):
    _, engine, settings = analytics_api
    with engine.begin() as connection:
        connection.execute(
            update(bhav).where(bhav.c.symbol == "GOLDTEN").values(close=float("inf"))
        )
    output = tmp_path / "nonfinite"
    manifest = exporter.export_snapshots(settings=settings, output_dir=output)
    exporter.verify_snapshot_set(output)
    curves = [
        e
        for e in manifest["files"]
        if e["endpoint"] == "/api/curve" and e["parameters"]["product"] == "GOLDTEN"
    ]
    assert len(curves) == 2
    for entry in curves:
        assert all(
            point["close_p10_raw"] is None and point["close_p10_999"] is None
            for point in read_payload(output, entry)["points"]
        )
