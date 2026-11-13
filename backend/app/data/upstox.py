"""Upstox market-data connector for MCX gold futures.

Fetches daily candles for every configured gold futures contract and upserts
them into the same ``bhav`` table that the manual Bhavcopy loader writes.
Rows imported from MCX Bhavcopy CSVs (identified by a non-null ``value_lacs``)
are treated as authoritative and are never overwritten by API candles.

Usage from ``backend``::

    .venv\\Scripts\\python.exe -m app.data.upstox --days 365
"""

from __future__ import annotations

import argparse
import gzip
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import httpx
from sqlalchemy import Column, Integer, MetaData, String, Table, Text, func, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError

from app.core.config import BACKEND_DIR, Settings, get_settings
from app.data.loader import (
    KEY,
    bhav,
    create_loader_engine,
    data_health,
    ingestion_attempts,
)
from app.data.loader import metadata as market_metadata

logger = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))
INSTRUMENT_CACHE_SECONDS = 12 * 3600
SOURCE_PREFIX = "upstox"

refresh_metadata = MetaData()
refresh_runs = Table(
    "refresh_runs",
    refresh_metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("provider", String, nullable=False),
    Column("started_at", String, nullable=False),
    Column("finished_at", String),
    Column("status", String, nullable=False),
    Column("trigger", String, nullable=False),
    Column("contracts", Integer, nullable=False, default=0),
    Column("rows", Integer, nullable=False, default=0),
    Column("latest_trade_date", String),
    Column("message", Text, nullable=False, default=""),
)

_refresh_lock = threading.Lock()
_schema_lock = threading.Lock()
_schema_ready: set[str] = set()


def ensure_schema(engine: Engine) -> None:
    """Create market/refresh tables once per database, safely across threads."""
    key = str(engine.url)
    if key in _schema_ready:
        return
    with _schema_lock:
        if key not in _schema_ready:
            for attempt in range(2):
                try:
                    market_metadata.create_all(engine)
                    refresh_metadata.create_all(engine)
                    break
                except OperationalError as exc:
                    # Another process (e.g. the CSV loader) created it first.
                    if "already exists" not in str(exc) or attempt:
                        raise
            _schema_ready.add(key)


class UpstoxError(RuntimeError):
    """A safe, user-presentable connector failure."""


@dataclass(frozen=True)
class Contract:
    symbol: str
    expiry: date
    key: str
    underlying_key: str
    expired: bool = False


@dataclass
class RefreshResult:
    status: str = "ok"
    contracts: int = 0
    rows: int = 0
    trade_dates: set[date] = field(default_factory=set)
    errors: list[str] = field(default_factory=list)

    @property
    def latest_trade_date(self) -> date | None:
        return max(self.trade_dates) if self.trade_dates else None

    def message(self) -> str:
        parts = [f"{self.rows} rows from {self.contracts} contracts"]
        if self.errors:
            parts.append(f"{len(self.errors)} issue(s): " + "; ".join(self.errors[:5]))
        return ". ".join(parts)


# --------------------------------------------------------------------------- #
# Instruments
# --------------------------------------------------------------------------- #


def _ist_date(epoch_ms: int | float) -> date:
    return datetime.fromtimestamp(epoch_ms / 1000, IST).date()


def parse_instruments(raw: list[dict], symbols: list[str]) -> list[Contract]:
    wanted = set(symbols)
    contracts = []
    for item in raw:
        if (
            item.get("segment") != "MCX_FO"
            or item.get("instrument_type") != "FUT"
            or item.get("underlying_symbol") not in wanted
            or not item.get("instrument_key")
            or not item.get("expiry")
        ):
            continue
        contracts.append(
            Contract(
                symbol=item["underlying_symbol"],
                expiry=_ist_date(item["expiry"]),
                key=item["instrument_key"],
                underlying_key=item.get("underlying_key") or "",
            )
        )
    return sorted(contracts, key=lambda c: (c.symbol, c.expiry))


