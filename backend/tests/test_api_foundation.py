import hashlib
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, update
from sqlalchemy.pool import NullPool

from app.api.database import get_connection
from app.api.schemas import (
    DataHealthResponse,
    MetaResponse,
    OverviewResponse,
    PricesResponse,
)
from app.core.config import Settings, get_settings
from app.data.loader import bhav, data_health, metadata
from app.main import app

LATEST = date(2026, 10, 5)
PREVIOUS = date(2026, 10, 2)
SELECTED = date(2026, 10, 9)


def row(symbol, day, expiry, price, traded=True):
    return dict(
        symbol=symbol,
        trade_date=day,
        expiry_date=expiry,
        close=price,
        has_trade=traded,
        volume_lots=10 if traded else 0,
        volume_text="0.100 GRMS",
        open_interest_lots=20,
        volume_grams=100 if traded else 0,
        open_interest_grams=200,
    )


@pytest.fixture
def api(tmp_path):
    path = tmp_path / "isolated.db"
    settings = Settings(_env_file=None, database_url=f"sqlite:///{path}")
    engine = create_engine(settings.database_url, poolclass=NullPool)
    metadata.create_all(engine)
    rows = [
        row("GOLDM", PREVIOUS, date(2026, 10, 8), 990),
        row("GOLDM", LATEST, date(2026, 10, 8), 1000),
        row("GOLDTEN", LATEST, date(2026, 10, 7), 70),
        row("GOLDTEN", LATEST, date(2026, 10, 8), 80, False),
        row("GOLDTEN", LATEST, SELECTED, 100),
        row("GOLDTEN", date(2026, 10, 1), SELECTED, 90),
        row("GOLDGUINEA", PREVIOUS, date(2026, 10, 30), 800),
        row("GOLDPETAL", LATEST, date(2026, 10, 8), 10),
        row("GOLDPETAL", PREVIOUS, date(2026, 10, 8), 9),
        row("GOLDPETAL", date(2026, 9, 30), date(2026, 10, 8), 8, False),
        row("GOLDPETAL", date(2026, 9, 30), date(2026, 10, 6), 33),
    ]
    with engine.begin() as connection:
        connection.execute(bhav.insert(), rows)

    def connection_dependency():
        with engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA query_only = ON")
            yield connection

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_connection] = connection_dependency
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, engine, settings, path
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous_overrides)
    engine.dispose()


def test_health_and_schemas_iso_dates(api):
    client, _, _, _ = api
    assert client.get("/health").json() == {"status": "ok", "app": "Auraxis"}
    for endpoint, schema in [
        ("meta", MetaResponse),
        ("overview", OverviewResponse),
        ("prices", PricesResponse),
        ("data-health", DataHealthResponse),
    ]:
        response = client.get(f"/api/{endpoint}")
        assert response.status_code == 200, response.text
        schema.model_validate(response.json())
        assert response.json()["data_as_of"] == "2026-10-05"
    meta = client.get("/api/meta").json()
    assert meta["first_trade_date"] == "2026-09-30"
    assert meta["trading_session_count"] == 4
    assert meta["contract_counts_by_product"]["GOLDTEN"] == 3
    assert meta["normalization"]["purity_verification_status"] == "unverified"


def test_reference_rule_boundary_and_no_older_substitution(api):
    client, engine, _, _ = api
    body = client.get("/api/overview").json()
    references = {row["product"]: row for row in body["references"]}
    assert references["GOLDTEN"]["expiry_date"] == "2026-10-09"
    assert not references["GOLDGUINEA"]["reference_available"]
    assert references["GOLDGUINEA"]["selection_reason"] == "no_observation_latest_date"
    with engine.begin() as connection:
        connection.execute(
            update(bhav)
            .where(bhav.c.symbol == "GOLDTEN", bhav.c.expiry_date == date(2026, 10, 8))
            .values(has_trade=True)
        )
    references = {
        r["product"]: r for r in client.get("/api/overview").json()["references"]
    }
    assert references["GOLDTEN"]["expiry_date"] == "2026-10-08"
    assert references["GOLDTEN"]["days_to_expiry"] == 3


