"""Calculation provenance is additive and cannot change spread economics."""

from datetime import date

import pandas as pd
import pytest
from sqlalchemy import update

from app.analytics.spreads import compute_spreads
from app.data.loader import bhav
from tests.test_api_analytics import analytics_api as source_fixture

analytics_api = source_fixture


def fetch(client, query="pair=GOLDM-GOLDTEN&window=2&min_periods=2"):
    response = client.get("/api/spreads?" + query)
    assert response.status_code == 200, response.text
    return response.json()


def test_trace_records_actual_inputs_and_existing_interpolation(analytics_api):
    client, engine, settings = analytics_api
    body = fetch(client)
    row = body["series"][0]["rows"][0]
    trace = row["calculation"]
    assert trace["a"]["close"] == 101
    assert trace["a"]["expiry_date"] == row["expiry_a"] == "2026-10-15"
    assert [b["expiry_date"] for b in trace["b_components"]] == row["expiry_b_used"]
    assert [b["trade_date"] for b in trace["b_components"]] == [row["trade_date"]] * 2
    assert trace["b_weights"] == pytest.approx([46 / 49, 3 / 49])
    assert row["b_p10_999"] == sum(
        b["close_p10_adjusted"] * w
        for b, w in zip(trace["b_components"], trace["b_weights"], strict=True)
    )
    assert trace["preceding_finite_count"] == 0
    assert trace["statistics_status"] == "insufficient_history"
    plain = compute_spreads(
        "GOLDM-GOLDTEN", window=2, min_periods=2, engine=engine, settings=settings
    )
    enriched = compute_spreads(
        "GOLDM-GOLDTEN",
        window=2,
        min_periods=2,
        engine=engine,
        settings=settings,
        include_calculations=True,
    )
    pd.testing.assert_frame_equal(plain, enriched.drop(columns="calculation"))


def test_quote_conversion_and_experimental_purity_trace(analytics_api):
    client, _, _ = analytics_api
    for purity in (False, True):
        trace = fetch(client, f"pair=GOLDM-GOLDPETAL&purity={str(purity).lower()}")[
            "series"
        ][0]["latest"]["calculation"]
        assert trace["a"]["purity_factor"] == pytest.approx(999 / 995 if purity else 1)
        assert trace["a"]["close_p10_adjusted"] == pytest.approx(
            101 * (999 / 995 if purity else 1)
        )
        for b in trace["b_components"]:
            assert b["close"] == 10
            assert b["quote_grams"] == 1 and b["unit_factor"] == 10
            assert b["close_p10_raw"] == 100


def test_same_expiry_and_unmatched_components(analytics_api):
    client, _, _ = analytics_api
    for query in (
        "pair=GOLDTEN-GOLDPETAL",
        "pair=GOLDM-GOLDTEN&carry_adjusted=false",
    ):
        trace = fetch(client, query)["series"][0]["latest"]["calculation"]
        assert len(trace["b_components"]) == 1
        assert trace["b_weights"] == [1]


def test_missing_brackets_no_trade_and_missing_price_remain_honest(analytics_api):
    client, engine, _ = analytics_api
    with engine.begin() as connection:
        connection.execute(
            update(bhav)
            .where(bhav.c.symbol == "GOLDM")
            .values(expiry_date=date(2027, 1, 5))
        )
    missing = fetch(client)["series"][0]["latest"]
    assert missing["reason"] == "no_bracket"
    assert missing["calculation"]["b_components"] == []
    assert missing["calculation"]["b_weights"] == []
    assert missing["b_p10_999"] is None
    untraded = fetch(client, "pair=GOLDTEN-GOLDPETAL")["series"][0]["latest"]
    assert not untraded["calculation"]["a"]["has_trade"]
    assert not untraded["liquidity_ok"]
    with engine.begin() as connection:
        connection.execute(
            update(bhav).where(bhav.c.symbol == "GOLDPETAL").values(close=None)
        )
    invalid = fetch(client, "pair=GOLDTEN-GOLDPETAL")["series"][0]["latest"]
    assert invalid["calculation"]["b_components"][0]["close"] is None
    assert invalid["spread_abs"] is None


def test_preceding_finite_count_and_zero_variance(analytics_api):
    client, engine, _ = analytics_api
    body = fetch(client, "pair=GOLDTEN-GOLDPETAL&window=2&min_periods=2")
    rows = body["series"][0]["rows"]
    assert [r["calculation"]["preceding_finite_count"] for r in rows] == [
        0,
        1,
        2,
        2,
        2,
        2,
        2,
    ]
    assert rows[2]["calculation"]["statistics_status"] == "ok"
    with engine.begin() as connection:
        connection.execute(
            update(bhav).where(bhav.c.symbol == "GOLDTEN").values(close=100)
        )
    body = fetch(
        client, "pair=GOLDTEN-GOLDPETAL&window=2&min_periods=2&start=2026-10-09"
    )
    row = body["series"][0]["rows"][0]
    assert row["calculation"]["preceding_finite_count"] == 2
    assert row["calculation"]["statistics_status"] == "zero_variance"
    assert row["z"] is None and row["percentile"] == 50


def test_untraded_interpolation_preserves_components_without_invented_weights(
    analytics_api,
):
    client, _, _ = analytics_api
    row = fetch(client)["series"][0]["latest"]
    assert row["reason"] == "leg_no_trade"
    assert len(row["calculation"]["b_components"]) == 2
    assert not row["calculation"]["b_components"][0]["has_trade"]
    assert row["calculation"]["b_components"][0]["close"] is not None
    assert row["calculation"]["b_weights"] == []
    assert row["b_p10_999"] is None and row["spread_abs"] is None
