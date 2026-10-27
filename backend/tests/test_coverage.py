"""Read-only observed coverage, exact ranges and honest unavailable diagnostics."""

import hashlib
from datetime import date
from unittest.mock import patch

import pytest
from sqlalchemy import delete, select, update

from app import export_snapshots as exporter
from app.api.coverage import coverage_requests
from app.api.database import get_connection
from app.data.loader import bhav, data_health
from app.main import app
from tests.test_api_foundation import api as source_fixture

api = source_fixture


@pytest.fixture
def coverage_api(api):
    client, engine, settings, path = api
    with engine.begin() as connection:
        connection.execute(
            update(bhav)
            .where(
                bhav.c.symbol == "GOLDTEN",
                bhav.c.trade_date == date(2026, 10, 5),
                bhav.c.expiry_date == date(2026, 10, 9),
            )
            .values(volume_lots=0, volume_grams=0)
        )
        connection.execute(
            update(bhav)
            .where(bhav.c.symbol == "GOLDTEN", bhav.c.expiry_date == date(2026, 10, 7))
            .values(close=None)
        )
        connection.execute(
            data_health.insert(),
            [
                dict(
                    file_name="BhavCopyDateWise_05102026.csv",
                    trade_date=date(2026, 10, 5),
                    status="ok",
                    rows_total=10,
                    rows_kept=6,
                    notes="",
                ),
                dict(
                    file_name="BhavCopyDateWise_03102026.csv",
                    trade_date=date(2026, 10, 3),
                    status="date_mismatch",
                    rows_total=1,
                    rows_kept=0,
                    notes="C:/private/market.db; observed 2026-10-01",
                ),
                dict(
                    file_name="BhavCopyDateWise_01102026.csv",
                    trade_date=None,
                    status="error",
                    rows_total=0,
                    rows_kept=0,
                    notes="Missing CSV columns at C:/private/file.csv",
                ),
                dict(
                    file_name="C:/private/password-hidden.csv",
                    trade_date=None,
                    status="error",
                    rows_total=0,
                    rows_kept=0,
                    notes="private credentials 2026-10-02",
                ),
            ],
        )
    return client, engine, settings, path


def query(client, suffix=""):
    response = client.get("/api/coverage?start=2026-10-01&end=2026-10-31" + suffix)
    assert response.status_code == 200, response.text
    assert "NaN" not in response.text and "Infinity" not in response.text
    return response.json()


@pytest.mark.parametrize(
    "parameters",
    [
        "",
        "start=2026-10-01",
        "start=20261001&end=2026-10-31",
        "start=2026-02-30&end=2026-03-01",
        "start=2026-10-10&end=2026-10-01",
        "start=2026-09-01&end=2026-10-02",
        "start=2026-10-01&end=2026-10-31&product=GOLD",
    ],
)
def test_invalid_products_dates_and_bounded_ranges(coverage_api, parameters):
    assert coverage_api[0].get("/api/coverage?" + parameters).status_code == 422


