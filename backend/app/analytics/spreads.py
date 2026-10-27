"""Expiry-specific spread diagnostics; no signals or trade execution."""

from datetime import date, datetime
from math import isfinite

import numpy as np
import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.engine import Engine

from app.analytics.normalize import normalize_prices
from app.core.config import Settings, get_settings
from app.data.loader import bhav, create_loader_engine

COLUMNS = [
    "trade_date",
    "pair",
    "expiry_a",
    "expiry_b_used",
    "days_mismatch",
    "a_p10_999",
    "b_p10_999",
    "spread_abs",
    "spread_pct",
    "roll_mean",
    "roll_std",
    "z",
    "percentile",
    "tradable",
    "reason",
]


def _date(value):
    if value is None:
        return None
    result = date.fromisoformat(value) if isinstance(value, str) else value
    if not isinstance(result, date) or isinstance(result, datetime):
        raise TypeError("Dates must be datetime.date or ISO YYYY-MM-DD strings")
    return result


def _liquidity(legs, volume, oi):
    if any(not bool(row.has_trade) for row in legs):
        return "no_trade"
    if any(
        pd.isna(row.volume_grams)
        or not isfinite(row.volume_grams)
        or row.volume_grams < volume
        for row in legs
    ):
        return "thin_volume"
    if any(
        pd.isna(row.open_interest_grams)
        or not isfinite(row.open_interest_grams)
        or row.open_interest_grams < oi
        for row in legs
    ):
        return "thin_oi"
    return ""


def _positive_price(value):
    return pd.notna(value) and isfinite(value) and value > 0


def _source_price(row, settings, purity):
    """Expose the actual normalized input, never invert a final comparison."""
    return dict(
        symbol=row.symbol,
        trade_date=row.trade_date,
        expiry_date=row.expiry_date,
        close=row.close,
        quote_grams=settings.quote_grams[row.symbol],
        unit_factor=settings.base_grams / settings.quote_grams[row.symbol],
        purity=settings.purity[row.symbol],
        purity_factor=(
            settings.base_purity / settings.purity[row.symbol] if purity else 1.0
        ),
        close_p10_raw=row.close_p10_raw,
        close_p10_adjusted=row.close_p10_999,
        has_trade=bool(row.has_trade),
        volume_grams=row.volume_grams,
        open_interest_grams=row.open_interest_grams,
    )