def _cache_dir(settings: Settings) -> Path:
    path = settings.data_cache_dir
    path = path if path.is_absolute() else BACKEND_DIR / path
    path = path / "upstox"
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_instruments(client: httpx.Client, settings: Settings) -> list[Contract]:
    cache = _cache_dir(settings) / "MCX.json.gz"
    fresh = cache.exists() and time.time() - cache.stat().st_mtime < (
        INSTRUMENT_CACHE_SECONDS
    )
    if not fresh:
        try:
            response = client.get(settings.upstox_instruments_url)
            response.raise_for_status()
            cache.write_bytes(response.content)
        except httpx.HTTPError as exc:
            if not cache.exists():
                raise UpstoxError(
                    "Could not download the Upstox MCX instrument list."
                ) from exc
            logger.warning("Using stale Upstox instrument cache: %s", exc)
    try:
        raw = json.loads(gzip.decompress(cache.read_bytes()))
    except (OSError, ValueError) as exc:
        cache.unlink(missing_ok=True)
        raise UpstoxError("The Upstox instrument list was unreadable.") from exc
    return parse_instruments(raw, settings.bhavcopy_symbols)


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #


def _client(settings: Settings) -> httpx.Client:
    return httpx.Client(
        timeout=settings.upstox_timeout,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {settings.upstox_access_token}",
        },
        follow_redirects=True,
    )


def _get_json(client: httpx.Client, url: str, params: dict | None = None) -> dict:
    for attempt in range(3):
        response = client.get(url, params=params)
        if response.status_code == 429 and attempt < 2:
            time.sleep(1.5 * (attempt + 1))
            continue
        break
    if response.status_code in (401, 403):
        raise UpstoxError(
            "Upstox rejected the access token. Generate a new Analytics Token "
            "and update UPSTOX_ACCESS_TOKEN."
        )
    if response.status_code >= 400:
        detail = ""
        try:
            errors = response.json().get("errors") or []
            detail = errors[0].get("message", "") if errors else ""
        except ValueError:
            pass
        raise UpstoxError(
            f"Upstox request failed (HTTP {response.status_code}) {detail}".strip()
        )
    try:
        return response.json()
    except ValueError as exc:
        raise UpstoxError("Upstox returned a non-JSON response.") from exc


def fetch_candles(
    client: httpx.Client, settings: Settings, key: str, start: date, end: date
) -> list[list]:
    base = settings.upstox_api_base.rstrip("/")
    url = (
        f"{base}/v3/historical-candle/{quote(key, safe='')}/days/1/"
        f"{end.isoformat()}/{start.isoformat()}"
    )
    return (_get_json(client, url).get("data") or {}).get("candles") or []


def fetch_expired_contracts(
    client: httpx.Client,
    settings: Settings,
    symbol: str,
    underlying_key: str,
    since: date,
    today: date,
) -> list[Contract]:
    base = settings.upstox_api_base.rstrip("/")
    expiries = (
        _get_json(
            client,
            f"{base}/v2/expired-instruments/expiries",
            {"instrument_key": underlying_key},
        ).get("data")
        or []
    )
    contracts = []
    for value in expiries:
        try:
            expiry = date.fromisoformat(str(value)[:10])
        except ValueError:
            continue
        if not since <= expiry < today:
            continue
        items = (
            _get_json(
                client,
                f"{base}/v2/expired-instruments/future/contract",
                {"instrument_key": underlying_key, "expiry_date": expiry.isoformat()},
            ).get("data")
            or []
        )
        for item in items:
            if item.get("underlying_symbol", symbol) != symbol:
                continue
            if item.get("instrument_key"):
                contracts.append(
                    Contract(
                        symbol, expiry, item["instrument_key"], underlying_key, True
                    )
                )
    return contracts


def fetch_expired_candles(
    client: httpx.Client, settings: Settings, key: str, start: date, end: date
) -> list[list]:
    base = settings.upstox_api_base.rstrip("/")
    url = (
        f"{base}/v2/expired-instruments/historical-candle/{quote(key, safe='')}/day/"
        f"{end.isoformat()}/{start.isoformat()}"
    )
    return (_get_json(client, url).get("data") or {}).get("candles") or []


# --------------------------------------------------------------------------- #
# Transformation and storage
# --------------------------------------------------------------------------- #


def _as_int(value) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return max(int(round(number)), 0)


