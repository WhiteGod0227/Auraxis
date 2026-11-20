import json
from datetime import UTC, date, datetime

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.data import onchain
from app.data.loader import bhav, create_loader_engine
from app.data.upstox import market_metadata
from app.main import app

PAXG, XAUT = onchain.TOKENS
NOV_1_UTC_MS = int(datetime(2026, 11, 1, tzinfo=UTC).timestamp() * 1000)
DAY_MS = 86_400_000


def words(value: int) -> str:
    return "0x" + format(value, "064x")


def transport(calls, *, prices_status=200, rpc_status=200):
    def handler(request: httpx.Request):
        calls.append(request)
        if request.url.path.endswith("/simple/price"):
            if prices_status != 200:
                return httpx.Response(prices_status)
            return httpx.Response(
                200,
                json={
                    "pax-gold": {
                        "inr": 330000,
                        "usd": 3560,
                        "last_updated_at": 1795183751,
                    },
                    "tether-gold": {
                        "inr": 330100,
                        "usd": 3561,
                        "last_updated_at": 1795183751,
                    },
                    "unrelated": {"inr": 1},
                },
            )
        if "/market_chart" in request.url.path:
            base = 300000 if "pax-gold" in request.url.path else 300100
            return httpx.Response(
                200,
                json={
                    "prices": [
                        [NOV_1_UTC_MS + i * DAY_MS, base + i * 100] for i in range(5)
                    ]
                },
            )
        if request.method == "POST":
            if rpc_status != 200:
                return httpx.Response(rpc_status)
            body = json.loads(request.content)
            call = body["params"][0]
            decimals = 18 if call["to"] == PAXG.contract else 6
            if call["data"] == onchain.DECIMALS:
                return httpx.Response(
                    200, json={"jsonrpc": "2.0", "id": 1, "result": words(decimals)}
                )
            supply = 443_057 if call["to"] == PAXG.contract else 827_417
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": words(supply * 10**decimals),
                },
            )
        return httpx.Response(404)

    return httpx.MockTransport(handler)


@pytest.fixture
def settings(tmp_path):
    return Settings(
        onchain_enabled=True,
        onchain_database_path=tmp_path / "onchain.sqlite3",
        database_url=f"sqlite:///{(tmp_path / 'market.db').as_posix()}",
        upstox_access_token="",
    )


# --------------------------------------------------------------------------- #
# Maths
# --------------------------------------------------------------------------- #


def test_parity_per_10g_includes_duty():
    # One troy ounce at ₹3,11,034.768 is ₹1,00,000 per 10 g before duty.
    assert onchain.parity_p10(311_034.768, 0) == pytest.approx(100_000)
    assert onchain.parity_p10(311_034.768, 15) == pytest.approx(115_000)


def test_duty_schedule_uses_rate_in_force(settings):
    assert onchain.duty_on(settings, date(2024, 7, 23)) == 15
    assert onchain.duty_on(settings, date(2024, 7, 24)) == 6
    assert onchain.duty_on(settings, date(2026, 5, 12)) == 6
    assert onchain.duty_on(settings, date(2026, 5, 13)) == 15


@pytest.mark.parametrize("bad", [None, "", "0x", "deadbeef", "0xnothex"])
def test_decode_uint_rejects_bad_results(bad):
    with pytest.raises(onchain.OnchainError):
        onchain.decode_uint(bad)


def test_invalid_duty_schedule_is_rejected():
    with pytest.raises(ValueError):
        Settings(onchain_duty_schedule={"2026-13-01": 15})
    with pytest.raises(ValueError):
        Settings(onchain_duty_schedule={"2026-05-13": 150})


# --------------------------------------------------------------------------- #
# Sources and service
# --------------------------------------------------------------------------- #


def test_prices_supply_and_decimals_are_read_from_chain(settings):
    calls = []
    client = httpx.Client(transport=transport(calls))
    prices = onchain.fetch_prices(client, settings)
    assert set(prices) == {"PAXG", "XAUT"} and prices["PAXG"]["inr"] == 330000
    amount, decimals = onchain.fetch_supply(client, settings, XAUT, None)
    assert decimals == 6 and amount == 827_417  # XAUT uses 6 decimals, not 18
    before = len(calls)
    amount, decimals = onchain.fetch_supply(client, settings, PAXG, 18)
    assert amount == 443_057
    # Known decimals are cached: only totalSupply() is requested.
    sent = [json.loads(c.content)["params"][0]["data"] for c in calls[before:]]
    assert sent == [onchain.TOTAL_SUPPLY]


