"""Live intraday MCX gold quotes from Upstox, polled during the MCX session.

One background task polls the Upstox full market-quote endpoint every
``LIVE_POLL_SECONDS`` while the market is open (one request covers every gold
contract), computes provisional analytics and keeps the latest snapshot in
memory. Browsers read that snapshot from ``GET /api/live``; they never call
Upstox, so the request count does not grow with the number of viewers.

Live prices are never written to the ``bhav`` table: settlement prices stay the
record. The last snapshot is saved to ``data_cache/upstox/live_snapshot.json``
so a restart outside market hours still shows the last traded prices.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from datetime import UTC, date, datetime, timedelta
from math import isfinite
from pathlib import Path

import httpx
import pandas as pd
from sqlalchemy import and_, func, inspect, select
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from app.analytics.live import (
    HISTORY_COLUMNS,
    HISTORY_DAYS,
    LiveQuote,
    compute_live,
    number,
)
from app.core.config import BACKEND_DIR, Settings
from app.data.loader import bhav, create_loader_engine
from app.data.upstox import (
    IST,
    Contract,
    UpstoxError,
    _as_int,
    _cache_dir,
    _client,
    _get_json,
    load_instruments,
)

logger = logging.getLogger(__name__)


class _QuietQuotePolls(logging.Filter):
    """Drop httpx's per-request INFO line for quote polls (thousands a day)."""

    def filter(self, record: logging.LogRecord) -> bool:
        return (
            record.levelno > logging.INFO
            or "/v2/market-quote/" not in record.getMessage()
        )


logging.getLogger("httpx").addFilter(_QuietQuotePolls())

# Upstox accepts up to 500 instrument keys per full-quote request.
QUOTE_BATCH = 100
CONTRACTS_CACHE_SECONDS = 3600
MAX_BACKOFF_SECONDS = 300
TOKEN_RETRY_SECONDS = 600
CLOSED_CHECK_SECONDS = 60
SNAPSHOT_FILE = "live_snapshot.json"
PROVISIONAL_NOTE = (
    "Live prices are last traded prices, not settlement prices. Gaps and "
    "rankings are provisional until the session's settlement is loaded."
)


# --------------------------------------------------------------------------- #
# Market hours
# --------------------------------------------------------------------------- #


def _clock(value: str) -> tuple[int, int]:
    hours, minutes = value.split(":")
    return int(hours), int(minutes)


def market_open(now: datetime, settings: Settings) -> bool:
    """True during the configured MCX session (IST, Monday to Friday)."""
    local = now.astimezone(IST)
    if local.weekday() >= 5:
        return False
    current = (local.hour, local.minute)
    return (
        _clock(settings.live_session_start)
        <= current
        < _clock(settings.live_session_end)
    )


def seconds_until_open(now: datetime, settings: Settings) -> float:
    """Seconds until the next session start (0 when already open)."""
    local = now.astimezone(IST)
    if market_open(local, settings):
        return 0.0
    hour, minute = _clock(settings.live_session_start)
    candidate = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= local:
        candidate += timedelta(days=1)
    while candidate.weekday() >= 5:
        candidate += timedelta(days=1)
    return max((candidate - local).total_seconds(), 0.0)


# --------------------------------------------------------------------------- #
# Upstox quotes
# --------------------------------------------------------------------------- #


def _epoch_ms(value) -> datetime | None:
    try:
        stamp = float(value)
    except (TypeError, ValueError):
        return None
    if not isfinite(stamp) or stamp <= 0:
        return None
    try:
        return datetime.fromtimestamp(stamp / 1000, IST)
    except (OverflowError, OSError, ValueError):
        return None


