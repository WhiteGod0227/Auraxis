"""Provisional intraday analytics from live quotes.

Live last-traded prices are placed on the live session's date, after the stored
settlement history, and run through exactly the same normalisation, spread and
rolling-statistics code as the settlement view. Only preceding *settlement*
sessions enter the rolling window, so a live gap is scored against the same
history the final settlement reading will be scored against.

Nothing here is written to the database: settlement prices remain the record.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from math import isfinite

import pandas as pd

from app.analytics.normalize import normalize_prices
from app.analytics.spreads import _build, _rolling
from app.core.config import Settings

# Same defaults as the dashboard summary (/api/spreads/summary).
LIVE_WINDOW = 10
LIVE_MIN_PERIODS = 5
LIVE_MIN_VOLUME_GRAMS = 2000
LIVE_MIN_OI_GRAMS = 0
# Calendar days of settlement history to read; far more than the window needs.
HISTORY_DAYS = 150
REFERENCE_MIN_DAYS = 3

HISTORY_COLUMNS = [
    "symbol",
    "expiry_date",
    "trade_date",
    "close",
    "has_trade",
    "volume_grams",
    "open_interest_grams",
]


@dataclass(frozen=True)
class LiveQuote:
    symbol: str
    expiry: date
    key: str
    last_price: float
    volume_lots: int
    volume_grams: int
    oi_lots: int
    oi_grams: int
    # Previous settlement implied by the exchange's net change, if reported.
    exchange_previous_close: float | None
    last_trade_at: datetime | None
    traded_today: bool


def number(value) -> float | None:
    """A finite float or None (JSON-safe)."""
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if isfinite(result) else None


def _iso(value) -> str | None:
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def live_frame(quotes: Iterable[LiveQuote], live_date: date) -> pd.DataFrame:
    rows = [
        dict(
            symbol=quote.symbol,
            expiry_date=quote.expiry,
            trade_date=live_date,
            close=quote.last_price,
            has_trade=quote.traded_today,
            volume_grams=quote.volume_grams,
            open_interest_grams=quote.oi_grams,
        )
        for quote in quotes
        if quote.expiry >= live_date
    ]
    return pd.DataFrame(rows, columns=HISTORY_COLUMNS)


def _combined(history: pd.DataFrame, today: pd.DataFrame, live_date: date):
    past = history.loc[history.trade_date < live_date, HISTORY_COLUMNS]
    frames = [frame for frame in (past, today) if not frame.empty]
    if not frames:
        return pd.DataFrame(columns=HISTORY_COLUMNS)
    frame = pd.concat(frames, ignore_index=True)
    frame["close"] = pd.to_numeric(frame["close"], errors="coerce").astype(float)
    frame["has_trade"] = frame["has_trade"].astype(bool)
    return frame.sort_values(["trade_date", "expiry_date", "symbol"]).reset_index(
        drop=True
    )


def _pair_reading(normalized: pd.DataFrame, pair: str, live_date: date):
    a, b = pair.split("-")
    subset = normalized.loc[normalized.symbol.isin([a, b])]
    if subset.empty:
        return None
    built = _build(subset, pair, True, LIVE_MIN_VOLUME_GRAMS, LIVE_MIN_OI_GRAMS)
    if built.empty:
        return None
    rolled = _rolling(built, LIVE_WINDOW, LIVE_MIN_PERIODS)
    today = rolled.loc[rolled.trade_date == live_date]
    if today.empty:
        return None
    # Same expiry rule as the summary: earliest at least three days out,
    # chosen before discarding undefined gaps so both views pick one contract.
    threshold = live_date + timedelta(days=REFERENCE_MIN_DAYS)
    expiries = sorted(today.expiry_a.unique())
    later = [expiry for expiry in expiries if expiry >= threshold]
    chosen = later[0] if later else expiries[-1]
    row = today.loc[today.expiry_a == chosen].iloc[0]
    if number(row.spread_abs) is None:
        return None
    settled = rolled.loc[
        (rolled.expiry_a == chosen)
        & (rolled.trade_date < live_date)
        & rolled.spread_abs.notna()
    ].sort_values("trade_date")
    last = settled.iloc[-1] if not settled.empty else None
    return dict(
        pair=pair,
        expiry=_iso(chosen),
        a_p10=number(row.a_p10_999),
        b_p10=number(row.b_p10_999),
        spread_abs=number(row.spread_abs),
        spread_pct=number(row.spread_pct),
        z=number(row.z),
        percentile=number(row.percentile),
        tradable=bool(row.tradable),
        reason=str(row.reason or ""),
        settled_trade_date=_iso(last.trade_date) if last is not None else None,
        settled_spread_abs=number(last.spread_abs) if last is not None else None,
        settled_z=number(last.z) if last is not None else None,
    )


def _references(
    quotes: list[LiveQuote],
    history: pd.DataFrame,
    live_date: date,
    settings: Settings,
):
    past = history.loc[history.trade_date < live_date]
    references = []
    for product in settings.bhavcopy_symbols:
        candidates = sorted(
            (
                quote
                for quote in quotes
                if quote.symbol == product
                and (quote.expiry - live_date).days >= REFERENCE_MIN_DAYS
            ),
            key=lambda quote: quote.expiry,
        )
        traded = [quote for quote in candidates if quote.traded_today]
        chosen = (traded or candidates or [None])[0]
        if chosen is None:
            references.append(dict(product=product, available=False))
            continue
        factor = settings.base_grams / settings.quote_grams[product]
        previous = None
        previous_date = None
        basis = None
        rows = past.loc[
            (past.symbol == product) & (past.expiry_date == chosen.expiry)
        ].sort_values("trade_date")
        if not rows.empty and number(rows.iloc[-1].close):
            previous = float(rows.iloc[-1].close)
            previous_date = _iso(rows.iloc[-1].trade_date)
            basis = "stored_settlement"
        elif chosen.exchange_previous_close:
            previous = chosen.exchange_previous_close
            basis = "exchange_previous_close"
        change = chosen.last_price - previous if previous else None
        references.append(
            dict(
                product=product,
                available=True,
                expiry_date=chosen.expiry.isoformat(),
                days_to_expiry=(chosen.expiry - live_date).days,
                last_price=number(chosen.last_price),
                price_p10=number(chosen.last_price * factor),
                previous_close_p10=number(previous * factor) if previous else None,
                previous_trade_date=previous_date,
                change_basis=basis,
                change_abs=number(change * factor) if change is not None else None,
                change_pct=number(100 * change / previous) if previous else None,
                volume_grams=chosen.volume_grams,
                open_interest_grams=chosen.oi_grams,
                traded_today=chosen.traded_today,
                last_trade_at=_iso(chosen.last_trade_at),
            )
        )
    return references


def compute_live(
    quotes: list[LiveQuote],
    live_date: date,
    history: pd.DataFrame,
    settings: Settings,
) -> dict:
    """References and pair readings for the live session (JSON-safe)."""
    known = [quote for quote in quotes if quote.symbol in settings.quote_grams]
    today = live_frame(known, live_date)
    combined = _combined(history, today, live_date)
    pairs = []
    if not today.empty:
        normalized = normalize_prices(
            combined, price_cols=("close",), settings=settings
        )
        for pair in settings.spread_pairs:
            reading = _pair_reading(normalized, pair, live_date)
            if reading is not None:
                pairs.append(reading)
    return dict(
        window=LIVE_WINDOW,
        references=_references(known, history, live_date, settings),
        pairs=pairs,
    )