def candle_rows(contract: Contract, candles: list[list], settings: Settings):
    """Convert Upstox ``[ts, o, h, l, c, volume, oi]`` candles to bhav rows."""
    lot_grams = settings.lot_grams[contract.symbol]
    parsed = []
    for candle in candles:
        if not isinstance(candle, list | tuple) or len(candle) < 6:
            continue
        try:
            trade_date = date.fromisoformat(str(candle[0])[:10])
            open_, high, low, close = (float(value) for value in candle[1:5])
        except (TypeError, ValueError):
            continue
        if trade_date > contract.expiry or not close > 0:
            continue
        parsed.append((trade_date, open_, high, low, close, candle))
    parsed.sort(key=lambda item: item[0])
    rows = []
    previous = None
    for trade_date, open_, high, low, close, candle in parsed:
        volume = _as_int(candle[5])
        interest = _as_int(candle[6]) if len(candle) > 6 else 0
        if settings.upstox_volume_unit == "grams":
            volume_grams, oi_grams = volume, interest
            volume_lots, oi_lots = volume // lot_grams, interest // lot_grams
        else:
            volume_lots, oi_lots = volume, interest
            volume_grams, oi_grams = volume * lot_grams, interest * lot_grams
        rows.append(
            dict(
                symbol=contract.symbol,
                expiry_date=contract.expiry,
                trade_date=trade_date,
                open=open_,
                high=high,
                low=low,
                close=close,
                previous_close=previous,
                value_lacs=None,
                volume_lots=volume_lots,
                volume_text=f"{volume_grams / 1000:.3f} GRMS",
                open_interest_lots=oi_lots,
                volume_grams=volume_grams,
                open_interest_grams=oi_grams,
                has_trade=volume_lots > 0,
            )
        )
        previous = close
    return rows


def store_rows(engine: Engine, rows: list[dict]) -> int:
    if not rows:
        return 0
    ensure_schema(engine)
    statement = insert(bhav)
    statement = statement.on_conflict_do_update(
        index_elements=KEY,
        set_={
            column.name: statement.excluded[column.name]
            for column in bhav.columns
            if column.name not in KEY
        },
        # Bhavcopy rows carry value_lacs; never replace them with API candles.
        where=bhav.c.value_lacs.is_(None),
    )
    with engine.begin() as connection:
        connection.execute(statement, rows)
    return len(rows)


def record_health(engine: Engine, result: RefreshResult, rows: list[dict]) -> None:
    by_date: dict[date, int] = {}
    for row in rows:
        by_date[row["trade_date"]] = by_date.get(row["trade_date"], 0) + 1
    now = datetime.now(UTC).isoformat()
    with engine.begin() as connection:
        for trade_date, count in sorted(by_date.items()):
            name = f"{SOURCE_PREFIX}_{trade_date.isoformat()}"
            values = dict(
                file_name=name,
                trade_date=trade_date,
                status="ok",
                rows_total=count,
                rows_kept=count,
                notes="Imported from Upstox daily candles.",
            )
            statement = insert(data_health)
            connection.execute(
                statement.on_conflict_do_update(
                    index_elements=["file_name"],
                    set_={k: v for k, v in values.items() if k != "file_name"},
                ),
                values,
            )
            connection.execute(
                insert(ingestion_attempts).values(recorded_at=now, **values)
            )


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


def _start_run(engine: Engine, trigger: str) -> int:
    ensure_schema(engine)
    with engine.begin() as connection:
        return connection.execute(
            insert(refresh_runs).values(
                provider="upstox",
                started_at=datetime.now(UTC).isoformat(),
                status="running",
                trigger=trigger,
                contracts=0,
                rows=0,
                message="",
            )
        ).inserted_primary_key[0]


def _finish_run(engine: Engine, run_id: int, result: RefreshResult) -> None:
    latest = result.latest_trade_date
    with engine.begin() as connection:
        connection.execute(
            refresh_runs.update()
            .where(refresh_runs.c.id == run_id)
            .values(
                finished_at=datetime.now(UTC).isoformat(),
                status=result.status,
                contracts=result.contracts,
                rows=result.rows,
                latest_trade_date=latest.isoformat() if latest else None,
                message=result.message()[:2000],
            )
        )