def test_tick_stores_history_and_survives_price_outage(settings):
    service = onchain.OnchainService()
    client = httpx.Client(transport=transport([]))
    service.tick(settings, client)
    state = service.state()
    assert state["prices"]["PAXG"]["usd"] == 3560
    assert state["supply"]["XAUT"]["tonnes"] == pytest.approx(
        827_417 * onchain.TROY_OUNCE_GRAMS / 1e6
    )
    with onchain.database(settings) as db:
        assert db.execute("SELECT COUNT(*) FROM token_daily").fetchone()[0] == 10
        assert db.execute("SELECT COUNT(*) FROM token_snapshots").fetchone()[0] == 2
    # Price source down: error recorded, last prices kept, supply unaffected.
    failing = httpx.Client(transport=transport([], prices_status=429))
    service.tick(settings, failing)
    state = service.state()
    assert "rate-limiting" in state["price_error"]
    assert state["prices"]["PAXG"]["inr"] == 330000


def test_rpc_outage_is_reported_without_losing_prices(settings):
    service = onchain.OnchainService()
    service.tick(settings, httpx.Client(transport=transport([], rpc_status=503)))
    state = service.state()
    assert state["prices"] and not state["supply"]
    assert "HTTP 503" in state["supply_error"]


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #


def settle(settings, rows):
    engine = create_loader_engine(settings)
    market_metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            bhav.insert(),
            [
                dict(
                    symbol=symbol,
                    expiry_date=expiry,
                    trade_date=day,
                    open=close,
                    high=close,
                    low=close,
                    close=close,
                    previous_close=None,
                    value_lacs=None,
                    volume_lots=10,
                    volume_text="",
                    open_interest_lots=10,
                    volume_grams=100,
                    open_interest_grams=100,
                    has_trade=True,
                )
                for symbol, expiry, day, close in rows
            ],
        )
    engine.dispose()


@pytest.fixture
def api(settings, monkeypatch):
    service = onchain.OnchainService()
    service.tick(settings, httpx.Client(transport=transport([])))
    monkeypatch.setattr(onchain, "service", service)
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: settings
    yield TestClient(app), settings
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)


def test_disabled_by_default_in_tests():
    response = TestClient(app).get("/api/onchain/gold")
    assert response.status_code == 404


def test_gold_compares_tokens_with_settled_mcx(api):
    client, settings = api
    settle(
        settings,
        [
            ("GOLDTEN", date(2030, 12, 31), date(2026, 11, 3), 125_000.0),
            ("GOLDPETAL", date(2030, 12, 31), date(2026, 11, 3), 12_500.0),
        ],
    )
    body = client.get("/api/onchain/gold").json()
    tokens = {t["symbol"]: t for t in body["tokens"]}
    assert tokens["PAXG"]["explorer_url"].endswith(PAXG.contract)
    duty = body["duty_pct"]
    parity = onchain.parity_p10(330000, duty)
    assert tokens["PAXG"]["parity_p10"] == pytest.approx(parity)
    rows = {(c["product"], c["token"]): c for c in body["comparisons"]}
    ten = rows[("GOLDTEN", "PAXG")]
    assert ten["mcx_p10"] == 125_000 and ten["gap"] == pytest.approx(125_000 - parity)
    assert rows[("GOLDPETAL", "PAXG")]["mcx_p10"] == 125_000  # 1 g quote × 10
    assert {m["source"] for m in body["mcx"]} == {"settlement"}
    assert body["assumptions"]


def test_history_pairs_mcx_day_with_next_utc_token_price(api):
    client, settings = api
    # Token daily prices: 1 Nov ₹300,000 … 5 Nov ₹300,400 (PAXG).
    settle(
        settings,
        [("GOLDTEN", date(2030, 12, 31), date(2026, 11, d), 120_000.0) for d in (2, 3)],
    )
    body = client.get("/api/onchain/history?product=GOLDTEN&days=730").json()
    points = {p["date"]: p for p in body["points"]}
    duty = onchain.duty_on(settings, date(2026, 11, 2))
    # MCX 2 Nov (settles ~18:25 UTC) pairs with the token price stamped 3 Nov 00:00 UTC.
    assert points["2026-11-02"]["PAXG_parity"] == pytest.approx(
        onchain.parity_p10(300_200, duty)
    )
    assert points["2026-11-02"]["PAXG_gap"] == pytest.approx(
        120_000 - onchain.parity_p10(300_200, duty)
    )
    assert client.get("/api/onchain/history?product=SILVER").status_code == 422


def test_first_tick_runs_everything_even_right_after_boot(settings, monkeypatch):
    # time.monotonic() counts from boot on Windows; a fresh machine or
    # container must still fetch supply and daily history on the first tick.
    monkeypatch.setattr(onchain.time, "monotonic", lambda: 5.0)
    service = onchain.OnchainService()
    service.tick(settings, httpx.Client(transport=transport([])))
    assert service.state()["supply"]
    with onchain.database(settings) as db:
        assert db.execute("SELECT COUNT(*) FROM token_daily").fetchone()[0] == 10
