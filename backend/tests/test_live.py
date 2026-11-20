import gzip
import json
import math
from datetime import UTC, date, datetime, timedelta

import httpx
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.analytics.live import LiveQuote, compute_live
from app.analytics.spreads import compute_spreads
from app.core.config import Settings, get_settings
from app.data import live
from app.data.loader import bhav, create_loader_engine
from app.data.upstox import IST, Contract, market_metadata
from app.main import app

LIVE_DATE = date(2026, 11, 20)  # Friday
NOV = date(2026, 11, 30)
DEC = date(2026, 12, 31)
JAN = date(2027, 1, 29)
GOLDM_DEC = date(2026, 12, 4)
# Contract -> (symbol, expiry, base price in its own quote unit)
CONTRACTS = {
    "MCX_FO|12": ("GOLDTEN", NOV, 124500.0),
    "MCX_FO|22": ("GOLDPETAL", NOV, 12440.0),
    "MCX_FO|32": ("GOLDGUINEA", NOV, 99550.0),
    "MCX_FO|10": ("GOLDTEN", DEC, 125000.0),
    "MCX_FO|11": ("GOLDTEN", JAN, 126000.0),
    "MCX_FO|20": ("GOLDPETAL", DEC, 12490.0),
    "MCX_FO|21": ("GOLDPETAL", JAN, 12595.0),
    "MCX_FO|30": ("GOLDGUINEA", DEC, 99950.0),
    "MCX_FO|31": ("GOLDGUINEA", JAN, 100780.0),
    "MCX_FO|40": ("GOLDM", GOLDM_DEC, 124700.0),
    "MCX_FO|41": ("GOLDM", date(2027, 1, 5), 125600.0),
}


def sessions(count):
    days, day = [], LIVE_DATE
    while len(days) < count:
        day -= timedelta(days=1)
        if day.weekday() < 5:
            days.append(day)
    return sorted(days)


def price(base, index, key):
    # Deterministic, non-constant wiggle so rolling σ is non-zero.
    return round(base * (1 + 0.004 * math.sin(index * 1.7 + int(key[-2:]))), 2)


def row(symbol, expiry, day, close, volume_lots=50):
    lot = Settings().lot_grams[symbol]
    return dict(
        symbol=symbol,
        expiry_date=expiry,
        trade_date=day,
        open=close,
        high=close,
        low=close,
        close=close,
        previous_close=None,
        value_lacs=None,
        volume_lots=volume_lots,
        volume_text="",
        open_interest_lots=100,
        volume_grams=volume_lots * lot,
        open_interest_grams=100 * lot,
        has_trade=volume_lots > 0,
    )


def history_rows(count=12):
    return [
        row(symbol, expiry, day, price(base, index, key))
        for index, day in enumerate(sessions(count))
        for key, (symbol, expiry, base) in CONTRACTS.items()
    ]


def live_prices():
    return {
        key: round(base * 1.006 + (37 if symbol == "GOLDGUINEA" else 0), 2)
        for key, (symbol, expiry, base) in CONTRACTS.items()
    }


def make_settings(tmp_path, name="market.db", **extra):
    return Settings(
        database_url=f"sqlite:///{(tmp_path / name).as_posix()}",
        data_cache_dir=tmp_path / "cache",
        auth_database_path=tmp_path / "auth.sqlite3",
        upstox_access_token="test-token",
        **{"live_poll_seconds": 30, **extra},
    )


def store(settings, rows):
    engine = create_loader_engine(settings)
    market_metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(bhav.insert(), rows)
    engine.dispose()


def quotes_for(prices, traded=True):
    stamp = datetime(2026, 11, 20, 14, 5, tzinfo=IST)
    settings = Settings()
    return [
        LiveQuote(
            symbol=symbol,
            expiry=expiry,
            key=key,
            last_price=prices[key],
            volume_lots=50 if traded else 0,
            volume_grams=50 * settings.lot_grams[symbol] if traded else 0,
            oi_lots=100,
            oi_grams=100 * settings.lot_grams[symbol],
            exchange_previous_close=None,
            last_trade_at=stamp,
            traded_today=traded,
        )
        for key, (symbol, expiry, _) in CONTRACTS.items()
    ]