def _build(frame, pair, carry, volume, oi, *, trace_settings=None, purity=False):
    symbol_a, symbol_b = pair.split("-")
    rows = []
    for day, daily in frame.groupby("trade_date", sort=True):
        leg_a = daily.loc[daily.symbol == symbol_a].sort_values("expiry_date")
        leg_b = daily.loc[daily.symbol == symbol_b].sort_values("expiry_date")
        for a in leg_a.itertuples():
            expiry = a.expiry_date
            row = dict.fromkeys(COLUMNS, np.nan)
            row.update(
                trade_date=day,
                pair=pair,
                expiry_a=expiry,
                a_p10_999=a.close_p10_999,
                tradable=False,
                reason="",
            )
            if trace_settings is not None:
                row["calculation"] = dict(
                    a=_source_price(a, trace_settings, purity),
                    b_components=[],
                    b_weights=[],
                    preceding_finite_count=0,
                    statistics_status="insufficient_history",
                )

            def record_components(components, weights):
                if trace_settings is not None:
                    row["calculation"]["b_components"] = [
                        _source_price(leg, trace_settings, purity) for leg in components
                    ]
                    row["calculation"]["b_weights"] = weights

            cross = symbol_a == "GOLDM" and symbol_b != "GOLDM"
            if not cross:
                matches = leg_b.loc[leg_b.expiry_date == expiry]
                if matches.empty:
                    continue
                b = next(matches.itertuples())
                used = [b]
                record_components(used, [1.0])
                row.update(
                    expiry_b_used=expiry, days_mismatch=0, b_p10_999=b.close_p10_999
                )
            elif carry:
                lower = leg_b.loc[leg_b.expiry_date <= expiry]
                upper = leg_b.loc[leg_b.expiry_date >= expiry]
                if lower.empty or upper.empty:
                    row["reason"] = "no_bracket"
                    rows.append(row)
                    continue
                lo = next(lower.tail(1).itertuples())
                hi = next(upper.head(1).itertuples())
                used = [lo] if lo.expiry_date == hi.expiry_date else [lo, hi]
                record_components(used, [])
                row["expiry_b_used"] = (
                    lo.expiry_date
                    if len(used) == 1
                    else (lo.expiry_date, hi.expiry_date)
                )
                row["days_mismatch"] = (
                    0
                    if len(used) == 1
                    else (
                        (lo.expiry_date - expiry).days,
                        (hi.expiry_date - expiry).days,
                    )
                )
                if any(not bool(b.has_trade) for b in used):
                    row["reason"] = "leg_no_trade"
                    rows.append(row)
                    continue
                if any(not _positive_price(b.close_p10_999) for b in used):
                    row["reason"] = "invalid_price"
                    rows.append(row)
                    continue
                # Interpolate in calendar days using only this trade_date's quotes.
                weight = (
                    0
                    if len(used) == 1
                    else (
                        (expiry - lo.expiry_date).days
                        / (hi.expiry_date - lo.expiry_date).days
                    )
                )
                record_components(
                    used, [1.0] if len(used) == 1 else [1 - weight, weight]
                )
                row["b_p10_999"] = lo.close_p10_999 + weight * (
                    hi.close_p10_999 - lo.close_p10_999
                )
            else:
                if leg_b.empty:
                    row["reason"] = "no_bracket"
                    rows.append(row)
                    continue
                # Ties choose the earlier expiry; no nearest-contract stitching.
                b = min(
                    leg_b.itertuples(),
                    key=lambda b: (abs((b.expiry_date - expiry).days), b.expiry_date),
                )
                used = [b]
                record_components(used, [1.0])
                row.update(
                    expiry_b_used=b.expiry_date,
                    days_mismatch=(b.expiry_date - expiry).days,
                    b_p10_999=b.close_p10_999,
                )
            a_price, b_price = row["a_p10_999"], row["b_p10_999"]
            if (
                pd.isna(a_price)
                or pd.isna(b_price)
                or not (isfinite(a_price) and isfinite(b_price))
            ):
                row["reason"] = "missing_price"
            else:
                if a_price <= 0 or b_price <= 0:
                    row["reason"] = "invalid_price"
                else:
                    row["spread_abs"] = a_price - b_price
                    row["spread_pct"] = 100 * (a_price / b_price - 1)
                    row["reason"] = _liquidity([a, *used], volume, oi)
                    row["tradable"] = not row["reason"]
            rows.append(row)
    columns = COLUMNS + (["calculation"] if trace_settings is not None else [])
    return pd.DataFrame(rows, columns=columns)


def _rolling(frame, window, min_periods):
    for _, series in frame.groupby("expiry_a", sort=False):
        history = []
        for index, current in series.spread_pct.items():
            past = np.asarray(history[-window:], dtype=float)
            trace = frame.at[index, "calculation"] if "calculation" in frame else None
            if trace is not None:
                trace["preceding_finite_count"] = len(past)
            # Only preceding observations enter the window; append today's value last.
            if len(past) >= min_periods:
                mean = float(past.mean())
                std = float(past.std(ddof=1)) if len(past) > 1 else np.nan
                frame.at[index, "roll_mean"] = mean
                frame.at[index, "roll_std"] = std
                if trace is not None:
                    trace["statistics_status"] = (
                        "missing_current_spread"
                        if pd.isna(current)
                        else "zero_variance"
                        if pd.notna(std) and std == 0
                        else "undefined_variance"
                        if pd.isna(std)
                        else "ok"
                    )
                if pd.notna(current):
                    if pd.notna(std) and std > 0:
                        frame.at[index, "z"] = (current - mean) / std
                    # Empirical CDF with half credit for ties, expressed as 0..100.
                    frame.at[index, "percentile"] = (
                        100
                        * ((past < current).sum() + 0.5 * (past == current).sum())
                        / len(past)
                    )
            if pd.notna(current) and isfinite(current):
                history.append(current)
    return frame