def refresh(
    settings: Settings | None = None,
    *,
    days: int | None = None,
    include_expired: bool | None = None,
    trigger: str = "manual",
    engine: Engine | None = None,
    client: httpx.Client | None = None,
    today: date | None = None,
) -> RefreshResult:
    settings = settings or get_settings()
    if not settings.upstox_access_token.strip():
        raise UpstoxError(
            "Upstox is not configured. Set UPSTOX_ACCESS_TOKEN in backend/.env."
        )
    if not _refresh_lock.acquire(blocking=False):
        raise UpstoxError("A data refresh is already running.")
    owned_engine = engine is None
    owned_client = client is None
    engine = engine or create_loader_engine(settings)
    client = client or _client(settings)
    result = RefreshResult()
    run_id = _start_run(engine, trigger)
    try:
        today = today or datetime.now(IST).date()
        days = days or settings.upstox_history_days
        expired = (
            settings.upstox_include_expired
            if include_expired is None
            else include_expired
        )
        since = today - timedelta(days=days)
        contracts = [c for c in load_instruments(client, settings) if c.expiry >= today]
        if expired:
            underlyings = {c.symbol: c.underlying_key for c in contracts}
            for symbol, underlying in sorted(underlyings.items()):
                try:
                    contracts += fetch_expired_contracts(
                        client, settings, symbol, underlying, since, today
                    )
                except UpstoxError as exc:
                    result.errors.append(f"{symbol} expired contracts: {exc}")
        all_rows: list[dict] = []
        for contract in contracts:
            try:
                fetch = fetch_expired_candles if contract.expired else fetch_candles
                end = min(today, contract.expiry)
                candles = fetch(client, settings, contract.key, since, end)
            except UpstoxError as exc:
                if "access token" in str(exc):
                    raise
                result.errors.append(
                    f"{contract.symbol} {contract.expiry.isoformat()}: {exc}"
                )
                continue
            rows = candle_rows(contract, candles, settings)
            result.contracts += 1
            all_rows += rows
        result.rows = store_rows(engine, all_rows)
        result.trade_dates = {row["trade_date"] for row in all_rows}
        record_health(engine, result, all_rows)
        if not all_rows:
            result.status = "empty" if not result.errors else "error"
        elif result.errors:
            result.status = "partial"
        return result
    except UpstoxError as exc:
        result.status = "error"
        result.errors.insert(0, str(exc))
        raise
    except Exception as exc:  # pragma: no cover - defensive, logged
        logger.exception("Upstox refresh failed")
        result.status = "error"
        result.errors.insert(0, "Unexpected refresh failure.")
        raise UpstoxError("Unexpected refresh failure.") from exc
    finally:
        try:
            _finish_run(engine, run_id, result)
        finally:
            if owned_client:
                client.close()
            if owned_engine:
                engine.dispose()
            _refresh_lock.release()
        logger.info("Upstox refresh %s: %s", result.status, result.message())


def refresh_status(settings: Settings | None = None) -> dict:
    settings = settings or get_settings()
    engine = create_loader_engine(settings)
    try:
        ensure_schema(engine)
        with engine.connect() as connection:
            last = connection.execute(
                select(refresh_runs).order_by(refresh_runs.c.id.desc()).limit(1)
            ).first()
            latest = connection.execute(select(func.max(bhav.c.trade_date))).scalar()
    finally:
        engine.dispose()
    return {
        "provider": "upstox",
        "configured": bool(settings.upstox_access_token.strip()),
        "auto_refresh_hours": settings.auto_refresh_hours,
        "refreshing": _refresh_lock.locked(),
        "latest_trade_date": latest.isoformat() if latest else None,
        "last_run": dict(last._mapping) if last else None,
    }


def main() -> None:
    from app.core.logging import setup_logging

    setup_logging()
    parser = argparse.ArgumentParser(description="Import MCX gold candles from Upstox")
    parser.add_argument("--days", type=int, default=None)
    parser.add_argument(
        "--expired",
        action="store_true",
        help="Also import expired contracts (requires Upstox Plus).",
    )
    args = parser.parse_args()
    try:
        result = refresh(
            days=args.days, include_expired=args.expired or None, trigger="cli"
        )
    except UpstoxError as exc:
        raise SystemExit(f"Refresh failed: {exc}") from None
    print(f"{result.status}: {result.message()}")
    if result.latest_trade_date:
        print(f"Latest trade date: {result.latest_trade_date.isoformat()}")


if __name__ == "__main__":
    main()
