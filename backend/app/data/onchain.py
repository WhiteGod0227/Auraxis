"""On-chain gold: tokenized gold (PAXG, XAUT) compared with MCX gold.

Read-only Web3 data, refreshed in the background:

* Token prices in INR and USD (CoinGecko public API), every
  ``ONCHAIN_POLL_SECONDS``. Tokenized gold trades around the clock.
* Circulating supply read directly from Ethereum mainnet: ERC-20
  ``totalSupply()`` and ``decimals()`` over JSON-RPC (``ONCHAIN_RPC_URL``).
* A year of daily token prices, so gap history is available immediately.

Each token represents one fine troy ounce of gold. Indian parity per 10 g is
``price_inr / 31.1034768 * 10 * (1 + import duty)``, using the duty that was in
force on that date. Nothing is written to any blockchain and no wallet or key
is involved.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from math import isfinite
from pathlib import Path

import httpx
from fastapi import HTTPException

from app.core.config import BACKEND_DIR, Settings

logger = logging.getLogger(__name__)

TROY_OUNCE_GRAMS = 31.1034768


@dataclass(frozen=True)
class Token:
    symbol: str
    name: str
    issuer: str
    coingecko_id: str
    contract: str  # Ethereum mainnet ERC-20 address (verified against issuers)


TOKENS = (
    Token(
        "PAXG",
        "PAX Gold",
        "Paxos",
        "pax-gold",
        "0x45804880De22913dAFE09f4980848ECE6EcbAf78",
    ),
    Token(
        "XAUT",
        "Tether Gold",
        "Tether",
        "tether-gold",
        "0x68749665FF8D2d112Fa859AA293F07A622782F38",
    ),
)
TOTAL_SUPPLY = "0x18160ddd"  # keccak("totalSupply()")[:4]
DECIMALS = "0x313ce567"  # keccak("decimals()")[:4]
SUPPLY_SECONDS = 600
SNAPSHOT_SECONDS = 600
DAILY_REFRESH_SECONDS = 6 * 3600


class OnchainError(RuntimeError):
    """A safe, user-presentable data-source failure."""


# --------------------------------------------------------------------------- #
# Maths
# --------------------------------------------------------------------------- #


def duty_on(settings: Settings, day: date) -> float:
    """Import duty (%) in force on ``day`` from the configured schedule."""
    rate = 0.0
    for start, pct in sorted(settings.onchain_duty_schedule.items()):
        if date.fromisoformat(start) <= day:
            rate = pct
    return rate


def parity_p10(price_inr_per_ounce: float, duty_pct: float) -> float:
    """INR per 10 g of gold landed in India, including import duty."""
    return price_inr_per_ounce / TROY_OUNCE_GRAMS * 10 * (1 + duty_pct / 100)


def decode_uint(result: str) -> int:
    if not isinstance(result, str) or not result.startswith("0x"):
        raise OnchainError("Unexpected response from the Ethereum node.")
    payload = result[2:]
    if not payload:
        raise OnchainError("Empty response from the Ethereum node.")
    try:
        return int(payload, 16)
    except ValueError as exc:
        raise OnchainError("Unreadable response from the Ethereum node.") from exc


# --------------------------------------------------------------------------- #
# Sources
# --------------------------------------------------------------------------- #


def _client(settings: Settings) -> httpx.Client:
    return httpx.Client(
        timeout=15,
        headers={"Accept": "application/json", "User-Agent": "auraxis-research"},
        follow_redirects=True,
    )


def _get(client: httpx.Client, url: str, params: dict) -> dict | list:
    try:
        response = client.get(url, params=params)
    except httpx.HTTPError as exc:
        raise OnchainError("Token price source is unreachable.") from exc
    if response.status_code == 429:
        raise OnchainError("Token price source is rate-limiting; retrying later.")
    if response.status_code >= 400:
        raise OnchainError(f"Token price source failed (HTTP {response.status_code}).")
    try:
        return response.json()
    except ValueError as exc:
        raise OnchainError("Token price source returned invalid data.") from exc


def fetch_prices(client: httpx.Client, settings: Settings) -> dict[str, dict]:
    base = settings.onchain_price_api.rstrip("/")
    payload = _get(
        client,
        f"{base}/simple/price",
        {
            "ids": ",".join(token.coingecko_id for token in TOKENS),
            "vs_currencies": "inr,usd",
            "include_last_updated_at": "true",
        },
    )
    prices = {}
    for token in TOKENS:
        item = payload.get(token.coingecko_id) if isinstance(payload, dict) else None
        if not isinstance(item, dict):
            continue
        inr, usd = item.get("inr"), item.get("usd")
        if not all(
            isinstance(v, int | float) and isfinite(v) and v > 0 for v in (inr, usd)
        ):
            continue
        stamp = item.get("last_updated_at")
        prices[token.symbol] = dict(
            inr=float(inr),
            usd=float(usd),
            updated_at=(
                datetime.fromtimestamp(stamp, UTC).isoformat()
                if isinstance(stamp, int | float)
                else None
            ),
        )
    if not prices:
        raise OnchainError("No tokenized-gold prices were returned.")
    return prices


def fetch_daily(
    client: httpx.Client, settings: Settings, token: Token, days: int = 365
) -> list[tuple[date, float]]:
    """Daily INR closes for one token (UTC days)."""
    base = settings.onchain_price_api.rstrip("/")
    payload = _get(
        client,
        f"{base}/coins/{token.coingecko_id}/market_chart",
        {"vs_currency": "inr", "days": str(days), "interval": "daily"},
    )
    rows: dict[date, float] = {}
    for point in (
        (payload or {}).get("prices") or [] if isinstance(payload, dict) else []
    ):
        if not isinstance(point, list | tuple) or len(point) < 2:
            continue
        stamp, price = point[0], point[1]
        if not isinstance(stamp, int | float) or not isinstance(price, int | float):
            continue
        if not isfinite(price) or price <= 0:
            continue
        rows[datetime.fromtimestamp(stamp / 1000, UTC).date()] = float(price)
    return sorted(rows.items())


def rpc_call(client: httpx.Client, settings: Settings, to: str, data: str) -> str:
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [{"to": to, "data": data}, "latest"],
    }
    try:
        response = client.post(settings.onchain_rpc_url, json=body)
    except httpx.HTTPError as exc:
        raise OnchainError("Ethereum node is unreachable.") from exc
    if response.status_code >= 400:
        raise OnchainError(f"Ethereum node failed (HTTP {response.status_code}).")
    try:
        payload = response.json()
    except ValueError as exc:
        raise OnchainError("Ethereum node returned invalid data.") from exc
    if not isinstance(payload, dict) or "result" not in payload:
        raise OnchainError("Ethereum node returned an error.")
    return payload["result"]


def fetch_supply(
    client: httpx.Client, settings: Settings, token: Token, decimals: int | None
) -> tuple[float, int]:
    """(circulating tokens, decimals) read from the ERC-20 contract."""
    if decimals is None:
        decimals = decode_uint(rpc_call(client, settings, token.contract, DECIMALS))
        if not 0 <= decimals <= 36:
            raise OnchainError("Unexpected token decimals.")
    raw = decode_uint(rpc_call(client, settings, token.contract, TOTAL_SUPPLY))
    return raw / 10**decimals, decimals


# --------------------------------------------------------------------------- #
# Storage
# --------------------------------------------------------------------------- #


@contextmanager
def database(settings: Settings):
    path = Path(settings.onchain_database_path)
    path = path if path.is_absolute() else BACKEND_DIR / path
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS token_daily (
                symbol TEXT NOT NULL,
                day TEXT NOT NULL,
                inr REAL NOT NULL,
                PRIMARY KEY (symbol, day)
            );
            CREATE TABLE IF NOT EXISTS token_snapshots (
                at TEXT NOT NULL,
                symbol TEXT NOT NULL,
                inr REAL NOT NULL,
                usd REAL NOT NULL,
                supply REAL,
                PRIMARY KEY (at, symbol)
            );
            """
        )
        with db:
            yield db
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# Service
# --------------------------------------------------------------------------- #