def parse_quotes(
    payload: dict, contracts: list[Contract], settings: Settings
) -> list[dict]:
    """Map a full market-quote response onto known contracts.

    Upstox keys the response by trading symbol (``MCX_FO:GOLDM26DECFUT``) and
    reports the requested key in ``instrument_token``.
    """
    by_key = {contract.key: contract for contract in contracts}
    data = payload.get("data") if isinstance(payload, dict) else None
    parsed = []
    for name, item in (data or {}).items() if isinstance(data, dict) else []:
        if not isinstance(item, dict):
            continue
        contract = by_key.get(str(item.get("instrument_token") or "")) or by_key.get(
            str(name).replace(":", "|", 1)
        )
        price = number(item.get("last_price"))
        if contract is None or price is None or price <= 0:
            continue
        lot_grams = settings.lot_grams[contract.symbol]
        volume, interest = _as_int(item.get("volume")), _as_int(item.get("oi"))
        if settings.upstox_volume_unit == "grams":
            volume_grams, oi_grams = volume, interest
            volume_lots, oi_lots = volume // lot_grams, interest // lot_grams
        else:
            volume_lots, oi_lots = volume, interest
            volume_grams, oi_grams = volume * lot_grams, interest * lot_grams
        change = number(item.get("net_change"))
        previous = price - change if change is not None else None
        parsed.append(
            dict(
                contract=contract,
                last_price=price,
                volume_lots=volume_lots,
                volume_grams=volume_grams,
                oi_lots=oi_lots,
                oi_grams=oi_grams,
                exchange_previous_close=(
                    previous if previous is not None and previous > 0 else None
                ),
                last_trade_at=_epoch_ms(item.get("last_trade_time")),
            )
        )
    return parsed


def fetch_quotes(
    client: httpx.Client, settings: Settings, contracts: list[Contract]
) -> list[dict]:
    base = settings.upstox_api_base.rstrip("/")
    quotes: list[dict] = []
    for start in range(0, len(contracts), QUOTE_BATCH):
        batch = contracts[start : start + QUOTE_BATCH]
        payload = _get_json(
            client,
            f"{base}/v2/market-quote/quotes",
            {"instrument_key": ",".join(contract.key for contract in batch)},
        )
        quotes += parse_quotes(payload, batch, settings)
    return quotes


def session_quotes(raw: list[dict], now: datetime) -> tuple[date | None, list]:
    """Pick the session the quotes belong to and flag today's trades.

    The session date is the latest IST last-trade date reported (capped at
    today), so a weekend restart shows Friday's prices dated Friday.
    """
    today = now.astimezone(IST).date()
    dates = [
        item["last_trade_at"].date()
        for item in raw
        if item["last_trade_at"] is not None and item["last_trade_at"].date() <= today
    ]
    live_date = max(dates) if dates else (today if raw else None)
    quotes = []
    for item in raw:
        contract = item["contract"]
        stamp = item["last_trade_at"]
        on_session = stamp.date() == live_date if stamp is not None else True
        quotes.append(
            LiveQuote(
                symbol=contract.symbol,
                expiry=contract.expiry,
                key=contract.key,
                last_price=item["last_price"],
                # Volume belongs to the contract's own last session, not this one.
                volume_lots=item["volume_lots"] if on_session else 0,
                volume_grams=item["volume_grams"] if on_session else 0,
                oi_lots=item["oi_lots"],
                oi_grams=item["oi_grams"],
                exchange_previous_close=item["exchange_previous_close"],
                last_trade_at=stamp,
                traded_today=on_session and item["volume_grams"] > 0,
            )
        )
    return live_date, quotes


# --------------------------------------------------------------------------- #
# Settlement history (read-only)
# --------------------------------------------------------------------------- #


def _database_exists(settings: Settings) -> bool:
    """Never create the market database just to read live history."""
    url = make_url(settings.database_url)
    if not url.database or url.database == ":memory:":
        return False
    path = Path(url.database)
    path = path if path.is_absolute() else BACKEND_DIR / path
    return path.exists()


def read_history(
    settings: Settings, live_date: date
) -> tuple[pd.DataFrame, date | None]:
    """Recent settlement rows and the latest stored trade date."""
    empty = pd.DataFrame(columns=HISTORY_COLUMNS)
    if not _database_exists(settings):
        return empty, None
    engine = create_loader_engine(settings)
    try:
        with engine.connect() as connection:
            if not inspect(connection).has_table(bhav.name):
                return empty, None
            latest = connection.scalar(select(func.max(bhav.c.trade_date)))
            frame = pd.read_sql(
                select(*[bhav.c[name] for name in HISTORY_COLUMNS])
                .where(
                    and_(
                        bhav.c.symbol.in_(settings.bhavcopy_symbols),
                        bhav.c.trade_date >= live_date - timedelta(days=HISTORY_DAYS),
                        bhav.c.trade_date < live_date,
                    )
                )
                .order_by(bhav.c.trade_date, bhav.c.expiry_date),
                connection,
            )
    except SQLAlchemyError:
        logger.warning("Live analytics: settlement history unavailable")
        return empty, None
    finally:
        engine.dispose()
    for column in ("trade_date", "expiry_date"):
        frame[column] = frame[column].map(
            lambda value: value.date() if isinstance(value, datetime) else value
        )
    return frame, latest


