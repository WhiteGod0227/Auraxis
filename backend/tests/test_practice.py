from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api import practice
from app.api.auth import COOKIE, fingerprint
from app.api.auth import database as auth_database
from app.core.config import Settings, get_settings
from app.main import app

ORIGIN = {"Origin": "http://localhost:5180"}
EXP = "2030-11-30"
START = 1_000_000


def make_market(prices=None, *, can_trade=True, traded=True, z=2.4, expiry=EXP):
    prices = prices or {
        "GOLDM": 124_000.0,
        "GOLDTEN": 125_000.0,
        "GOLDGUINEA": 124_800.0,
        "GOLDPETAL": 125_100.0,
    }
    return practice.Market(
        can_trade=can_trade,
        reason="" if can_trade else "MCX is closed.",
        trade_date="2030-11-20",
        updated_at=datetime.now(UTC).isoformat(),
        quotes={(p, expiry): (price, traded) for p, price in prices.items()},
        product_expiry={p: expiry for p in prices},
        pairs={pair: (expiry, z) for pair in practice.PAIRS},
    )


@pytest.fixture
def practice_client(tmp_path):
    settings = Settings(
        auth_database_path=tmp_path / "auth.sqlite3",
        workspace_database_path=tmp_path / "private.sqlite3",
        practice_database_path=tmp_path / "practice.sqlite3",
        database_url=f"sqlite:///{(tmp_path / 'market.sqlite3').as_posix()}",
    )
    state = {"market": make_market()}
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[practice.get_market_source] = lambda: (
        lambda _settings: state["market"]
    )
    with TestClient(app, headers=ORIGIN, raise_server_exceptions=False) as client:
        with auth_database(settings) as db:
            for owner in (1, 2):
                db.execute(
                    "INSERT INTO users VALUES (?,?,?,?)",
                    (owner, f"User {owner}", f"u{owner}@example.test", "x"),
                )
                db.execute(
                    "INSERT INTO sessions VALUES (?,?,?)",
                    (fingerprint(f"token-{owner}"), owner, 9999999999),
                )
        client.cookies.set(COOKIE, "token-1")
        yield client, state
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)


def order(client, **values):
    body = dict(
        request_id=values.pop("request_id", f"req-{uuid4().hex}"),
        kind="product",
        instrument="GOLDTEN",
        side="buy",
        grams=100,
    )
    body.update(values)
    return client.post("/api/practice/orders", json=body)


def as_user(client, owner):
    client.cookies.set(COOKIE, f"token-{owner}")


def test_new_user_gets_demo_money_privately(practice_client):
    client, _ = practice_client
    response = client.get("/api/practice")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    body = response.json()
    assert body["currency"] == "Demo ₹"
    assert body["balance"] == body["equity"] == body["available"] == START
    assert body["market"]["can_trade"] is True
    pairs = {p["pair"]: p for p in body["instruments"]["pairs"]}
    assert set(pairs) == set(practice.PAIRS)
    assert pairs["GOLDTEN-GOLDGUINEA"]["lot"] == 40  # lcm(10 g, 8 g)
    assert pairs["GOLDTEN-GOLDPETAL"]["suggested"] == "fall"  # z = +2.4
    assert {a["earned_at"] for a in body["achievements"]} == {None}


def test_requires_login(practice_client):
    client, _ = practice_client
    client.cookies.clear()
    assert client.get("/api/practice").status_code == 401