def _due(last: float | None, now: float, every: float) -> bool:
    return last is None or now - last >= every


class OnchainService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._prices: dict[str, dict] = {}
        self._supply: dict[str, dict] = {}
        self._decimals: dict[str, int] = {}
        self._status = dict(price_error="", supply_error="", updated_at=None)
        # None = never run, so the first tick always does everything.
        self._last_supply: float | None = None
        self._last_snapshot: float | None = None
        self._last_daily: float | None = None

    def state(self) -> dict:
        with self._lock:
            return dict(
                prices=json.loads(json.dumps(self._prices)),
                supply=json.loads(json.dumps(self._supply)),
                **self._status,
            )

    def poll_prices(self, settings: Settings, client: httpx.Client) -> None:
        try:
            prices = fetch_prices(client, settings)
        except OnchainError as exc:
            with self._lock:
                self._status["price_error"] = str(exc)
            raise
        now = datetime.now(UTC).isoformat()
        with self._lock:
            self._prices = prices
            self._status.update(price_error="", updated_at=now)

    def poll_supply(self, settings: Settings, client: httpx.Client) -> None:
        supply = {}
        errors = []
        for token in TOKENS:
            try:
                amount, decimals = fetch_supply(
                    client, settings, token, self._decimals.get(token.symbol)
                )
            except OnchainError as exc:
                errors.append(f"{token.symbol}: {exc}")
                continue
            self._decimals[token.symbol] = decimals
            supply[token.symbol] = dict(
                tokens=amount,
                tonnes=amount * TROY_OUNCE_GRAMS / 1_000_000,
                decimals=decimals,
                read_at=datetime.now(UTC).isoformat(),
            )
        with self._lock:
            self._supply.update(supply)
            self._status["supply_error"] = "; ".join(errors)

    def refresh_daily(self, settings: Settings, client: httpx.Client) -> int:
        stored = 0
        for token in TOKENS:
            rows = fetch_daily(client, settings, token)
            with database(settings) as db:
                db.executemany(
                    "INSERT INTO token_daily VALUES (?,?,?) "
                    "ON CONFLICT(symbol, day) DO UPDATE SET inr=excluded.inr",
                    [(token.symbol, day.isoformat(), inr) for day, inr in rows],
                )
            stored += len(rows)
        return stored

    def save_snapshot(self, settings: Settings) -> None:
        state = self.state()
        now = datetime.now(UTC).replace(second=0, microsecond=0).isoformat()
        with database(settings) as db:
            for symbol, price in state["prices"].items():
                db.execute(
                    "INSERT OR REPLACE INTO token_snapshots VALUES (?,?,?,?,?)",
                    (
                        now,
                        symbol,
                        price["inr"],
                        price["usd"],
                        (state["supply"].get(symbol) or {}).get("tokens"),
                    ),
                )

    def tick(self, settings: Settings, client: httpx.Client) -> None:
        """One polling step (blocking); each part fails independently."""
        monotonic = time.monotonic()
        try:
            self.poll_prices(settings, client)
        except OnchainError as exc:
            logger.warning("On-chain prices: %s", exc)
        if _due(self._last_supply, monotonic, SUPPLY_SECONDS) or not self._supply:
            self.poll_supply(settings, client)
            self._last_supply = monotonic
        if _due(self._last_daily, monotonic, DAILY_REFRESH_SECONDS):
            try:
                count = self.refresh_daily(settings, client)
                logger.info("On-chain daily history: %s rows", count)
                self._last_daily = monotonic
            except OnchainError as exc:
                logger.warning("On-chain daily history: %s", exc)
        if self._prices and _due(self._last_snapshot, monotonic, SNAPSHOT_SECONDS):
            self.save_snapshot(settings)
            self._last_snapshot = monotonic

    async def run(self, settings: Settings) -> None:
        client = _client(settings)
        try:
            while True:
                try:
                    await asyncio.to_thread(self.tick, settings, client)
                except Exception:  # pragma: no cover - keep the loop alive
                    logger.exception("On-chain poll crashed")
                await asyncio.sleep(settings.onchain_poll_seconds)
        finally:
            client.close()


service = OnchainService()


def require_enabled(settings: Settings) -> None:
    if not settings.onchain_enabled:
        raise HTTPException(404, "On-chain data is turned off on this server.")


def history_since(days: int) -> date:
    return datetime.now(UTC).date() - timedelta(days=days)