# --------------------------------------------------------------------------- #
# Market hours and settings
# --------------------------------------------------------------------------- #


def test_market_hours_follow_ist_weekdays():
    settings = Settings()
    at = lambda *args: datetime(*args, tzinfo=IST)  # noqa: E731
    assert live.market_open(at(2026, 11, 20, 9, 0), settings)
    assert live.market_open(at(2026, 11, 20, 23, 54), settings)
    assert not live.market_open(at(2026, 11, 20, 23, 55), settings)
    assert not live.market_open(at(2026, 11, 20, 8, 59), settings)
    assert not live.market_open(at(2026, 11, 21, 12, 0), settings)  # Saturday
    # UTC input is converted to IST: 03:30 UTC is 09:00 IST.
    assert live.market_open(datetime(2026, 11, 20, 3, 30, tzinfo=UTC), settings)
    # Friday night waits until Monday 09:00.
    wait = live.seconds_until_open(at(2026, 11, 20, 23, 56), settings)
    assert wait == (at(2026, 11, 23, 9, 0) - at(2026, 11, 20, 23, 56)).total_seconds()
    assert live.seconds_until_open(at(2026, 11, 20, 12, 0), settings) == 0


@pytest.mark.parametrize(
    "values",
    [
        {"live_poll_seconds": 2},
        {"live_session_start": "9:00"},
        {"live_session_end": "24:00"},
        {"live_session_start": "23:00", "live_session_end": "09:00"},
    ],
)
def test_invalid_live_settings_are_rejected(values):
    with pytest.raises(ValidationError):
        Settings(**values)


def test_live_settings_accept_off_and_custom_session():
    settings = Settings(
        live_poll_seconds=0, live_session_start="10:00", live_session_end="23:30"
    )
    assert settings.live_poll_seconds == 0


# --------------------------------------------------------------------------- #
# Quote parsing
# --------------------------------------------------------------------------- #


def quote_payload(prices, contracts, *, stamp=None, volume=50):
    stamp = stamp or datetime(2026, 11, 20, 14, 5, tzinfo=IST)
    data = {}
    for contract in contracts:
        data[f"MCX_FO:{contract.symbol}{contract.expiry:%y%b}FUT".upper()] = {
            "instrument_token": contract.key,
            "last_price": prices[contract.key],
            "volume": volume,
            "oi": 100,
            "net_change": 100.0,
            "last_trade_time": str(int(stamp.timestamp() * 1000)),
            "timestamp": stamp.isoformat(),
            "ohlc": {"open": 1, "high": 1, "low": 1, "close": 1},
        }
    data["MCX_FO:UNKNOWN"] = {"instrument_token": "MCX_FO|999", "last_price": 5}
    data["MCX_FO:BROKEN"] = "not a quote"
    return {"status": "success", "data": data}


def contract_list():
    return [
        Contract(symbol, expiry, key, "")
        for key, (symbol, expiry, _) in CONTRACTS.items()
    ]


def test_parse_quotes_maps_tokens_and_converts_lots():
    contracts = contract_list()
    parsed = live.parse_quotes(
        quote_payload(live_prices(), contracts), contracts, Settings()
    )
    assert len(parsed) == len(CONTRACTS)
    goldm = next(item for item in parsed if item["contract"].key == "MCX_FO|40")
    assert goldm["volume_grams"] == 5000 and goldm["oi_grams"] == 10000
    assert goldm["exchange_previous_close"] == pytest.approx(
        live_prices()["MCX_FO|40"] - 100
    )
    assert goldm["last_trade_at"] == datetime(2026, 11, 20, 14, 5, tzinfo=IST)
    assert live.parse_quotes({"data": None}, contracts, Settings()) == []
    assert live.parse_quotes({}, contracts, Settings()) == []


