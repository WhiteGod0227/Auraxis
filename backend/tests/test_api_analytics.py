"""Isolated read-only HTTP adapters tested against direct analytics results."""

from datetime import date, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, update
from sqlalchemy.pool import NullPool

from app.analytics.backtest import simulate_pair
from app.analytics.backtest_report import summarize_simulation
from app.analytics.spreads import compute_spreads
from app.analytics.term_structure import compute_rolldown, curve
from app.api.analytics_schemas import (
    BacktestResponse,
    CurveResponse,
    RolldownResponse,
    SpreadsResponse,
)
from app.api.database import get_connection
from app.core.config import Settings, get_settings
from app.data.loader import bhav, metadata
from app.main import app

PAIR = "GOLDTEN-GOLDPETAL"
EARLY = date(2026, 10, 12)
LATE = date(2026, 11, 30)


@pytest.fixture
def analytics_api(tmp_path):
    settings = Settings(_env_file=None, database_url=f"sqlite:///{tmp_path / 'api.db'}")
    engine = create_engine(settings.database_url, poolclass=NullPool)
    metadata.create_all(engine)
    rows = []
    days = [date(2026, 10, 5) + timedelta(days=i) for i in (0, 1, 2, 3, 4, 7, 8)]
    for day, spread in zip(days, (0, 2, -4, -2, -3, 1, 2), strict=True):
        for expiry in (EARLY, LATE):
            for symbol, close in (
                ("GOLDTEN", 100 + spread),
                ("GOLDPETAL", 10),
                ("GOLDGUINEA", 80),
            ):
                rows.append(
                    dict(
                        symbol=symbol,
                        trade_date=day,
                        expiry_date=expiry,
                        close=close,
                        has_trade=True,
                        volume_text="10 GRMS",
                        volume_lots=1000,
                        volume_grams=10000,
                        open_interest_lots=1000,
                        open_interest_grams=10000,
                    )
                )
        rows.append(
            dict(
                symbol="GOLDM",
                trade_date=day,
                expiry_date=date(2026, 10, 15),
                close=101,
                has_trade=True,
                volume_text="10 GRMS",
                volume_lots=100,
                volume_grams=10000,
                open_interest_lots=100,
                open_interest_grams=10000,
            )
        )
    with engine.begin() as connection:
        connection.execute(bhav.insert(), rows)
        connection.execute(
            update(bhav)
            .where(bhav.c.expiry_date == EARLY, bhav.c.trade_date >= EARLY)
            .values(has_trade=False)
        )

    def dependency():
        with engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA query_only = ON")
            yield connection

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_connection] = dependency
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            yield client, engine, settings
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
        engine.dispose()


def get(client, url):
    response = client.get(url)
    assert response.status_code == 200, response.text
    assert "NaN" not in response.text and "Infinity" not in response.text
    return response.json()


def test_schemas_existing_endpoints_and_iso_dates(analytics_api):
    client, _, _ = analytics_api
    for url in (
        "/health",
        "/api/meta",
        "/api/overview",
        "/api/prices",
        "/api/data-health",
    ):
        get(client, url)
    for url, schema in (
        (f"/api/spreads?pair={PAIR}", SpreadsResponse),
        ("/api/curve?product=GOLDM", CurveResponse),
        ("/api/rolldown?product=GOLDTEN", RolldownResponse),
        (f"/api/backtest?pair={PAIR}", BacktestResponse),
    ):
        body = get(client, url)
        schema.model_validate(body)
        assert body["data_as_of"] == "2026-10-13"
        assert body["normalization"]["purity_verification_status"] == "unverified"
        assert body["units"]


@pytest.mark.parametrize(
    "query",
    [
        "spreads?pair=UNKNOWN",
        "spreads?pair=GOLDTEN-GOLDPETAL&window=2",
        "spreads?pair=GOLDTEN-GOLDPETAL&min_volume_grams=inf",
        "spreads?pair=GOLDTEN-GOLDPETAL&min_oi_grams=-1",
        "spreads?pair=GOLDTEN-GOLDPETAL&start=2026-10-13&end=2026-10-01",
        "curve?product=GOLD",
        "curve?product=GOLDM&date=20261001",
        "curve?product=GOLDM&date=2026-02-30",
        "rolldown?product=GOLDTEN&expiry=bad",
        "rolldown?product=GOLDM&purity=bad",
        "backtest?pair=GOLDM-GOLDTEN",
        "backtest?pair=UNKNOWN",
        "backtest?pair=GOLDTEN-GOLDPETAL&z_exit=1",
        "backtest?pair=GOLDTEN-GOLDPETAL&notional_per_leg=0",
        "backtest?pair=GOLDTEN-GOLDPETAL&max_hold_sessions=0",
        "backtest?pair=GOLDTEN-GOLDPETAL&window=1&min_periods=2",
        "backtest?pair=GOLDTEN-GOLDPETAL&cost_bps_per_leg_per_side=nan",
    ],
)
def test_validation(analytics_api, query):
    client, _, _ = analytics_api
    assert client.get(f"/api/{query}").status_code == 422


