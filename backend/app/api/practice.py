"""Practice trading with demo money ("Demo ₹").

Every signed-in user gets a virtual balance to practise on real MCX gold
prices. Demo money has no cash value: it cannot be bought, withdrawn or moved
between users. Trades fill only at the backend's own live last-traded prices,
never at a price sent by the browser, and only while the session is trading.

Money is stored in whole paise (integers) so balances never drift.

Accounting
----------
* Opening charges the entry cost (``cost_bps`` per leg) and blocks margin
  (``margin_pct`` of the gross notional) while the trade is open.
* Closing books the gross P&L minus the exit cost.
* ``available = equity - margin in use`` where equity includes open P&L.

Pair trades use the same-expiry pairs only (GOLDM expires on different dates,
so the app treats its pairs as analytics-only); GOLDM is tradable on its own.
"""

from __future__ import annotations

import math
import re
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, inspect, select
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from app.api.auth import current_user
from app.core.config import BACKEND_DIR, Settings, get_settings
from app.data.loader import bhav, create_loader_engine
from app.data.upstox import IST

router = APIRouter(prefix="/api/practice", tags=["practice"])

PRODUCTS = ("GOLDM", "GOLDTEN", "GOLDGUINEA", "GOLDPETAL")
PAIRS = ("GOLDTEN-GOLDPETAL", "GOLDTEN-GOLDGUINEA", "GOLDGUINEA-GOLDPETAL")
MAX_GRAMS = 10_000
MAX_OPEN = 20
HISTORY_LIMIT = 50
CURRENCY = "Demo ₹"
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{1,22}[A-Za-z0-9]$")

ACHIEVEMENTS = {
    "first_trade": ("First trade", "Placed your first practice trade."),
    "pair_trader": ("Pair trader", "Traded a gap between two products."),
    "unusual_gap": (
        "Gap hunter",
        "Traded a pair while its gap was unusual (beyond 2σ).",
    ),
    "first_profit": ("In the green", "Closed a trade with a profit after costs."),
    "ten_trades": ("Regular", "Closed ten practice trades."),
}


# --------------------------------------------------------------------------- #
# Storage
# --------------------------------------------------------------------------- #


def _resolved(path) -> object:
    return (BACKEND_DIR / path).resolve()