def test_session_date_uses_latest_trade_and_flags_stale_contracts():
    contracts = contract_list()
    parsed = live.parse_quotes(
        quote_payload(live_prices(), contracts), contracts, Settings()
    )
    parsed[0]["last_trade_at"] = datetime(2026, 11, 18, 11, 0, tzinfo=IST)
    saturday = datetime(2026, 11, 21, 10, 0, tzinfo=IST)
    live_date, quotes = live.session_quotes(parsed, saturday)
    assert live_date == LIVE_DATE
    stale = quotes[0]
    assert stale.traded_today is False and stale.volume_grams == 0
    assert all(quote.traded_today for quote in quotes[1:])


# --------------------------------------------------------------------------- #
# Analytics: identical to the settlement method
# --------------------------------------------------------------------------- #


def test_live_readings_match_settlement_method(tmp_path):
    """A live price must score exactly as the same settlement price would."""
    history = history_rows()
    prices = live_prices()
    live_settings = make_settings(tmp_path, "live.db")
    store(live_settings, history)
    frame, latest = live.read_history(live_settings, LIVE_DATE)
    assert latest == sessions(12)[-1]
    result = compute_live(quotes_for(prices), LIVE_DATE, frame, live_settings)

    settled = make_settings(tmp_path, "settled.db")
    store(
        settled,
        history
        + [
            row(symbol, expiry, LIVE_DATE, prices[key])
            for key, (symbol, expiry, _) in CONTRACTS.items()
        ],
    )
    assert {item["pair"] for item in result["pairs"]} == set(settled.spread_pairs)
    for reading in result["pairs"]:
        expected = compute_spreads(
            reading["pair"],
            window=10,
            min_periods=5,
            carry_adjusted=True,
            min_volume_grams=2000,
            min_oi_grams=0,
            settings=settled,
        )
        expected = expected.loc[
            (expected.trade_date == LIVE_DATE)
            & (expected.expiry_a == date.fromisoformat(reading["expiry"]))
        ].iloc[0]
        for field in ("spread_abs", "spread_pct", "z", "percentile"):
            assert reading[field] == pytest.approx(expected[field]), field
        assert reading["z"] is not None
        assert reading["settled_trade_date"] == sessions(12)[-1].isoformat()
    # Earliest expiry at least three days after the live session.
    goldten = next(r for r in result["pairs"] if r["pair"] == "GOLDTEN-GOLDPETAL")
    assert goldten["expiry"] == NOV.isoformat()
    goldm = next(r for r in result["pairs"] if r["pair"] == "GOLDM-GOLDTEN")
    assert goldm["expiry"] == GOLDM_DEC.isoformat()


def test_references_use_nearest_contract_and_stored_settlement(tmp_path):
    settings = make_settings(tmp_path)
    store(settings, history_rows())
    frame, _ = live.read_history(settings, LIVE_DATE)
    prices = live_prices()
    result = compute_live(quotes_for(prices), LIVE_DATE, frame, settings)
    by_product = {item["product"]: item for item in result["references"]}
    petal = by_product["GOLDPETAL"]
    assert petal["expiry_date"] == NOV.isoformat()
    assert petal["price_p10"] == pytest.approx(prices["MCX_FO|22"] * 10)
    previous = price(12440.0, 11, "MCX_FO|22")
    assert petal["change_basis"] == "stored_settlement"
    assert petal["change_abs"] == pytest.approx((prices["MCX_FO|22"] - previous) * 10)
    assert petal["change_pct"] == pytest.approx(
        100 * (prices["MCX_FO|22"] / previous - 1)
    )
    guinea = by_product["GOLDGUINEA"]
    assert guinea["price_p10"] == pytest.approx(prices["MCX_FO|32"] * 10 / 8)
    assert by_product["GOLDM"]["expiry_date"] == GOLDM_DEC.isoformat()