def test_spreads_separate_expiries_filter_and_direct_agreement(analytics_api):
    client, engine, settings = analytics_api
    body = get(client, f"/api/spreads?pair={PAIR}&window=2&min_periods=2")
    assert [s["expiry_a"] for s in body["series"]] == [
        EARLY.isoformat(),
        LATE.isoformat(),
    ]
    direct = compute_spreads(
        PAIR,
        window=2,
        min_periods=2,
        min_volume_grams=2000,
        engine=engine,
        settings=settings,
    )
    for series in body["series"]:
        expected = direct.loc[direct.expiry_a == date.fromisoformat(series["expiry_a"])]
        assert [r["spread_abs"] for r in series["rows"]] == expected.spread_abs.tolist()
        assert series["latest"]["z"] == pytest.approx(expected.iloc[-1].z)
        assert series["latest"]["executable_pair"] is True
    selected = get(client, f"/api/spreads?pair={PAIR}&expiry={LATE}")
    assert len(selected["series"]) == 1
    assert selected["series"][0]["expiry_a"] == LATE.isoformat()
    assert body["series"][0]["rows"][0]["z"] is None
    assert "no trade" in body["series"][0]["description"]


def test_goldm_brackets_flags_liquidity_and_purity(analytics_api):
    client, _, _ = analytics_api
    base = "/api/spreads?pair=GOLDM-GOLDTEN&window=2&min_periods=2"
    body = get(client, base + "&purity=true")
    row = body["series"][0]["rows"][0]
    assert row["expiry_b_used"] == [EARLY.isoformat(), LATE.isoformat()]
    assert row["days_mismatch"] == [-3, 46]
    assert row["source_tradable"] is True
    assert row["liquidity_ok"] is True
    assert row["executable_pair"] is False and row["analytics_only"] is True
    assert row["comparison_type"] == "interpolated_maturity"
    raw = get(client, base + "&purity=false")["series"][0]["rows"][0]
    assert raw["a_p10_999"] == 101
    assert row["a_p10_999"] == pytest.approx(101 * 999 / 995)
    thin = get(client, base + "&min_volume_grams=20000&end=2026-10-09")
    assert thin["series"][0]["latest"]["liquidity_ok"] is False
    assert "threshold" in thin["series"][0]["description"]
    unmatched = get(client, base + "&carry_adjusted=false")["series"][0]["rows"][0]
    assert unmatched["expiry_b_used"] == [EARLY.isoformat()]
    assert unmatched["days_mismatch"] == [-3]
    assert unmatched["comparison_type"] == "unmatched_maturity"
    missing = get(client, "/api/spreads?pair=GOLDM-GOLDTEN&end=2026-10-04")
    assert missing["series"] == []


def test_missing_brackets_description(analytics_api):
    client, engine, _ = analytics_api
    with engine.begin() as connection:
        connection.execute(
            delete(bhav).where(bhav.c.symbol == "GOLDTEN", bhav.c.expiry_date == LATE)
        )
    body = get(client, "/api/spreads?pair=GOLDM-GOLDTEN")
    assert body["series"][0]["latest"]["expiry_b_used"] == []
    assert "Missing maturity brackets" in body["series"][0]["description"]
    assert "undefined" in body["series"][0]["description"]


def test_curve_exact_date_no_trade_and_direct_agreement(analytics_api):
    client, engine, settings = analytics_api
    missing = get(client, "/api/curve?product=GOLDTEN&date=2026-10-10")
    assert missing["points"] == [] and missing["selected_date"] == "2026-10-10"
    body = get(client, "/api/curve?product=GOLDTEN&date=2026-10-12")
    direct = curve("GOLDTEN", EARLY, engine=engine, settings=settings)
    assert [r["close_p10_999"] for r in body["points"]] == direct.close_p10_999.tolist()
    assert body["points"][0]["has_trade"] is False
    assert body["points"][0]["quality_reason"] == "no_trade"


def test_rolldown_invalid_counts_filter_and_direct_agreement(analytics_api):
    client, engine, settings = analytics_api
    body = get(client, "/api/rolldown?product=GOLDTEN")
    direct = compute_rolldown("GOLDTEN", engine=engine, settings=settings)
    assert len(body["series"]) == 2
    assert body["valid_count"] == int(direct.decomposition_valid.sum())
    assert body["invalid_count"] == int((~direct.decomposition_valid).sum())
    assert "no_next_expiry" in [r["reason"] for s in body["series"] for r in s["rows"]]
    selected = get(client, f"/api/rolldown?product=GOLDTEN&expiry={EARLY}")
    assert len(selected["series"]) == 1
    assert selected["series"][0]["expiry_date"] == EARLY.isoformat()
    assert "constant-shape" in body["explanation"]


