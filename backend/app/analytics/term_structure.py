"""Term curves and a local linear, constant-shape roll-down approximation.

The approximation operates in time-to-expiry coordinates. Residual change is
not a directly observed causal decomposition, proven mispricing, or a profit
calculation. Close/settlement is not executable. Existing purity assumptions
come from the problem statement and remain unverified against MCX specs.
"""

from datetime import date, datetime
from math import isfinite

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.engine import Engine

from app.analytics.normalize import normalize_prices
from app.core.config import Settings, get_settings
from app.data.loader import bhav, create_loader_engine

CURVE_COLUMNS = [
    "trade_date",
    "product",
    "expiry_date",
    "days_to_expiry",
    "close_p10_raw",
    "close_p10_999",
    "has_trade",
    "volume_grams",
    "open_interest_grams",
    "quality_reason",
]
ROLLDOWN_COLUMNS = [
    "trade_date",
    "previous_trade_date",
    "product",
    "expiry_date",
    "next_expiry_used",
    "elapsed_days",
    "previous_price",
    "current_price",
    "slope_per_day",
    "raw_change",
    "estimated_roll_down",
    "residual_change",
    "decomposition_valid",
    "reason",
]


def _date(value):
    if value is None:
        return None
    result = date.fromisoformat(value) if isinstance(value, str) else value
    if not isinstance(result, date) or isinstance(result, datetime):
        raise TypeError("Dates must be datetime.date or ISO YYYY-MM-DD strings")
    return result


def _finite(value):
    return pd.notna(value) and isfinite(value)


def _positive_price(value):
    return _finite(value) and value > 0


def _read(product, settings, engine, use_purity_adjustment, end=None):
    if product not in settings.quote_grams or product not in settings.purity:
        raise ValueError(f"Unknown product: {product!r}")
    owned = engine is None
    engine = engine if engine is not None else create_loader_engine(settings)
    try:
        query = select(bhav).where(bhav.c.symbol == product)
        if end is not None:
            query = query.where(bhav.c.trade_date <= end)
        with engine.connect() as connection:
            frame = pd.read_sql(
                query.order_by(bhav.c.trade_date, bhav.c.expiry_date), connection
            )
    finally:
        if owned:
            engine.dispose()
    return normalize_prices(
        frame,
        price_cols=("close",),
        settings=settings,
        use_purity_adjustment=use_purity_adjustment,
    )


def curve(
    product,
    trade_date=None,
    use_purity_adjustment=False,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
) -> pd.DataFrame:
    """One exact product date; expiry day is included, expired contracts excluded."""
    requested = _date(trade_date)
    settings = settings or get_settings()
    frame = _read(product, settings, engine, use_purity_adjustment, end=requested)
    if frame.empty:
        return pd.DataFrame(columns=CURVE_COLUMNS)
    selected = requested if requested is not None else frame.trade_date.max()
    frame = frame.loc[
        (frame.trade_date == selected) & (frame.expiry_date >= selected)
    ].copy()
    frame["product"] = product
    frame["days_to_expiry"] = frame.expiry_date.map(
        lambda expiry: (expiry - selected).days
    )
    frame["quality_reason"] = [
        "no_trade"
        if not traded
        else "invalid_price"
        if not _positive_price(price)
        else ""
        for traded, price in zip(frame.has_trade, frame.close_p10_999, strict=True)
    ]
    return frame.sort_values("expiry_date")[CURVE_COLUMNS].reset_index(drop=True)


def compute_rolldown(
    product,
    start=None,
    end=None,
    use_purity_adjustment=False,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
) -> pd.DataFrame:
    """Compare fixed expiries across consecutive available product trade dates.

    Keep the union of expiries observed on either date, including missing/expired
    contracts as invalid diagnostics. Use pre-start history for the first output
    date. Only the previous date's immediate later, unexpired expiry defines slope.
    Invalid rows retain calculable raw changes but no decomposition estimates.
    """
    start, end = _date(start), _date(end)
    if start is not None and end is not None and start > end:
        raise ValueError("start must be <= end")
    settings = settings or get_settings()
    frame = _read(product, settings, engine, use_purity_adjustment, end=end)
    days = sorted(frame.trade_date.unique())
    rows = []
    for previous_day, current_day in zip(days, days[1:]):
        if start is not None and current_day < start:
            continue
        previous = frame.loc[frame.trade_date == previous_day].set_index("expiry_date")
        current = frame.loc[frame.trade_date == current_day].set_index("expiry_date")
        # Keep immediate neighbours even when untraded or their prices are missing.
        previous_expiries = sorted(
            expiry for expiry in previous.index if expiry >= previous_day
        )
        for expiry in sorted(set(previous.index) | set(current.index)):
            row = dict.fromkeys(ROLLDOWN_COLUMNS, np.nan)
            row.update(
                trade_date=current_day,
                previous_trade_date=previous_day,
                product=product,
                expiry_date=expiry,
                elapsed_days=(current_day - previous_day).days,
                decomposition_valid=False,
                reason="",
            )
            a = previous.loc[expiry] if expiry in previous.index else None
            b = current.loc[expiry] if expiry in current.index else None
            later = next((value for value in previous_expiries if value > expiry), None)
            row["next_expiry_used"] = later
            if a is not None:
                row["previous_price"] = a.close_p10_999
            if b is not None:
                row["current_price"] = b.close_p10_999
            if _finite(row["previous_price"]) and _finite(row["current_price"]):
                row["raw_change"] = row["current_price"] - row["previous_price"]
            if a is None or b is None:
                row["reason"] = "missing_observation"
            elif expiry < current_day:
                row["reason"] = "expired_contract"
            elif not a.has_trade or not b.has_trade:
                row["reason"] = "no_trade"
            elif not (
                _positive_price(a.close_p10_999) and _positive_price(b.close_p10_999)
            ):
                row["reason"] = "invalid_price"
            elif later is None:
                row["reason"] = "no_next_expiry"
            elif not previous.loc[later].has_trade:
                row["reason"] = "next_expiry_no_trade"
            elif not _positive_price(previous.loc[later].close_p10_999):
                row["reason"] = "invalid_price"
            else:
                slope = (previous.loc[later].close_p10_999 - a.close_p10_999) / (
                    later - expiry
                ).days
                roll_down = -slope * row["elapsed_days"]
                row.update(
                    slope_per_day=slope,
                    estimated_roll_down=roll_down,
                    residual_change=row["raw_change"] - roll_down,
                    decomposition_valid=True,
                )
            rows.append(row)
    return pd.DataFrame(rows, columns=ROLLDOWN_COLUMNS)