def test_observed_counts_match_database_and_do_not_infer_expected_roster(coverage_api):
    client, engine, _, path = coverage_api
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    data = query(client)
    with engine.connect() as connection:
        rows = (
            connection.execute(
                select(bhav).where(bhav.c.trade_date >= date(2026, 10, 1))
            )
            .mappings()
            .all()
        )
    assert data["counts"]["observation_count"] == len(rows)
    assert data["counts"]["distinct_contract_count"] == len(
        {(r["symbol"], r["expiry_date"]) for r in rows}
    )
    assert sum(d["observation_count"] for d in data["days"]) == len(rows)
    for day in data["days"]:
        actual = [r for r in rows if r["trade_date"].isoformat() == day["date"]]
        assert day["observation_count"] == len(actual)
        assert sum(p["observation_count"] for p in day["products"]) == len(actual)
    assert len(data["days"]) == 31
    assert data["data_as_of"] == "2026-10-05"
    assert data["data_window"]["first_trade_date"] == "2026-09-30"
    assert not data["expected_coverage_available"]
    assert (
        data["expected_contract_count"] is None
        and data["missing_contract_count"] is None
    )
    assert data["expected_coverage_reason"] == "Expected contract coverage unavailable."
    assert not data["official_calendar_available"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before


def test_product_expiry_breakdown_and_overlapping_quality_flags(coverage_api):
    data = query(coverage_api[0], "&product=GOLDTEN")
    day = next(d for d in data["days"] if d["date"] == "2026-10-05")
    assert day["observation_count"] == day["distinct_contract_count"] == 3
    assert day["no_trade_count"] == 1
    assert day["zero_volume_count"] == 2
    assert day["thin_volume_count"] == 3
    assert day["invalid_close_count"] == 1
    assert [p["product"] for p in day["products"]] == ["GOLDTEN"]
    assert [r["expiry_date"] for r in day["observations"]] == [
        "2026-10-07",
        "2026-10-08",
        "2026-10-09",
    ]
    assert (
        day["observations"][2]["zero_volume"] and not day["observations"][2]["no_trade"]
    )
    assert day["ingestion_count"] == 1 and day["ingestions"][0]["rows_kept"] == 6


def test_ingestion_dates_are_persisted_not_guessed_and_private_notes_withheld(
    coverage_api,
):
    client, _, _, _ = coverage_api
    data = query(client)
    assert data["undated_ingestion_count"] == 2
    assert all(r["trade_date"] is None for r in data["undated_ingestions"])
    assert data["days"][0]["ingestion_count"] == 0
    rejected = data["days"][2]
    assert rejected["observation_count"] == 0 and rejected["ingestion_count"] == 1
    assert rejected["ingestions"][0]["status"] == "date_mismatch"
    assert data["days"][1]["ingestion_count"] == 0
    text = str(data)
    assert "C:/private" not in text and "password-hidden" not in text
    assert "private credentials" not in text


def test_empty_database_missing_table_and_valid_empty_month(coverage_api, tmp_path):
    client, engine, settings, _ = coverage_api
    response = client.get("/api/coverage?start=2027-01-01&end=2027-01-31").json()
    assert response["data_available"] and response["counts"]["observation_count"] == 0
    with engine.begin() as connection:
        connection.execute(delete(bhav))
    empty = query(client)
    assert not empty["data_available"] and empty["data_as_of"] is None
    assert all(day["observation_count"] == 0 for day in empty["days"])
    missing = tmp_path / "missing.db"
    settings.database_url = f"sqlite:///{missing}"
    app.dependency_overrides.pop(get_connection)
    absent = query(client)
    assert not absent["file_records_available"]
    assert absent["undated_ingestion_count"] is None
    assert absent["days"][0]["ingestion_count"] is None
    assert not missing.exists()


def test_record_limits_are_explicit_and_do_not_falsify_total(coverage_api):
    client, engine, _, _ = coverage_api
    with engine.begin() as connection:
        connection.execute(
            data_health.insert(),
            [
                dict(
                    file_name=f"unknown-{i}.csv",
                    trade_date=date(2026, 10, 5),
                    status="error",
                    rows_total=0,
                    rows_kept=0,
                    notes="private",
                )
                for i in range(101)
            ],
        )
        connection.execute(
            data_health.insert(),
            [
                dict(
                    file_name=f"undated-{i}.csv",
                    trade_date=None,
                    status="error",
                    rows_total=0,
                    rows_kept=0,
                    notes="private",
                )
                for i in range(101)
            ],
        )
    data = query(client)
    day = data["days"][4]
    assert day["ingestion_count"] == 102 and len(day["ingestions"]) == 100
    assert day["ingestions_truncated"]
    assert data["undated_ingestion_count"] == 103
    assert len(data["undated_ingestions"]) == 100
    assert data["undated_ingestions_truncated"]


def test_coverage_snapshots_exact_month_product_and_legacy_keys_preserved(
    coverage_api, tmp_path
):
    _, engine, settings, path = coverage_api
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    with engine.connect() as connection:
        configurations = list(coverage_requests(connection, settings))
    assert len(configurations) == 10  # September and October, all + four products.
    output = tmp_path / "snapshots"
    with patch("httpx.Client", side_effect=AssertionError("No network")):
        manifest = exporter.export_snapshots(settings=settings, output_dir=output)
    assert len(manifest["files"]) == 54
    assert exporter.verify_snapshot_set(output) == manifest
    coverage_entries = [
        e for e in manifest["files"] if e["endpoint"] == "/api/coverage"
    ]
    assert len(coverage_entries) == 10
    assert exporter.request_key(
        "/api/coverage", {"start": "2026-10-01", "end": "2026-10-31"}
    ) == exporter.request_key(
        "/api/coverage", {"start": "2026-10-01", "end": "2026-10-31", "product": None}
    )
    with pytest.raises(ValueError):
        exporter.canonical_parameters(
            "/api/coverage", {"start": "2026-09-01", "end": "2026-10-02"}
        )
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before


def test_unexpected_failure_is_safe_500(coverage_api):
    client = coverage_api[0]
    with patch(
        "app.api.coverage._read", side_effect=RuntimeError("C:/private/database secret")
    ):
        response = client.get("/api/coverage?start=2026-10-01&end=2026-10-31")
    assert response.status_code == 500
    assert "private" not in response.text and "secret" not in response.text