# --------------------------------------------------------------------------- #
# Service
# --------------------------------------------------------------------------- #


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class LiveService:
    """Holds the latest live snapshot and runs the polling loop."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data: dict | None = None
        self._status = dict(
            phase="starting", message="", last_attempt_at=None, next_poll_at=None
        )
        self._contracts: list[Contract] = []
        self._contracts_loaded = 0.0
        self._contracts_day: date | None = None
        self._client: httpx.Client | None = None
        self._running = False

    # ---- snapshot ------------------------------------------------------- #

    def snapshot(self, settings: Settings, now: datetime | None = None) -> dict:
        now = now or datetime.now(UTC)
        configured = bool(settings.upstox_access_token.strip())
        enabled = settings.live_poll_seconds > 0
        is_open = market_open(now, settings)
        with self._lock:
            data = dict(self._data) if self._data else None
            status = dict(self._status)
        today = now.astimezone(IST).date().isoformat()
        trade_date = data.get("trade_date") if data else None
        current = trade_date == today
        stored = data.get("stored_through") if data else None
        # A settlement can only exist once that session has closed.
        settled = bool(
            stored and trade_date and stored >= trade_date and not (is_open and current)
        )
        if data is not None:
            data["settled"] = settled
            data.pop("stored_through", None)
        if not configured:
            state, message = (
                "not_configured",
                "Set UPSTOX_ACCESS_TOKEN in backend/.env to enable live prices.",
            )
        elif not enabled:
            state, message = "disabled", "Live prices are off (LIVE_POLL_SECONDS=0)."
        elif status["phase"] == "error":
            state, message = "error", status["message"]
        elif data is None:
            state, message = "starting", "Fetching the first live quotes…"
        elif settled:
            state, message = (
                "settled",
                "This session's settlement prices are loaded; live prices "
                "resume with the next session's first trades.",
            )
        elif not is_open:
            state, message = "closed", "MCX is closed. Showing the last traded prices."
        elif not current:
            state, message = (
                "closed",
                "MCX is open; waiting for today's first trades. Showing the "
                "last traded prices.",
            )
        else:
            state, message = "live", ""
        return dict(
            state=state,
            message=message,
            market_open=is_open,
            poll_seconds=settings.live_poll_seconds,
            session=dict(
                start=settings.live_session_start,
                end=settings.live_session_end,
                timezone="Asia/Kolkata",
                weekdays="Mon-Fri",
            ),
            last_attempt_at=status["last_attempt_at"],
            next_poll_at=status["next_poll_at"] if configured and enabled else None,
            note=PROVISIONAL_NOTE,
            **(
                data
                or dict(
                    trade_date=None,
                    updated_at=None,
                    settled=False,
                    window=None,
                    references=[],
                    pairs=[],
                    quotes=[],
                )
            ),
        )

    def _set_status(self, **values) -> None:
        with self._lock:
            self._status.update(values)

    # ---- persistence ---------------------------------------------------- #

    def _snapshot_path(self, settings: Settings):
        return _cache_dir(settings) / SNAPSHOT_FILE

    def load_saved(self, settings: Settings) -> None:
        try:
            path = self._snapshot_path(settings)
            if not path.exists():
                return
            saved = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            logger.warning("Ignoring unreadable live snapshot file")
            return
        if isinstance(saved, dict) and isinstance(saved.get("pairs"), list):
            with self._lock:
                self._data = saved

    def _save(self, settings: Settings, data: dict) -> None:
        path = self._snapshot_path(settings)
        temporary = path.with_suffix(".tmp")
        try:
            temporary.write_text(json.dumps(data), encoding="utf-8")
            temporary.replace(path)
        except OSError:
            logger.warning("Could not save the live snapshot file")

    # ---- polling -------------------------------------------------------- #

    def _contracts_for(self, settings: Settings, today: date) -> list[Contract]:
        stale = (
            not self._contracts
            or self._contracts_day != today
            or time.monotonic() - self._contracts_loaded > CONTRACTS_CACHE_SECONDS
        )
        if stale:
            contracts = [
                contract
                for contract in load_instruments(self._http(settings), settings)
                if contract.expiry >= today
            ]
            if not contracts:
                raise UpstoxError("Upstox listed no active gold futures contracts.")
            self._contracts = contracts
            self._contracts_day = today
            self._contracts_loaded = time.monotonic()
        return self._contracts

    def _http(self, settings: Settings) -> httpx.Client:
        if self._client is None:
            self._client = _client(settings)
        return self._client

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def poll_once(
        self,
        settings: Settings,
        now: datetime | None = None,
        client: httpx.Client | None = None,
    ) -> dict:
        """Fetch quotes, compute analytics and store the snapshot (blocking)."""
        if client is not None:
            self._client = client
        now = now or datetime.now(UTC)
        today = now.astimezone(IST).date()
        self._set_status(last_attempt_at=now.isoformat())
        contracts = self._contracts_for(settings, today)
        raw = fetch_quotes(self._http(settings), settings, contracts)
        live_date, quotes = session_quotes(raw, now)
        if live_date is None or not quotes:
            raise UpstoxError("Upstox returned no prices for the gold contracts.")
        history, latest_stored = read_history(settings, live_date)
        analytics = compute_live(quotes, live_date, history, settings)
        data = dict(
            trade_date=live_date.isoformat(),
            updated_at=now.isoformat(),
            stored_through=latest_stored.isoformat() if latest_stored else None,
            **analytics,
            quotes=[
                dict(
                    product=quote.symbol,
                    expiry_date=quote.expiry.isoformat(),
                    last_price=quote.last_price,
                    price_p10=number(
                        quote.last_price
                        * settings.base_grams
                        / settings.quote_grams[quote.symbol]
                    ),
                    volume_grams=quote.volume_grams,
                    open_interest_grams=quote.oi_grams,
                    traded_today=quote.traded_today,
                    last_trade_at=(
                        quote.last_trade_at.isoformat() if quote.last_trade_at else None
                    ),
                )
                for quote in sorted(quotes, key=lambda q: (q.symbol, q.expiry))
                if quote.symbol in settings.quote_grams
            ],
        )
        with self._lock:
            self._data = data
            self._status.update(phase="ok", message="")
        self._save(settings, data)
        return data

    def _fail(self, message: str) -> None:
        self._set_status(phase="error", message=message)

    async def run(self, settings: Settings) -> None:
        """Poll while the API runs. Failures are logged, never raised."""
        if self._running:
            return
        self._running = True
        self.load_saved(settings)
        interval = settings.live_poll_seconds
        failures = 0
        first = True
        try:
            while True:
                now = datetime.now(UTC)
                if first or market_open(now, settings):
                    first = False
                    delay = interval
                    try:
                        await asyncio.to_thread(self.poll_once, settings, now)
                        failures = 0
                    except UpstoxError as exc:
                        failures += 1
                        self._fail(str(exc))
                        logger.warning("Live quotes: %s", exc)
                        delay = (
                            TOKEN_RETRY_SECONDS
                            if "access token" in str(exc)
                            else min(interval * 2**failures, MAX_BACKOFF_SECONDS)
                        )
                    except Exception:
                        failures += 1
                        self._fail("Live quotes failed unexpectedly; retrying.")
                        logger.exception("Live quote poll crashed")
                        delay = min(interval * 2**failures, MAX_BACKOFF_SECONDS)
                    if market_open(datetime.now(UTC), settings):
                        # Keep polls aligned to the interval, not drifting by
                        # the time a request takes.
                        elapsed = (datetime.now(UTC) - now).total_seconds()
                        delay = max(delay - elapsed, 1.0) if failures == 0 else delay
                    else:
                        delay = min(
                            max(delay, CLOSED_CHECK_SECONDS),
                            max(seconds_until_open(datetime.now(UTC), settings), 1.0),
                        )
                else:
                    delay = min(
                        CLOSED_CHECK_SECONDS,
                        max(seconds_until_open(now, settings), 1.0),
                    )
                self._set_status(
                    next_poll_at=(
                        datetime.now(UTC) + timedelta(seconds=delay)
                    ).isoformat()
                )
                await asyncio.sleep(delay)
        finally:
            self._running = False
            self.close()


service = LiveService()