def test_same_expiry_previous_global_session_no_bridge(api):
    client, engine, _, _ = api
    refs = {r["product"]: r for r in client.get("/api/overview").json()["references"]}
    assert refs["GOLDTEN"]["previous_comparison_date"] == "2026-10-02"
    assert refs["GOLDTEN"]["day_change_abs"] is None
    assert refs["GOLDTEN"]["change_reason"] == "missing_previous_observation"
    assert refs["GOLDPETAL"]["day_change_abs"] == 10
    assert refs["GOLDPETAL"]["day_change_pct"] == pytest.approx(100 / 9)
    with engine.begin() as connection:
        connection.execute(bhav.insert(), row("GOLDTEN", PREVIOUS, SELECTED, 90))
        connection.execute(
            update(bhav)
            .where(bhav.c.symbol == "GOLDPETAL", bhav.c.trade_date == PREVIOUS)
            .values(has_trade=False)
        )
    refs = {r["product"]: r for r in client.get("/api/overview").json()["references"]}
    assert refs["GOLDTEN"]["day_change_abs"] == 10
    assert refs["GOLDPETAL"]["day_change_abs"] is None
    assert refs["GOLDPETAL"]["change_reason"] == "previous_no_trade"


def test_fixed_expiry_history_and_purity_switch(api):
    client, _, _, _ = api
    points = client.get("/api/prices?product=GOLDPETAL").json()["series"][0]
    assert points["expiry_date"] == "2026-10-08"
    assert [r["close_p10_raw"] for r in points["history"]] == [80, 90, 100]
    assert not points["history"][0]["has_trade"]
    assert points["history"][0]["quality_reason"] == "no_trade"
    assert (
        client.get("/api/prices?product=GOLDGUINEA").json()["series"][0]["history"]
        == []
    )
    adjusted = client.get("/api/prices?product=GOLDM&purity=true").json()["series"][0][
        "history"
    ]
    raw = client.get("/api/prices?product=GOLDM&purity=false").json()["series"][0][
        "history"
    ]
    assert adjusted[-1]["close_p10_999"] == pytest.approx(1000 * 999 / 995)
    assert raw[-1]["close_p10_999"] == 1000
    adj_ref = client.get("/api/overview?purity=true").json()["references"][0]
    raw_ref = client.get("/api/overview?purity=false").json()["references"][0]
    assert adj_ref["day_change_abs"] == pytest.approx(
        raw_ref["day_change_abs"] * 999 / 995
    )


def test_nonfinite_values_are_null_not_filled(api):
    client, engine, _, _ = api
    with engine.begin() as connection:
        connection.execute(
            update(bhav)
            .where(bhav.c.symbol == "GOLDPETAL", bhav.c.trade_date == PREVIOUS)
            .values(close=float("inf"))
        )
        connection.execute(
            update(bhav)
            .where(
                bhav.c.symbol == "GOLDPETAL",
                bhav.c.trade_date == date(2026, 9, 30),
                bhav.c.expiry_date == date(2026, 10, 8),
            )
            .values(close=float("nan"))
        )
        connection.execute(
            update(bhav)
            .where(
                bhav.c.symbol == "GOLDTEN",
                bhav.c.trade_date == LATEST,
                bhav.c.expiry_date == SELECTED,
            )
            .values(volume_grams=float("inf"))
        )
    body = client.get("/api/prices?product=GOLDPETAL").json()
    assert body["series"][0]["history"][0]["close_p10_raw"] is None
    assert body["series"][0]["history"][1]["close_p10_999"] is None
    overview = client.get("/api/overview").json()
    refs = {r["product"]: r for r in overview["references"]}
    assert refs["GOLDPETAL"]["change_reason"] == "previous_invalid_price"
    assert refs["GOLDPETAL"]["day_change_pct"] is None
    assert refs["GOLDTEN"]["volume_grams"] is None
    for endpoint in ("/api/meta", "/api/overview", "/api/prices", "/api/data-health"):
        response = client.get(endpoint)
        assert response.status_code == 200
        assert "Infinity" not in response.text and "NaN" not in response.text