def test_backtest_direct_reporting_and_outstanding_positions(analytics_api):
    client, engine, settings = analytics_api
    url = (
        f"/api/backtest?pair={PAIR}&window=2&min_periods=2"
        "&expiry_buffer_calendar_days=0"
    )
    body = get(client, url)
    result = simulate_pair(
        PAIR,
        window=2,
        min_periods=2,
        expiry_buffer_calendar_days=0,
        engine=engine,
        settings=settings,
    )
    direct = summarize_simulation(result)
    assert len(body["reports"]) == 2
    for reported, expected in zip(body["reports"], direct, strict=True):
        assert reported["verdict"] == expected.verdict
        assert (
            reported["metrics"]["total_marked_net_pnl"]
            == expected.metrics["total_marked_net_pnl"]
        )
        assert reported["configuration"]["window"] == 2
        assert reported["cost_tolerance"] == expected.cost_tolerance
        assert len(reported["equity_curve"]) == len(expected.equity_curve)
    early = body["reports"][0]
    assert early["unresolved_positions"]
    assert early["metrics"]["unresolved_count"] == 1
    assert early["metrics"]["warnings"]
    assert early["diagnostics"]
    filtered = get(client, url + f"&expiry={LATE}")
    assert len(filtered["reports"]) == 1
    assert filtered["reports"][0]["expiry"] == LATE.isoformat()


def test_nulls_empty_and_unavailable_expiry(analytics_api):
    client, engine, _ = analytics_api
    with engine.begin() as connection:
        connection.execute(
            update(bhav).where(bhav.c.symbol == "GOLDTEN").values(close=float("inf"))
        )
    for url in (
        f"/api/spreads?pair={PAIR}",
        "/api/curve?product=GOLDTEN",
        "/api/rolldown?product=GOLDTEN",
        f"/api/backtest?pair={PAIR}",
    ):
        get(client, url)
    points = get(client, "/api/curve?product=GOLDTEN")["points"]
    assert points[0]["close_p10_999"] is None
    missing = get(client, f"/api/backtest?pair={PAIR}&expiry=2030-01-01")
    assert missing["reports"] == [] and missing["message"]
    with engine.begin() as connection:
        connection.execute(delete(bhav))
    for url, field in (
        (f"/api/spreads?pair={PAIR}", "series"),
        ("/api/curve?product=GOLDM", "points"),
        ("/api/rolldown?product=GOLDM", "series"),
        (f"/api/backtest?pair={PAIR}", "reports"),
    ):
        body = get(client, url)
        assert body[field] == [] and body["data_as_of"] is None


def test_parameter_passthrough_and_failure_not_empty(analytics_api):
    client, _, _ = analytics_api
    from app.api import analytics

    with patch.object(analytics, "simulate_pair", wraps=simulate_pair) as wrapped:
        body = get(
            client,
            f"/api/backtest?pair={PAIR}&purity=false&min_oi_grams=123&notional_per_leg=5000",
        )
        assert wrapped.call_args.kwargs["use_purity_adjustment"] is False
        assert wrapped.call_args.kwargs["min_oi_grams"] == 123
        assert body["configuration"]["notional_per_leg"] == 5000
        assert body["reports"][0]["reference_capital"] == 10000
    with patch.object(
        analytics, "curve", side_effect=RuntimeError("C:/private/database")
    ):
        response = client.get("/api/curve?product=GOLDM")
        assert response.status_code == 500
        assert "private" not in response.text


def test_purity_passthrough_curve_rolldown_and_read_only(analytics_api):
    import hashlib
    from pathlib import Path

    client, engine, settings = analytics_api
    before = hashlib.sha256(Path(engine.url.database).read_bytes()).hexdigest()
    adjusted = get(client, "/api/curve?product=GOLDM&purity=true")
    raw = get(client, "/api/curve?product=GOLDM&purity=false")
    assert raw["points"][0]["close_p10_999"] == 101
    assert adjusted["points"][0]["close_p10_999"] == pytest.approx(101 * 999 / 995)
    body = get(
        client,
        "/api/rolldown?product=GOLDM&purity=false&start=2026-10-07&end=2026-10-09",
    )
    direct = compute_rolldown(
        "GOLDM",
        start=date(2026, 10, 7),
        end=date(2026, 10, 9),
        use_purity_adjustment=False,
        engine=engine,
        settings=settings,
    )
    assert [
        r["current_price"] for r in body["series"][0]["rows"]
    ] == direct.current_price.tolist()
    get(client, f"/api/backtest?pair={PAIR}")
    get(client, f"/api/spreads?pair={PAIR}")
    assert hashlib.sha256(Path(engine.url.database).read_bytes()).hexdigest() == before
    oi = get(
        client, "/api/spreads?pair=GOLDM-GOLDTEN&min_oi_grams=20000&end=2026-10-09"
    )
    assert oi["series"][0]["latest"]["liquidity_reason"] == "thin_oi"


def test_absent_database_no_creation(analytics_api, tmp_path):
    client, _, settings = analytics_api
    path = tmp_path / "missing.db"
    settings.database_url = f"sqlite:///{path}"
    app.dependency_overrides.pop(get_connection)
    for url, field in (
        (f"/api/spreads?pair={PAIR}", "series"),
        ("/api/curve?product=GOLDM", "points"),
        ("/api/rolldown?product=GOLDM", "series"),
        (f"/api/backtest?pair={PAIR}", "reports"),
    ):
        body = get(client, url)
        assert body[field] == []
        assert body["data_available"] is False
    assert not path.exists()