def test_product_trade_costs_margin_and_pnl(practice_client):
    client, state = practice_client
    opened = order(client, request_id="buy-ten-1")
    assert opened.status_code == 201, opened.text
    # 100 g at ₹1,25,000 per 10 g = ₹12,50,000 notional.
    entry_cost = 12_50_000 * 5 / 10_000  # ₹625
    assert opened.json()["entry_cost"] == entry_cost
    assert opened.json()["margin"] == 1_25_000  # 10 %
    summary = client.get("/api/practice").json()
    assert summary["balance"] == START - entry_cost
    assert summary["margin_in_use"] == 1_25_000

    state["market"] = make_market(
        {"GOLDTEN": 126_000.0, "GOLDM": 1.0, "GOLDGUINEA": 1.0, "GOLDPETAL": 1.0}
    )
    summary = client.get("/api/practice").json()
    position = summary["positions"][0]
    assert position["open_pnl"] == 10_000  # +₹1,000 per 10 g × 10
    assert summary["equity"] == START - entry_cost + 10_000

    closed = client.post(f"/api/practice/positions/{position['id']}/close")
    assert closed.status_code == 200, closed.text
    exit_cost = 12_60_000 * 5 / 10_000  # ₹630
    assert closed.json()["net"] == 10_000 - entry_cost - exit_cost
    summary = client.get("/api/practice").json()
    assert summary["balance"] == START + 10_000 - entry_cost - exit_cost
    assert summary["positions"] == [] and summary["margin_in_use"] == 0
    assert summary["stats"]["trades"] == 1 and summary["stats"]["wins"] == 1
    earned = {a["code"] for a in summary["achievements"] if a["earned_at"]}
    assert earned == {"first_trade", "first_profit"}
    # Closing twice is refused.
    again = client.post(f"/api/practice/positions/{position['id']}/close")
    assert again.status_code == 409


def test_pair_trade_profits_when_gap_falls(practice_client):
    client, state = practice_client
    opened = order(
        client,
        request_id="pair-trade-1",
        kind="pair",
        instrument="GOLDTEN-GOLDPETAL",
        side="fall",
        grams=100,
    )
    assert opened.status_code == 201, opened.text
    # Gap was 125,000 − 125,100 = −100; it falls to −300.
    state["market"] = make_market(
        {"GOLDTEN": 125_000.0, "GOLDPETAL": 125_300.0, "GOLDM": 1.0, "GOLDGUINEA": 1.0}
    )
    position = client.get("/api/practice").json()["positions"][0]
    assert position["open_pnl"] == 2_000  # ₹200 per 10 g × 10
    summary = client.get("/api/practice").json()
    earned = {a["code"] for a in summary["achievements"] if a["earned_at"]}
    assert {"first_trade", "pair_trader", "unusual_gap"} <= earned


def test_double_submit_opens_one_trade(practice_client):
    client, _ = practice_client
    first = order(client, request_id="same-request-1")
    second = order(client, request_id="same-request-1")
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert len(client.get("/api/practice").json()["positions"]) == 1


@pytest.mark.parametrize(
    ("values", "status"),
    [
        (dict(kind="pair", instrument="GOLDM-GOLDTEN", side="rise"), 422),
        (dict(side="rise"), 422),
        (dict(kind="pair", instrument="GOLDTEN-GOLDPETAL", side="buy"), 422),
        (dict(grams=15), 422),  # GOLDTEN lot is 10 g
        (dict(grams=20_000), 422),
        (dict(instrument="SILVER"), 422),
        (dict(request_id="x"), 422),
    ],
)
def test_order_validation(practice_client, values, status):
    client, _ = practice_client
    assert order(client, **values).status_code == status


def test_closed_market_stale_price_and_funds(practice_client):
    client, state = practice_client
    opened = order(client, request_id="before-close")
    assert opened.status_code == 201
    state["market"] = make_market(can_trade=False)
    response = order(client, request_id="after-close")
    assert response.status_code == 409 and "closed" in response.json()["detail"]
    close = client.post(f"/api/practice/positions/{opened.json()['id']}/close")
    assert close.status_code == 409
    state["market"] = make_market(traded=False)
    stale = order(client, request_id="stale-price")
    assert stale.status_code == 409 and "stale" in stale.json()["detail"]
    state["market"] = make_market()
    # 10 kg of GOLDTEN needs ₹12.5 lakh margin, more than is available.
    big = order(client, request_id="too-big-1", grams=10_000)
    assert big.status_code == 409 and "Not enough" in big.json()["detail"]


def test_users_cannot_see_or_close_each_others_trades(practice_client):
    client, _ = practice_client
    mine = order(client, request_id="user-one-trade").json()
    as_user(client, 2)
    assert client.get("/api/practice").json()["positions"] == []
    assert client.post(f"/api/practice/positions/{mine['id']}/close").status_code == 404
    as_user(client, 1)
    assert len(client.get("/api/practice").json()["positions"]) == 1