@pytest.mark.parametrize(
    "query",
    [
        "/api/prices?product=GOLD",
        "/api/prices?product=",
        "/api/prices?purity=invalid",
        "/api/overview?purity=invalid",
        "/api/data-health?diagnostic_limit=0",
        "/api/data-health?diagnostic_limit=101",
        "/api/data-health?min_volume_grams=-1",
        "/api/data-health?min_volume_grams=inf",
        "/api/data-health?min_volume_grams=nan",
    ],
)
def test_invalid_parameters(api, query):
    assert api[0].get(query).status_code == 422


def test_recorded_diagnostics_truncation_and_no_private_notes(api):
    client, engine, settings, _ = api
    with engine.begin() as connection:
        connection.execute(
            data_health.insert(),
            [
                dict(
                    file_name=f"file{i}.csv",
                    trade_date=LATEST,
                    status="date_mismatch" if i == 0 else "error",
                    rows_total=5,
                    rows_kept=0,
                    notes=(
                        "Filename date 2026-10-05; returned dates 2026-10-02; "
                        "C:/private/secret.db"
                    ),
                )
                for i in range(3)
            ],
        )
    settings.api_min_volume_grams = 50
    response = client.get("/api/data-health?diagnostic_limit=1")
    body = response.json()
    assert "C:/private" not in response.text
    assert body["file_status_counts"] == {"error": 2, "date_mismatch": 1}
    page = body["rejected_files"]
    assert (
        page["total_count"] == 3 and page["returned_count"] == 1 and page["truncated"]
    )
    assert body["date_mismatch_files"]["items"][0]["recorded_dates_in_notes"] == [
        "2026-10-02",
        "2026-10-05",
    ]
    assert body["no_trade_counts_by_product"]["GOLDPETAL"] == 1
    assert body["zero_volume_counts_by_product"]["GOLDPETAL"] == 1
    assert body["thin_volume_counts_by_product"]["GOLDPETAL"] == 1
    assert body["min_volume_grams"] == 50
    assert not body["unavailable_diagnostics"]["row_level_validation"]["available"]
    assert body["unavailable_diagnostics"]["structured_volume_mismatches"]["available"]
    assert body["volume_mismatches"]["total_count"] == 0
    assert body["ingestion_history"]["total_count"] == 0
    assert "Legacy" in body["ingestion_history"]["definition"]


def test_empty_database_and_missing_file_remain_read_only(api, tmp_path):
    client, engine, settings, _ = api
    with engine.begin() as connection:
        connection.execute(delete(bhav))
    for endpoint in ("meta", "overview", "prices", "data-health"):
        response = client.get(f"/api/{endpoint}")
        assert response.status_code == 200, response.text
        assert response.json()["data_as_of"] is None
        assert not response.json()["data_available"]
    refs = client.get("/api/overview").json()["references"]
    assert len(refs) == 4 and all(not r["reference_available"] for r in refs)
    missing = tmp_path / "never-created.db"
    settings.database_url = f"sqlite:///{missing}"
    app.dependency_overrides.pop(get_connection)
    body = client.get("/api/data-health").json()
    assert not body["file_records_available"]
    assert not body["rejected_files"]["available"]
    assert not missing.exists()


def test_unexpected_failure_returns_safe_500(api, monkeypatch):
    def failure(*args, **kwargs):
        raise ValueError("secret C:/private/auraxis.db sqlite:///credentials")

    monkeypatch.setattr("app.api.foundation.normalize_prices", failure)
    response = api[0].get("/api/overview")
    assert response.status_code == 500
    assert response.json() == {"detail": "Unable to read research data."}
    assert "private" not in response.text and "credentials" not in response.text


def test_endpoints_do_not_modify_database(api):
    client, _, _, path = api
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    for endpoint in ("meta", "overview", "prices", "data-health"):
        assert client.get(f"/api/{endpoint}").status_code == 200
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before


@pytest.mark.parametrize("origin", ["http://localhost:5180", "http://localhost:5173"])
def test_frontend_cors(api, origin):
    response = api[0].options(
        "/api/meta",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