def test_reference_skips_contract_expiring_within_three_days(tmp_path):
    settings = make_settings(tmp_path)
    frame = live.read_history(settings, LIVE_DATE)[0]
    late = date(2026, 11, 28)  # November expires in 2 days, so December is used
    result = compute_live(quotes_for(live_prices()), late, frame, settings)
    petal = next(r for r in result["references"] if r["product"] == "GOLDPETAL")
    assert petal["expiry_date"] == DEC.isoformat()


def test_live_without_history_still_reports_prices_and_gaps():
    settings = Settings()
    empty = pd.DataFrame(columns=live.HISTORY_COLUMNS)
    result = compute_live(quotes_for(live_prices()), LIVE_DATE, empty, settings)
    assert all(item["available"] for item in result["references"])
    assert all(item["change_abs"] is None for item in result["references"])
    assert result["pairs"] and all(item["z"] is None for item in result["pairs"])
    assert all(item["spread_abs"] is not None for item in result["pairs"])


def test_untraded_contracts_are_not_tradable_but_still_priced(tmp_path):
    settings = make_settings(tmp_path)
    store(settings, history_rows())
    frame, _ = live.read_history(settings, LIVE_DATE)
    result = compute_live(
        quotes_for(live_prices(), traded=False), LIVE_DATE, frame, settings
    )
    references = result["references"]
    assert all(item["traded_today"] is False for item in references)
    same_expiry = [r for r in result["pairs"] if not r["pair"].startswith("GOLDM")]
    assert same_expiry and all(r["tradable"] is False for r in same_expiry)
    assert all(r["reason"] == "no_trade" for r in same_expiry)


# --------------------------------------------------------------------------- #
# Polling service end to end (mocked Upstox)
# --------------------------------------------------------------------------- #


def instruments():
    return [
        {
            "segment": "MCX_FO",
            "instrument_type": "FUT",
            "underlying_symbol": symbol,
            "instrument_key": key,
            "underlying_key": f"MCX_COM|{symbol}",
            "expiry": int(
                datetime(
                    expiry.year, expiry.month, expiry.day, 23, 59, 59, tzinfo=IST
                ).timestamp()
                * 1000
            ),
        }
        for key, (symbol, expiry, _) in CONTRACTS.items()
    ]


def upstox_transport(calls, prices, status=200):
    def handler(request: httpx.Request):
        calls.append(request.url)
        if request.url.host == "assets.upstox.com":
            return httpx.Response(
                200, content=gzip.compress(json.dumps(instruments()).encode())
            )
        assert request.headers["authorization"] == "Bearer test-token"
        if status != 200:
            return httpx.Response(status, json={"errors": [{"message": "nope"}]})
        assert request.url.path == "/v2/market-quote/quotes"
        keys = request.url.params["instrument_key"].split(",")
        contracts = [c for c in contract_list() if c.key in keys]
        return httpx.Response(200, json=quote_payload(prices, contracts))

    return httpx.MockTransport(handler)


def client_for(calls, prices, status=200):
    return httpx.Client(
        transport=upstox_transport(calls, prices, status),
        headers={"Authorization": "Bearer test-token"},
    )


NOW = datetime(2026, 11, 20, 14, 6, tzinfo=IST)


def test_poll_once_builds_and_saves_snapshot(tmp_path):
    settings = make_settings(tmp_path)
    store(settings, history_rows())
    service = live.LiveService()
    calls = []
    data = service.poll_once(settings, NOW, client_for(calls, live_prices()))
    quote_calls = [url for url in calls if url.path.endswith("/quotes")]
    assert len(quote_calls) == 1  # one request covers every contract
    assert data["trade_date"] == LIVE_DATE.isoformat()
    assert data["stored_through"] == sessions(12)[-1].isoformat()
    assert len(data["quotes"]) == len(CONTRACTS)
    assert len(data["pairs"]) == len(settings.spread_pairs)
    snapshot = service.snapshot(settings, NOW)
    assert snapshot["state"] == "live" and snapshot["market_open"] is True
    assert snapshot["poll_seconds"] == 30
    json.dumps(snapshot, allow_nan=False)  # strictly JSON-safe

    # A second poll reuses the cached contract list.
    service.poll_once(settings, NOW, client_for(calls, live_prices()))
    assert sum(url.host == "assets.upstox.com" for url in calls) == 1

    # A fresh service restores the last snapshot from disk.
    restored = live.LiveService()
    restored.load_saved(settings)
    evening = datetime(2026, 11, 21, 1, 0, tzinfo=IST)
    later = restored.snapshot(settings, evening)
    assert later["state"] == "closed" and later["pairs"] == data["pairs"]