def test_reset_restores_balance(practice_client):
    client, _ = practice_client
    order(client, request_id="to-be-reset")
    assert (
        client.post("/api/practice/reset", json={"confirm": False}).status_code == 422
    )
    assert client.post("/api/practice/reset", json={"confirm": True}).status_code == 200
    summary = client.get("/api/practice").json()
    assert summary["balance"] == START and summary["positions"] == []
    assert summary["resets"] == 1


def test_expired_contracts_settle_automatically(practice_client):
    client, state = practice_client
    past = (datetime.now(UTC) - timedelta(days=3)).date().isoformat()
    state["market"] = make_market(expiry=past)
    assert order(client, request_id="expiring-1").status_code == 201
    state["market"] = make_market()
    summary = client.get("/api/practice").json()
    assert summary["positions"] == []
    settled = summary["history"][0]
    assert settled["close_reason"] == "expired"
    # No stored settlement here, so it closes at the entry price: costs only.
    assert settled["gross"] == 0 and settled["net"] < 0


def test_leaderboard_opt_in_and_unique_names(practice_client):
    client, state = practice_client
    assert (
        client.put("/api/practice/profile", json={"leaderboard": True}).status_code
        == 422
    )
    bad = client.put(
        "/api/practice/profile", json={"leaderboard": True, "display_name": "<x>"}
    )
    assert bad.status_code == 422
    ok = client.put(
        "/api/practice/profile", json={"leaderboard": True, "display_name": "Gold Bug"}
    )
    assert ok.status_code == 200
    # No closed trades yet: not listed.
    assert client.get("/api/practice/leaderboard").json()["entries"] == []
    trade = order(client, request_id="board-trade").json()
    state["market"] = make_market(
        {"GOLDTEN": 126_000.0, "GOLDM": 1.0, "GOLDGUINEA": 1.0, "GOLDPETAL": 1.0}
    )
    client.post(f"/api/practice/positions/{trade['id']}/close")
    board = client.get("/api/practice/leaderboard").json()
    assert [e["name"] for e in board["entries"]] == ["Gold Bug"]
    assert board["entries"][0]["you"] is True and board["entries"][0]["rank"] == 1
    as_user(client, 2)
    taken = client.put(
        "/api/practice/profile", json={"leaderboard": True, "display_name": "gold bug"}
    )
    assert taken.status_code == 409
    # Another user sees names and returns only.
    entry = client.get("/api/practice/leaderboard").json()["entries"][0]
    assert set(entry) == {"name", "return_pct", "trades", "you", "rank"}
    assert entry["you"] is False


def test_writes_require_allowed_origin(practice_client):
    client, _ = practice_client
    response = client.post(
        "/api/practice/orders",
        json=dict(
            request_id="no-origin-1",
            kind="product",
            instrument="GOLDTEN",
            side="buy",
            grams=10,
        ),
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403


def test_market_from_snapshot_states():
    settings = Settings(live_poll_seconds=30)
    now = datetime(2030, 11, 20, 10, 0, tzinfo=UTC)  # 15:30 IST
    snapshot = dict(
        state="live",
        trade_date="2030-11-20",
        updated_at=(now - timedelta(seconds=20)).isoformat(),
        quotes=[
            dict(
                product="GOLDTEN",
                expiry_date=EXP,
                price_p10=125000.0,
                traded_today=True,
            )
        ],
        references=[dict(product="GOLDTEN", available=True, expiry_date=EXP)],
        pairs=[
            dict(pair="GOLDTEN-GOLDPETAL", expiry=EXP, z=-1.2),
            dict(pair="GOLDM-GOLDTEN", expiry=EXP, z=3.0),
        ],
    )
    market = practice.market_from_snapshot(snapshot, settings, now)
    assert market.can_trade and market.quotes[("GOLDTEN", EXP)] == (125000.0, True)
    assert set(market.pairs) == {"GOLDTEN-GOLDPETAL"}  # GOLDM pairs excluded
    stale = dict(snapshot, updated_at=(now - timedelta(minutes=10)).isoformat())
    assert "delayed" in practice.market_from_snapshot(stale, settings, now).reason
    closed = dict(snapshot, state="closed")
    assert "closed" in practice.market_from_snapshot(closed, settings, now).reason
    off = dict(snapshot, state="not_configured")
    assert "off" in practice.market_from_snapshot(off, settings, now).reason