def compute_spreads(
    pair,
    start=None,
    end=None,
    window=None,
    min_periods=None,
    carry_adjusted=True,
    min_volume_grams=None,
    min_oi_grams=None,
    use_purity_adjustment=False,
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
    include_calculations: bool = False,
) -> pd.DataFrame:
    """Compute per-expiry diagnostics, using pre-start history for rolling stats.

    None options use config defaults (window=10, min_periods=5, thresholds=0).
    days_mismatch is signed B expiry minus A expiry, or a (lower, upper) tuple.
    Undefined spreads do not count as observations; non-tradable finite spreads do.
    """
    settings = settings or get_settings()
    if pair not in settings.spread_pairs:
        raise ValueError(f"Unknown/unconfigured pair: {pair!r}")
    parts = pair.split("-")
    if len(parts) != 2 or parts[0] == parts[1]:
        raise ValueError(f"Invalid pair: {pair!r}")
    window = settings.spread_window if window is None else window
    min_periods = settings.spread_min_periods if min_periods is None else min_periods
    if (
        not isinstance(window, int)
        or not isinstance(min_periods, int)
        or window < 1
        or not 1 <= min_periods <= window
    ):
        raise ValueError("Require integer window >= min_periods >= 1")
    volume = (
        settings.spread_min_volume_grams
        if min_volume_grams is None
        else min_volume_grams
    )
    oi = settings.spread_min_oi_grams if min_oi_grams is None else min_oi_grams
    if not all(isfinite(value) and value >= 0 for value in (volume, oi)):
        raise ValueError("Liquidity thresholds must be finite and nonnegative")
    start, end = _date(start), _date(end)
    if start and end and start > end:
        raise ValueError("start must be <= end")
    owned = engine is None
    engine = engine if engine is not None else create_loader_engine(settings)
    try:
        query = select(bhav).where(bhav.c.symbol.in_(parts))
        if end:
            query = query.where(bhav.c.trade_date <= end)
        with engine.connect() as connection:
            frame = pd.read_sql(
                query.order_by(bhav.c.trade_date, bhav.c.expiry_date), connection
            )
    finally:
        if owned:
            engine.dispose()
    frame = normalize_prices(
        frame,
        price_cols=("close",),
        settings=settings,
        use_purity_adjustment=use_purity_adjustment,
    )
    result = _build(
        frame,
        pair,
        carry_adjusted,
        volume,
        oi,
        trace_settings=settings if include_calculations else None,
        purity=use_purity_adjustment,
    )
    result = _rolling(result, window, min_periods)
    if start and not result.empty:
        result = result.loc[result.trade_date >= start]
    return result.reset_index(drop=True)


def latest_snapshot(trade_date=None, **same_options) -> pd.DataFrame:
    """All configured pairs for one date, including full prior rolling history."""
    settings = same_options.pop("settings", None) or get_settings()
    engine = same_options.pop("engine", None)
    owned = engine is None
    engine = engine if engine is not None else create_loader_engine(settings)
    try:
        requested = _date(trade_date)
        if requested is None:
            with engine.connect() as connection:
                requested = connection.scalar(select(func.max(bhav.c.trade_date)))
        if requested is None:
            return pd.DataFrame(columns=COLUMNS)
        # The snapshot date determines the range, not optional start/end overrides.
        same_options.pop("start", None)
        same_options.pop("end", None)
        frames = [
            compute_spreads(
                pair,
                start=requested,
                end=requested,
                settings=settings,
                engine=engine,
                **same_options,
            )
            for pair in settings.spread_pairs
        ]
        return (
            pd.concat(frames, ignore_index=True)
            if frames
            else pd.DataFrame(columns=COLUMNS)
        )
    finally:
        if owned:
            engine.dispose()