def test_snapshot_marks_session_settled_once_settlement_is_stored(tmp_path):
    settings = make_settings(tmp_path)
    prices = live_prices()
    store(
        settings,
        history_rows()
        + [
            row(symbol, expiry, LIVE_DATE, prices[key])
            for key, (symbol, expiry, _) in CONTRACTS.items()
        ],
    )
    service = live.LiveService()
    service.poll_once(settings, NOW, client_for([], prices))
    # While the session is open a stored row for today cannot be final.
    during = service.snapshot(settings, NOW)
    assert during["state"] == "live" and during["settled"] is False
    after = service.snapshot(settings, datetime(2026, 11, 20, 23, 58, tzinfo=IST))
    assert after["state"] == "settled" and after["settled"] is True
    assert "stored_through" not in after


def test_open_market_before_first_trade_is_not_labelled_live(tmp_path):
    settings = make_settings(tmp_path)
    store(settings, history_rows())
    service = live.LiveService()
    service.poll_once(settings, NOW, client_for([], live_prices()))
    monday = datetime(2026, 11, 23, 9, 2, tzinfo=IST)
    snapshot = service.snapshot(settings, monday)
    assert snapshot["market_open"] is True
    assert snapshot["state"] == "closed"
    assert "first trades" in snapshot["message"]


def test_poll_errors_are_reported_and_keep_last_data(tmp_path):
    settings = make_settings(tmp_path)
    service = live.LiveService()
    service.poll_once(settings, NOW, client_for([], live_prices()))
    with pytest.raises(live.UpstoxError, match="access token"):
        service.poll_once(settings, NOW, client_for([], live_prices(), status=401))


def test_run_loop_records_failures_without_crashing(tmp_path, monkeypatch):
    import asyncio

    settings = make_settings(tmp_path)
    service = live.LiveService()

    def failing(*_args, **_kwargs):
        raise live.UpstoxError("Upstox request failed (HTTP 500)")

    monkeypatch.setattr(service, "poll_once", failing)
    sleeps = []

    async def fake_sleep(delay):
        sleeps.append(delay)
        raise asyncio.CancelledError

    monkeypatch.setattr(live.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(service.run(settings))
    snapshot = service.snapshot(settings)
    assert snapshot["state"] == "error"
    assert "HTTP 500" in snapshot["message"]
    assert sleeps and sleeps[0] >= 1


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #


def test_live_endpoint_reports_not_configured():
    with TestClient(app) as client:
        response = client.get("/api/live")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["state"] == "not_configured"
    assert body["pairs"] == [] and body["references"] == []


def test_live_endpoint_serves_service_snapshot(tmp_path, monkeypatch):
    settings = make_settings(tmp_path)
    service = live.LiveService()
    service.poll_once(settings, NOW, client_for([], live_prices()))
    monkeypatch.setattr("app.api.live.service", service)
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        client = TestClient(app)
        body = client.get("/api/live").json()
    finally:
        app.dependency_overrides.pop(get_settings, None)
    assert body["trade_date"] == LIVE_DATE.isoformat()
    assert body["state"] in {"live", "closed"}
    assert len(body["references"]) == 4


def test_live_endpoint_reports_disabled(tmp_path):
    settings = make_settings(tmp_path, live_poll_seconds=0)
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        body = TestClient(app).get("/api/live").json()
    finally:
        app.dependency_overrides.pop(get_settings, None)
    assert body["state"] == "disabled" and body["next_poll_at"] is None