@contextmanager
def database(settings: Settings) -> Iterator[sqlite3.Connection]:
    path = _resolved(settings.practice_database_path)
    protected = {
        _resolved(settings.auth_database_path),
        _resolved(settings.workspace_database_path),
    }
    market = make_url(settings.database_url).database
    if market and market != ":memory:":
        protected.add(_resolved(market))
    if path in protected:
        raise HTTPException(503, "Practice storage is not configured safely.")
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    db.row_factory = sqlite3.Row
    try:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS wallets (
                user_id INTEGER PRIMARY KEY,
                balance_paise INTEGER NOT NULL,
                start_paise INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                reset_at TEXT,
                resets INTEGER NOT NULL DEFAULT 0,
                display_name TEXT,
                leaderboard INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                request_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                instrument TEXT NOT NULL,
                expiry TEXT NOT NULL,
                side TEXT NOT NULL,
                grams INTEGER NOT NULL,
                entry_a REAL NOT NULL,
                entry_b REAL,
                entry_z REAL,
                entry_cost_paise INTEGER NOT NULL,
                margin_paise INTEGER NOT NULL,
                opened_at TEXT NOT NULL,
                status TEXT NOT NULL,
                exit_a REAL,
                exit_b REAL,
                exit_cost_paise INTEGER,
                gross_paise INTEGER,
                net_paise INTEGER,
                closed_at TEXT,
                close_reason TEXT,
                UNIQUE (user_id, request_id)
            );
            CREATE INDEX IF NOT EXISTS positions_user
                ON positions (user_id, status);
            CREATE TABLE IF NOT EXISTS ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                amount_paise INTEGER NOT NULL,
                balance_after_paise INTEGER NOT NULL,
                position_id INTEGER,
                at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS achievements (
                user_id INTEGER NOT NULL,
                code TEXT NOT NULL,
                earned_at TEXT NOT NULL,
                PRIMARY KEY (user_id, code)
            );
            """
        )
        yield db
    finally:
        db.close()


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _wallet(db: sqlite3.Connection, user_id: int, settings: Settings) -> sqlite3.Row:
    row = db.execute("SELECT * FROM wallets WHERE user_id=?", (user_id,)).fetchone()
    if row is not None:
        return row
    start = int(round(settings.practice_start_balance * 100))
    now = _now()
    # Callers hold a BEGIN IMMEDIATE transaction, so this cannot race.
    db.execute(
        "INSERT INTO wallets (user_id,balance_paise,start_paise,created_at) "
        "VALUES (?,?,?,?)",
        (user_id, start, start, now),
    )
    db.execute(
        "INSERT INTO ledger (user_id,kind,amount_paise,balance_after_paise,at) "
        "VALUES (?,'grant',?,?,?)",
        (user_id, start, start, now),
    )
    return db.execute("SELECT * FROM wallets WHERE user_id=?", (user_id,)).fetchone()


def _award(db: sqlite3.Connection, user_id: int, code: str) -> None:
    db.execute(
        "INSERT OR IGNORE INTO achievements VALUES (?,?,?)", (user_id, code, _now())
    )


# --------------------------------------------------------------------------- #
# Prices
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Market:
    """What the practice engine may fill at, built from the live snapshot."""

    can_trade: bool
    reason: str
    trade_date: str | None
    updated_at: str | None
    # (product, expiry ISO) -> (price per 10 g, traded this session)
    quotes: dict[tuple[str, str], tuple[float, bool]]
    # product -> nearest eligible expiry
    product_expiry: dict[str, str]
    # pair -> (expiry, z)
    pairs: dict[str, tuple[str, float | None]]


def market_from_snapshot(snapshot: dict, settings: Settings, now=None) -> Market:
    now = now or datetime.now(UTC)
    quotes = {
        (q["product"], q["expiry_date"]): (
            float(q["price_p10"]),
            bool(q["traded_today"]),
        )
        for q in snapshot.get("quotes") or []
        if isinstance(q.get("price_p10"), int | float) and q["price_p10"] > 0
    }
    product_expiry = {
        r["product"]: r["expiry_date"]
        for r in snapshot.get("references") or []
        if r.get("available") and r.get("expiry_date")
    }
    pairs = {
        p["pair"]: (p["expiry"], p.get("z"))
        for p in snapshot.get("pairs") or []
        if p.get("pair") in PAIRS and p.get("expiry")
    }
    state = snapshot.get("state")
    today = now.astimezone(IST).date().isoformat()
    updated = snapshot.get("updated_at")
    fresh = False
    if updated:
        try:
            age = (now - datetime.fromisoformat(updated)).total_seconds()
            fresh = age <= max(3 * settings.live_poll_seconds, 120)
        except ValueError:
            fresh = False
    if state in {"not_configured", "disabled"}:
        reason = "Live prices are off, so practice trading is unavailable."
    elif state != "live" or snapshot.get("trade_date") != today:
        reason = (
            "MCX is closed. Practice trades fill at live prices during the "
            f"session ({settings.live_session_start}–{settings.live_session_end} "
            "IST, Mon–Fri)."
        )
    elif not fresh:
        reason = "Live prices are delayed. Try again in a moment."
    else:
        reason = ""
    return Market(
        can_trade=not reason,
        reason=reason,
        trade_date=snapshot.get("trade_date"),
        updated_at=updated,
        quotes=quotes,
        product_expiry=product_expiry,
        pairs=pairs,
    )


def live_market(settings: Settings) -> Market:
    from app.data.live import service

    return market_from_snapshot(service.snapshot(settings), settings)


MarketSource = Callable[[Settings], Market]


def get_market_source() -> MarketSource:
    """Dependency so tests can supply prices without Upstox."""
    return live_market


def settlement_price(settings: Settings, product: str, expiry: str) -> float | None:
    """Latest stored close (₹ per 10 g) for one contract, if any."""
    url = make_url(settings.database_url)
    if not url.database or url.database == ":memory:":
        return None
    engine = create_loader_engine(settings)
    try:
        with engine.connect() as connection:
            if not inspect(connection).has_table(bhav.name):
                return None
            target = date.fromisoformat(expiry)
            latest = connection.scalar(
                select(func.max(bhav.c.trade_date)).where(
                    bhav.c.symbol == product, bhav.c.expiry_date == target
                )
            )
            if latest is None:
                return None
            close = connection.scalar(
                select(bhav.c.close).where(
                    bhav.c.symbol == product,
                    bhav.c.expiry_date == target,
                    bhav.c.trade_date == latest,
                )
            )
    except (SQLAlchemyError, ValueError):
        return None
    finally:
        engine.dispose()
    if close is None or not close > 0:
        return None
    return float(close) * settings.base_grams / settings.quote_grams[product]


# --------------------------------------------------------------------------- #
# Maths (paise)
# --------------------------------------------------------------------------- #


def lot_step(settings: Settings, kind: str, instrument: str) -> int:
    if kind == "product":
        return settings.lot_grams[instrument]
    a, b = instrument.split("-")
    return math.lcm(settings.lot_grams[a], settings.lot_grams[b])


def notional_paise(grams: int, price_p10: float) -> int:
    return int(round(grams * price_p10 / 10 * 100))


def cost_paise(settings: Settings, grams: int, *prices: float) -> int:
    return sum(
        int(round(notional_paise(grams, price) * settings.practice_cost_bps / 10_000))
        for price in prices
    )


def margin_for(settings: Settings, grams: int, *prices: float) -> int:
    gross = sum(notional_paise(grams, price) for price in prices)
    return int(round(gross * settings.practice_margin_pct / 100))


def gross_paise(row, exit_a: float, exit_b: float | None) -> int:
    """P&L before costs. Pair sides: 'rise' = buy A / sell B (gap A−B up)."""
    grams = row["grams"]
    move_a = notional_paise(grams, exit_a) - notional_paise(grams, row["entry_a"])
    if row["kind"] == "product":
        return move_a if row["side"] == "buy" else -move_a
    move_b = notional_paise(grams, exit_b) - notional_paise(grams, row["entry_b"])
    spread = move_a - move_b
    return spread if row["side"] == "rise" else -spread


def _legs(row) -> tuple[str, str | None]:
    if row["kind"] == "product":
        return row["instrument"], None
    a, b = row["instrument"].split("-")
    return a, b


def _mark(row, market: Market, settings: Settings) -> tuple[float, float | None, str]:
    """Current prices for an open position and where they came from."""
    a, b = _legs(row)
    sources = []
    prices = []
    for leg, entry in ((a, row["entry_a"]), (b, row["entry_b"])):
        if leg is None:
            prices.append(None)
            continue
        quote = market.quotes.get((leg, row["expiry"]))
        if quote is not None:
            prices.append(quote[0])
            sources.append("live")
            continue
        settled = settlement_price(settings, leg, row["expiry"])
        if settled is not None:
            prices.append(settled)
            sources.append("settlement")
        else:
            prices.append(entry)
            sources.append("entry")
    source = "live" if all(s == "live" for s in sources) else sources[-1]
    return prices[0], prices[1], source


# --------------------------------------------------------------------------- #
# Requests
# --------------------------------------------------------------------------- #


class OrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[A-Za-z0-9-]{8,64}$")
    kind: str
    instrument: str
    side: str
    grams: int = Field(gt=0, le=MAX_GRAMS, strict=True)

    @field_validator("kind")
    @classmethod
    def check_kind(cls, value):
        if value not in {"product", "pair"}:
            raise ValueError("Unsupported kind")
        return value


class ProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    leaderboard: bool
    display_name: str | None = Field(default=None, max_length=24)

    @field_validator("display_name")
    @classmethod
    def check_name(cls, value):
        if value is None or value == "":
            return None
        value = value.strip()
        if not NAME.fullmatch(value):
            raise ValueError("Invalid display name")
        return value


class ResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: bool

    @field_validator("confirm")
    @classmethod
    def must_confirm(cls, value):
        if value is not True:
            raise ValueError("Confirmation required")
        return value


# --------------------------------------------------------------------------- #
# Summary
# --------------------------------------------------------------------------- #


def _position_view(row, market: Market, settings: Settings) -> dict:
    base = dict(
        id=row["id"],
        kind=row["kind"],
        instrument=row["instrument"],
        expiry=row["expiry"],
        side=row["side"],
        grams=row["grams"],
        entry_a=row["entry_a"],
        entry_b=row["entry_b"],
        entry_z=row["entry_z"],
        entry_cost=row["entry_cost_paise"] / 100,
        margin=row["margin_paise"] / 100,
        opened_at=row["opened_at"],
        status=row["status"],
    )
    if row["status"] == "open":
        exit_a, exit_b, source = _mark(row, market, settings)
        gross = gross_paise(row, exit_a, exit_b)
        estimated_exit = cost_paise(
            settings, row["grams"], *(p for p in (exit_a, exit_b) if p is not None)
        )
        base.update(
            mark_a=exit_a,
            mark_b=exit_b,
            mark_source=source,
            open_pnl=gross / 100,
            # What closing now would book, after both legs' entry and exit costs.
            net_if_closed=(gross - row["entry_cost_paise"] - estimated_exit) / 100,
        )
    else:
        base.update(
            exit_a=row["exit_a"],
            exit_b=row["exit_b"],
            exit_cost=(row["exit_cost_paise"] or 0) / 100,
            gross=(row["gross_paise"] or 0) / 100,
            net=(row["net_paise"] or 0) / 100,
            closed_at=row["closed_at"],
            close_reason=row["close_reason"],
        )
    return base


def _instruments(market: Market, settings: Settings) -> dict:
    products = []
    for product in PRODUCTS:
        expiry = market.product_expiry.get(product)
        quote = market.quotes.get((product, expiry)) if expiry else None
        products.append(
            dict(
                product=product,
                expiry=expiry,
                lot=lot_step(settings, "product", product),
                price=quote[0] if quote else None,
                tradable=bool(quote and quote[1]),
            )
        )
    pairs = []
    for pair in PAIRS:
        a, b = pair.split("-")
        expiry, z = market.pairs.get(pair, (None, None))
        qa = market.quotes.get((a, expiry)) if expiry else None
        qb = market.quotes.get((b, expiry)) if expiry else None
        pairs.append(
            dict(
                pair=pair,
                expiry=expiry,
                lot=lot_step(settings, "pair", pair),
                price_a=qa[0] if qa else None,
                price_b=qb[0] if qb else None,
                gap=(qa[0] - qb[0]) if qa and qb else None,
                z=z,
                # Expect an unusual gap to move back toward its usual level.
                suggested=("fall" if z > 0 else "rise")
                if isinstance(z, int | float)
                else None,
                tradable=bool(qa and qb and qa[1] and qb[1]),
            )
        )
    return dict(products=products, pairs=pairs)


def _settle_expired(db, user_id: int, settings: Settings) -> None:
    """Close positions whose contract has expired at its last stored price."""
    today = datetime.now(IST).date().isoformat()
    rows = db.execute(
        "SELECT * FROM positions WHERE user_id=? AND status='open' AND expiry<?",
        (user_id, today),
    ).fetchall()
    for row in rows:
        a, b = _legs(row)
        exit_a = settlement_price(settings, a, row["expiry"]) or row["entry_a"]
        exit_b = (
            (settlement_price(settings, b, row["expiry"]) or row["entry_b"])
            if b
            else None
        )
        _book_close(db, row, exit_a, exit_b, settings, reason="expired")


def _book_close(db, row, exit_a, exit_b, settings, reason: str) -> dict:
    exit_cost = cost_paise(
        settings, row["grams"], *(p for p in (exit_a, exit_b) if p is not None)
    )
    gross = gross_paise(row, exit_a, exit_b)
    net = gross - row["entry_cost_paise"] - exit_cost
    now = _now()
    updated = db.execute(
        "UPDATE positions SET status='closed',exit_a=?,exit_b=?,exit_cost_paise=?,"
        "gross_paise=?,net_paise=?,closed_at=?,close_reason=? "
        "WHERE id=? AND status='open'",
        (exit_a, exit_b, exit_cost, gross, net, now, reason, row["id"]),
    )
    if updated.rowcount != 1:
        raise HTTPException(409, "This trade is already closed.")
    change = gross - exit_cost
    db.execute(
        "UPDATE wallets SET balance_paise=balance_paise+? WHERE user_id=?",
        (change, row["user_id"]),
    )
    balance = db.execute(
        "SELECT balance_paise FROM wallets WHERE user_id=?", (row["user_id"],)
    ).fetchone()[0]
    db.execute(
        "INSERT INTO ledger (user_id,kind,amount_paise,balance_after_paise,"
        "position_id,at) VALUES (?,?,?,?,?,?)",
        (row["user_id"], "close", change, balance, row["id"], now),
    )
    if net > 0:
        _award(db, row["user_id"], "first_profit")
    closed = db.execute(
        "SELECT COUNT(*) FROM positions WHERE user_id=? AND status='closed'",
        (row["user_id"],),
    ).fetchone()[0]
    if closed >= 10:
        _award(db, row["user_id"], "ten_trades")
    return dict(net=net / 100, gross=gross / 100, exit_cost=exit_cost / 100)


def _equity(db, user_id, wallet, market, settings) -> tuple[int, int, int]:
    """(open P&L, margin in use, equity) in paise."""
    open_pnl = 0
    margin = 0
    for row in db.execute(
        "SELECT * FROM positions WHERE user_id=? AND status='open'", (user_id,)
    ).fetchall():
        exit_a, exit_b, _ = _mark(row, market, settings)
        open_pnl += gross_paise(row, exit_a, exit_b)
        margin += row["margin_paise"]
    return open_pnl, margin, wallet["balance_paise"] + open_pnl


def summary(db, user: dict, market: Market, settings: Settings) -> dict:
    user_id = user["id"]
    wallet = _wallet(db, user_id, settings)
    _settle_expired(db, user_id, settings)
    wallet = _wallet(db, user_id, settings)
    open_pnl, margin, equity = _equity(db, user_id, wallet, market, settings)
    open_rows = db.execute(
        "SELECT * FROM positions WHERE user_id=? AND status='open' ORDER BY id DESC",
        (user_id,),
    ).fetchall()
    closed_rows = db.execute(
        "SELECT * FROM positions WHERE user_id=? AND status='closed' "
        "ORDER BY closed_at DESC, id DESC LIMIT ?",
        (user_id, HISTORY_LIMIT),
    ).fetchall()
    stats = db.execute(
        "SELECT COUNT(*) n, COALESCE(SUM(net_paise),0) total, "
        "COALESCE(SUM(net_paise>0),0) wins, MAX(net_paise) best, MIN(net_paise) worst "
        "FROM positions WHERE user_id=? AND status='closed'",
        (user_id,),
    ).fetchone()
    week_start = (datetime.now(UTC) - timedelta(days=7)).isoformat()
    week = db.execute(
        "SELECT COUNT(*) n, COALESCE(SUM(net_paise),0) total, "
        "COALESCE(SUM(net_paise>0),0) wins "
        "FROM positions WHERE user_id=? AND status='closed' AND closed_at>=?",
        (user_id, week_start),
    ).fetchone()
    earned = {
        row["code"]: row["earned_at"]
        for row in db.execute(
            "SELECT code, earned_at FROM achievements WHERE user_id=?", (user_id,)
        )
    }
    start = wallet["start_paise"]
    return dict(
        currency=CURRENCY,
        start_balance=start / 100,
        balance=wallet["balance_paise"] / 100,
        open_pnl=open_pnl / 100,
        margin_in_use=margin / 100,
        equity=equity / 100,
        available=(equity - margin) / 100,
        return_pct=(equity - start) / start * 100 if start else 0.0,
        resets=wallet["resets"],
        market=dict(
            can_trade=market.can_trade,
            reason=market.reason,
            trade_date=market.trade_date,
            updated_at=market.updated_at,
        ),
        limits=dict(
            max_grams=MAX_GRAMS,
            max_open=MAX_OPEN,
            margin_pct=settings.practice_margin_pct,
            cost_bps=settings.practice_cost_bps,
        ),
        instruments=_instruments(market, settings),
        positions=[_position_view(r, market, settings) for r in open_rows],
        history=[_position_view(r, market, settings) for r in closed_rows],
        stats=dict(
            trades=stats["n"],
            wins=stats["wins"],
            win_rate=(stats["wins"] / stats["n"] * 100) if stats["n"] else None,
            realized=stats["total"] / 100,
            best=(stats["best"] / 100) if stats["best"] is not None else None,
            worst=(stats["worst"] / 100) if stats["worst"] is not None else None,
        ),
        week=dict(
            trades=week["n"],
            wins=week["wins"],
            realized=week["total"] / 100,
        ),
        achievements=[
            dict(code=code, title=title, description=text, earned_at=earned.get(code))
            for code, (title, text) in ACHIEVEMENTS.items()
        ],
        profile=dict(
            display_name=wallet["display_name"],
            leaderboard=bool(wallet["leaderboard"]),
        ),
    )


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #


@router.get("")
def practice_summary(
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
    source: MarketSource = Depends(get_market_source),
):
    market = source(settings)
    with database(settings) as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            result = summary(db, user, market, settings)
            db.execute("COMMIT")
        except BaseException:
            db.execute("ROLLBACK")
            raise
    return result


@router.post("/orders", status_code=201)
def place_order(
    body: OrderRequest,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
    source: MarketSource = Depends(get_market_source),
):
    if body.kind == "product":
        if body.instrument not in PRODUCTS:
            raise HTTPException(422, "Choose one of the four gold products.")
        if body.side not in {"buy", "sell"}:
            raise HTTPException(422, "Product trades are buy or sell.")
    else:
        if body.instrument not in PAIRS:
            raise HTTPException(
                422,
                "Pair practice covers same-expiry pairs only; trade GOLDM on its own.",
            )
        if body.side not in {"rise", "fall"}:
            raise HTTPException(422, "Pair trades bet that the gap will rise or fall.")
    step = lot_step(settings, body.kind, body.instrument)
    if body.grams % step:
        raise HTTPException(422, f"Use a multiple of {step} g for this trade.")
    market = source(settings)
    if not market.can_trade:
        raise HTTPException(409, market.reason)
    if body.kind == "product":
        expiry = market.product_expiry.get(body.instrument)
        legs = [body.instrument]
        z = None
    else:
        expiry, z = market.pairs.get(body.instrument, (None, None))
        legs = body.instrument.split("-")
    quotes = [market.quotes.get((leg, expiry)) if expiry else None for leg in legs]
    if any(quote is None for quote in quotes):
        raise HTTPException(409, "No live price for this contract right now.")
    if not all(quote[1] for quote in quotes):
        raise HTTPException(
            409, "A contract in this trade has not traded today, so its price is stale."
        )
    prices = [quote[0] for quote in quotes]
    entry_cost = cost_paise(settings, body.grams, *prices)
    margin = margin_for(settings, body.grams, *prices)

    with database(settings) as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            existing = db.execute(
                "SELECT * FROM positions WHERE user_id=? AND request_id=?",
                (user["id"], body.request_id),
            ).fetchone()
            if existing is not None:
                # Same request sent twice (double-click, retry): no second trade.
                db.execute("COMMIT")
                return _position_view(existing, market, settings)
            wallet = _wallet(db, user["id"], settings)
            _settle_expired(db, user["id"], settings)
            wallet = _wallet(db, user["id"], settings)
            open_count = db.execute(
                "SELECT COUNT(*) FROM positions WHERE user_id=? AND status='open'",
                (user["id"],),
            ).fetchone()[0]
            if open_count >= MAX_OPEN:
                raise HTTPException(
                    409, f"You can hold up to {MAX_OPEN} practice trades at once."
                )
            _, used, equity = _equity(db, user["id"], wallet, market, settings)
            if equity - used < margin + entry_cost:
                raise HTTPException(
                    409,
                    "Not enough demo money available for this size. Reduce the "
                    "grams or close a trade.",
                )
            now = _now()
            cursor = db.execute(
                "INSERT INTO positions (user_id,request_id,kind,instrument,expiry,side,"
                "grams,entry_a,entry_b,entry_z,entry_cost_paise,margin_paise,"
                "opened_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'open')",
                (
                    user["id"],
                    body.request_id,
                    body.kind,
                    body.instrument,
                    expiry,
                    body.side,
                    body.grams,
                    prices[0],
                    prices[1] if len(prices) > 1 else None,
                    z if isinstance(z, int | float) else None,
                    entry_cost,
                    margin,
                    now,
                ),
            )
            db.execute(
                "UPDATE wallets SET balance_paise=balance_paise-? WHERE user_id=?",
                (entry_cost, user["id"]),
            )
            balance = db.execute(
                "SELECT balance_paise FROM wallets WHERE user_id=?", (user["id"],)
            ).fetchone()[0]
            db.execute(
                "INSERT INTO ledger (user_id,kind,amount_paise,balance_after_paise,"
                "position_id,at) VALUES (?,?,?,?,?,?)",
                (user["id"], "open_cost", -entry_cost, balance, cursor.lastrowid, now),
            )
            _award(db, user["id"], "first_trade")
            if body.kind == "pair":
                _award(db, user["id"], "pair_trader")
                if isinstance(z, int | float) and abs(z) >= 2:
                    _award(db, user["id"], "unusual_gap")
            row = db.execute(
                "SELECT * FROM positions WHERE id=?", (cursor.lastrowid,)
            ).fetchone()
            db.execute("COMMIT")
        except BaseException:
            db.execute("ROLLBACK")
            raise
    return _position_view(row, market, settings)


@router.post("/positions/{position_id}/close")
def close_position(
    position_id: int,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
    source: MarketSource = Depends(get_market_source),
):
    market = source(settings)
    if not market.can_trade:
        raise HTTPException(409, market.reason)
    with database(settings) as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            row = db.execute(
                "SELECT * FROM positions WHERE id=? AND user_id=?",
                (position_id, user["id"]),
            ).fetchone()
            if row is None:
                raise HTTPException(404, "Trade not found.")
            if row["status"] != "open":
                raise HTTPException(409, "This trade is already closed.")
            a, b = _legs(row)
            quotes = [market.quotes.get((leg, row["expiry"])) for leg in (a, b) if leg]
            if any(quote is None for quote in quotes):
                raise HTTPException(409, "No live price for this contract right now.")
            prices = [quote[0] for quote in quotes]
            result = _book_close(
                db,
                row,
                prices[0],
                prices[1] if len(prices) > 1 else None,
                settings,
                reason="manual",
            )
            db.execute("COMMIT")
        except BaseException:
            db.execute("ROLLBACK")
            raise
    return dict(id=position_id, **result)


@router.post("/reset")
def reset_wallet(
    body: ResetRequest,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    with database(settings) as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            _wallet(db, user["id"], settings)
            start = int(round(settings.practice_start_balance * 100))
            now = _now()
            db.execute("DELETE FROM positions WHERE user_id=?", (user["id"],))
            db.execute("DELETE FROM ledger WHERE user_id=?", (user["id"],))
            db.execute(
                "UPDATE wallets SET balance_paise=?,start_paise=?,reset_at=?,"
                "resets=resets+1 WHERE user_id=?",
                (start, start, now, user["id"]),
            )
            db.execute(
                "INSERT INTO ledger (user_id,kind,amount_paise,balance_after_paise,at) "
                "VALUES (?,?,?,?,?)",
                (user["id"], "reset", start, start, now),
            )
            db.execute("COMMIT")
        except BaseException:
            db.execute("ROLLBACK")
            raise
    return dict(balance=start / 100)


@router.put("/profile")
def update_profile(
    body: ProfileRequest,
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    if body.leaderboard and not body.display_name:
        raise HTTPException(422, "Choose a display name to join the leaderboard.")
    with database(settings) as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            _wallet(db, user["id"], settings)
            if body.display_name:
                taken = db.execute(
                    "SELECT 1 FROM wallets WHERE lower(display_name)=lower(?) "
                    "AND user_id<>?",
                    (body.display_name, user["id"]),
                ).fetchone()
                if taken:
                    raise HTTPException(409, "That display name is taken.")
            db.execute(
                "UPDATE wallets SET display_name=?,leaderboard=? WHERE user_id=?",
                (body.display_name, int(body.leaderboard), user["id"]),
            )
            db.execute("COMMIT")
        except BaseException:
            db.execute("ROLLBACK")
            raise
    return dict(display_name=body.display_name, leaderboard=body.leaderboard)


@router.get("/leaderboard")
def leaderboard(
    user: dict = Depends(current_user),
    settings: Settings = Depends(get_settings),
    source: MarketSource = Depends(get_market_source),
):
    """Opted-in players by return on demo money (display names only)."""
    market = source(settings)
    entries = []
    with database(settings) as db:
        players = db.execute(
            "SELECT * FROM wallets WHERE leaderboard=1 AND display_name IS NOT NULL"
        ).fetchall()
        for wallet in players:
            closed = db.execute(
                "SELECT COUNT(*) FROM positions WHERE user_id=? AND status='closed'",
                (wallet["user_id"],),
            ).fetchone()[0]
            if not closed:
                continue
            _, _, equity = _equity(db, wallet["user_id"], wallet, market, settings)
            start = wallet["start_paise"]
            entries.append(
                dict(
                    name=wallet["display_name"],
                    return_pct=(equity - start) / start * 100 if start else 0.0,
                    trades=closed,
                    you=wallet["user_id"] == user["id"],
                )
            )
    entries.sort(key=lambda item: item["return_pct"], reverse=True)
    for rank, entry in enumerate(entries, start=1):
        entry["rank"] = rank
    mine = next((entry for entry in entries if entry["you"]), None)
    top = entries[:20]
    return dict(entries=top, you=mine if mine and mine not in top else None)
