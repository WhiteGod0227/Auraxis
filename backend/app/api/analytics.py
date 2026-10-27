"""Read-only adapters around completed analytics; no new pricing calculations."""

import re
from contextlib import nullcontext
from datetime import date as Date
from math import isfinite
from typing import Annotated, Literal

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BeforeValidator

from app.analytics.backtest import PAIRS, simulate_pair
from app.analytics.backtest_report import summarize_simulation
from app.analytics.spreads import compute_spreads
from app.analytics.term_structure import compute_rolldown, curve
from app.api.analytics_schemas import (
    BacktestResponse,
    CurveResponse,
    RolldownResponse,
    SpreadsResponse,
)
from app.api.database import get_connection
from app.api.foundation import _base, _basis, _read
from app.api.schemas import json_safe
from app.core.config import Settings, get_settings
from app.data.loader import bhav

router = APIRouter(prefix="/api", tags=["analytics"])
Nonnegative = Annotated[float, Query(ge=0, allow_inf_nan=False)]
Positive = Annotated[float, Query(gt=0, allow_inf_nan=False)]


def _iso_date(value):
    if isinstance(value, str) and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Date must use ISO YYYY-MM-DD format")
    return value


ISODate = Annotated[Date, BeforeValidator(_iso_date)]


class ConnectionEngine:
    """Give analytics their engine interface without opening additional connections."""

    def __init__(self, connection):
        self.connection = connection

    def connect(self):
        return nullcontext(self.connection)


def _validate(
    settings, *, product=None, pair=None, start=None, end=None, window=10, min_periods=5
):
    if product is not None and product not in settings.bhavcopy_symbols:
        raise HTTPException(422, "Unsupported product.")
    if pair is not None and pair not in settings.spread_pairs:
        raise HTTPException(422, "Unsupported pair.")
    if min_periods > window:
        raise HTTPException(422, "min_periods must be <= window.")
    if start is not None and end is not None and start > end:
        raise HTTPException(422, "start must be <= end.")


def _records(frame):
    return json_safe(frame.to_dict(orient="records"))


def _window(frame):
    return dict(
        first_trade_date=None if frame.empty else frame.trade_date.min(),
        last_trade_date=None if frame.empty else frame.trade_date.max(),
    )


def _common(raw, returned, settings, config):
    result = _base(raw)
    result.update(
        configuration=config,
        normalization=_basis(settings),
        data_window=_window(returned),
        units=dict(
            prices=f"Rs per {settings.base_grams:g} g",
            liquidity="grams",
            maturity="calendar days",
        ),
        assumptions=[
            "Purity assumptions remain unverified against MCX specifications.",
            "Cross-contract comparison basis is provisional: delivery purity alone "
            "does not establish a quoted-price multiplier; GOLDPETAL is ex-Mumbai, "
            "other gold products ex-Ahmedabad.",
            "Close/settlement is not an executable market price.",
            "With purity disabled, p10_999 fields equal raw normalized prices.",
        ],
    )
    if returned.empty:
        result["message"] = "No matching observations for the requested selection."
    return result


def _dates(value):
    if isinstance(value, (tuple, list)):
        return list(value)
    return [] if value is None or pd.isna(value) else [value]


def _liquidity(raw, row, pair, volume, oi):
    a, b = pair.split("-")
    keys = [(a, row["expiry_a"]), *[(b, d) for d in row["expiry_b_used"]]]
    if not row["expiry_b_used"]:
        return False, "missing_brackets"
    legs = []
    for symbol, expiry in keys:
        matches = raw.loc[
            (raw.symbol == symbol)
            & (raw.expiry_date == expiry)
            & (raw.trade_date == row["trade_date"])
        ]
        if matches.empty:
            return False, "missing_component"
        legs.append(matches.iloc[0])
    if any(not leg.has_trade for leg in legs):
        return False, "no_trade"
    if any(
        pd.isna(leg.volume_grams)
        or not isfinite(leg.volume_grams)
        or leg.volume_grams < volume
        for leg in legs
    ):
        return False, "thin_volume"
    if any(
        pd.isna(leg.open_interest_grams)
        or not isfinite(leg.open_interest_grams)
        or leg.open_interest_grams < oi
        for leg in legs
    ):
        return False, "thin_oi"
    return True, ""


def _description(row):
    messages = []
    if row["reason"] == "no_bracket":
        messages.append("Missing maturity brackets; this comparison is unavailable.")
    if row["liquidity_reason"] == "no_trade" or row["reason"] == "leg_no_trade":
        messages.append("At least one required component had no trade.")
    if row["liquidity_reason"] in {"thin_volume", "thin_oi"}:
        messages.append(
            "At least one component is below the requested liquidity threshold."
        )
    z = row["z"]
    if z is None or not isfinite(z):
        messages.append(
            "Z-score is undefined: insufficient history, "
            "zero variance or missing spread."
        )
    else:
        messages.append(
            f"Spread is {z:.2f} historical standard deviations from its preceding mean."
        )
    if row["reason"] in {"missing_price", "invalid_price"}:
        messages.append("The component price is missing or invalid.")
    if row["analytics_only"]:
        messages.append(
            "Analytics-only maturity comparison; no executable pair is represented."
        )
    return (
        " ".join(messages)
        + " This diagnostic does not establish profitability or convergence."
    )


@router.get("/spreads", response_model=SpreadsResponse)
def spreads_api(
    pair: str,
    expiry: ISODate | None = None,
    start: ISODate | None = None,
    end: ISODate | None = None,
    window: int = Query(10, ge=1),
    min_periods: int = Query(5, ge=1),
    carry_adjusted: bool = True,
    purity: bool = False,
    min_volume_grams: Nonnegative = 2000,
    min_oi_grams: Nonnegative = 0,
    connection=Depends(get_connection),
    settings: Settings = Depends(get_settings),
):
    _validate(
        settings,
        pair=pair,
        start=start,
        end=end,
        window=window,
        min_periods=min_periods,
    )
    config = dict(
        pair=pair,
        expiry=expiry,
        start=start,
        end=end,
        window=window,
        min_periods=min_periods,
        carry_adjusted=carry_adjusted,
        use_purity_adjustment=purity,
        min_volume_grams=min_volume_grams,
        min_oi_grams=min_oi_grams,
    )
    raw, available = _read(connection, bhav)
    options = {key: value for key, value in config.items() if key != "expiry"}
    frame = (
        compute_spreads(
            **options,
            settings=settings,
            engine=ConnectionEngine(connection),
            include_calculations=True,
        )
        if available
        else pd.DataFrame()
    )
    if expiry is not None and not frame.empty:
        frame = frame.loc[frame.expiry_a == expiry]
    cross = "GOLDM" in pair.split("-")
    series = []
    if not frame.empty:
        for selected, group in frame.groupby("expiry_a", sort=True):
            rows = []
            for source in _records(group.sort_values("trade_date")):
                source["expiry_b_used"] = _dates(source["expiry_b_used"])
                source["days_mismatch"] = _dates(source["days_mismatch"])
                source["source_tradable"] = source.pop("tradable")
                source["liquidity_ok"], source["liquidity_reason"] = _liquidity(
                    raw, source, pair, min_volume_grams, min_oi_grams
                )
                source.update(
                    executable_pair=not cross,
                    analytics_only=cross,
                    comparison_type=(
                        "interpolated_maturity"
                        if carry_adjusted
                        else "unmatched_maturity"
                    )
                    if cross
                    else "same_expiry",
                )
                rows.append(source)
            series.append(
                dict(
                    expiry_a=selected,
                    rows=rows,
                    latest=rows[-1],
                    description=_description(rows[-1]),
                )
            )
    common = _common(raw, frame, settings, config)
    common["units"].update(
        spread_abs=common["units"]["prices"],
        spread_pct="percent of B",
        roll_mean="percent of B",
        roll_std="percentage points",
        z="dimensionless standard deviations",
        percentile="0 to 100",
    )
    common["assumptions"].append(
        "executable_pair denotes same-expiry structural eligibility only; "
        "no fill is guaranteed."
    )
    common["assumptions"].append(
        "Rolling statistics use preceding finite spread observations, including "
        "non-tradable/thin-volume diagnostics. Undefined spreads do not count. "
        "Liquidity failures never permit simulated execution."
    )
    return dict(
        **common,
        series=series,
        maturity_definition="expiry_b_used lists actual B expiry "
        "or lower/upper brackets; "
        "days_mismatch lists signed B expiry minus A expiry in the same order.",
    )


@router.get("/curve", response_model=CurveResponse)
def curve_api(
    product: str,
    date: ISODate | None = None,
    purity: bool = False,
    connection=Depends(get_connection),
    settings: Settings = Depends(get_settings),
):
    _validate(settings, product=product)
    raw, available = _read(connection, bhav)
    frame = (
        curve(
            product,
            date,
            use_purity_adjustment=purity,
            settings=settings,
            engine=ConnectionEngine(connection),
        )
        if available
        else pd.DataFrame()
    )
    selected = (
        date if date is not None else (None if frame.empty else frame.trade_date.max())
    )
    common = _common(
        raw,
        frame,
        settings,
        dict(product=product, date=date, use_purity_adjustment=purity),
    )
    common["assumptions"].append(
        "Connecting curve points does not make settlements executable."
    )
    return dict(**common, selected_date=selected, points=_records(frame))


@router.get("/rolldown", response_model=RolldownResponse)
def rolldown_api(
    product: str,
    expiry: ISODate | None = None,
    start: ISODate | None = None,
    end: ISODate | None = None,
    purity: bool = False,
    connection=Depends(get_connection),
    settings: Settings = Depends(get_settings),
):
    _validate(settings, product=product, start=start, end=end)
    raw, available = _read(connection, bhav)
    frame = (
        compute_rolldown(
            product,
            start,
            end,
            use_purity_adjustment=purity,
            settings=settings,
            engine=ConnectionEngine(connection),
        )
        if available
        else pd.DataFrame()
    )
    if expiry is not None and not frame.empty:
        frame = frame.loc[frame.expiry_date == expiry]
    series = (
        []
        if frame.empty
        else [
            dict(expiry_date=selected, rows=_records(group))
            for selected, group in frame.groupby("expiry_date", sort=True)
        ]
    )
    valid = 0 if frame.empty else int(frame.decomposition_valid.sum())
    common = _common(
        raw,
        frame,
        settings,
        dict(
            product=product,
            expiry=expiry,
            start=start,
            end=end,
            use_purity_adjustment=purity,
        ),
    )
    common["units"].update(
        slope_per_day="normalized rupees per calendar day",
        changes=common["units"]["prices"],
    )
    return dict(
        **common,
        series=series,
        valid_count=valid,
        invalid_count=len(frame) - valid,
        explanation="Local linear, constant-shape approximation: estimated_roll_down "
        "is minus the previous curve slope times elapsed calendar days; "
        "residual_change "
        "is raw_change minus estimated_roll_down, "
        "not proven mispricing or trading profit.",
    )


@router.get("/backtest", response_model=BacktestResponse)
def backtest_api(
    pair: str,
    expiry: ISODate | None = None,
    window: int = Query(10, ge=1),
    min_periods: int = Query(5, ge=1),
    z_entry: Positive = 1,
    z_exit: Nonnegative = 0.25,
    max_hold_sessions: int = Query(5, ge=1),
    expiry_buffer_calendar_days: int = Query(3, ge=0),
    min_volume_grams: Nonnegative = 2000,
    min_oi_grams: Nonnegative = 0,
    notional_per_leg: Positive = 1000000,
    cost_bps_per_leg_per_side: Nonnegative = 5,
    purity: bool = False,
    sizing_mode: Literal["fractional", "integer_lots"] = "fractional",
    connection=Depends(get_connection),
    settings: Settings = Depends(get_settings),
):
    _validate(settings, pair=pair, window=window, min_periods=min_periods)
    if "GOLDM" in pair.split("-"):
        raise HTTPException(
            422, "GOLDM pairs are analytics-only and cannot be simulated."
        )
    if pair not in PAIRS:
        raise HTTPException(422, "Unsupported same-expiry simulation pair.")
    if z_exit >= z_entry:
        raise HTTPException(422, "Require 0 <= z_exit < z_entry.")
    config = dict(
        pair=pair,
        window=window,
        min_periods=min_periods,
        z_entry=z_entry,
        z_exit=z_exit,
        max_hold_sessions=max_hold_sessions,
        expiry_buffer_calendar_days=expiry_buffer_calendar_days,
        min_volume_grams=min_volume_grams,
        min_oi_grams=min_oi_grams,
        notional_per_leg=notional_per_leg,
        cost_bps_per_leg_per_side=cost_bps_per_leg_per_side,
        sizing_mode=sizing_mode,
        use_purity_adjustment=purity,
    )
    raw, available = _read(connection, bhav)
    reports = []
    returned = pd.DataFrame()
    if available:
        result = simulate_pair(
            **config, settings=settings, engine=ConnectionEngine(connection)
        )
        config = dict(result.configuration)
        for report in summarize_simulation(result, expiry):

            def selected(frame):
                return frame.loc[frame.expiry == report.expiry]

            positions = selected(result.positions)
            reports.append(
                dict(
                    expiry=report.expiry,
                    configuration=report.configuration,
                    metrics=report.metrics,
                    verdict=report.verdict,
                    equity_curve=_records(report.equity_curve),
                    completed_trades=_records(selected(result.completed_trades)),
                    open_positions=_records(positions.loc[positions.status == "open"]),
                    unresolved_positions=_records(
                        positions.loc[positions.status == "unresolved_expiry"]
                    ),
                    pending_orders=_records(selected(result.pending_orders)),
                    order_events=_records(selected(result.order_events)),
                    diagnostics=_records(selected(result.diagnostics)),
                    cost_sensitivity=_records(report.cost_sensitivity),
                    cost_tolerance=report.cost_tolerance,
                    reference_capital=report.metrics["reference_capital"],
                    assumptions=list(report.assumptions),
                )
            )
        returned = (
            result.ledger
            if expiry is None
            else result.ledger.loc[result.ledger.expiry == expiry]
        )
    config["requested_expiry"] = expiry
    common = _common(raw, returned, settings, config)
    common["units"].update(
        pnl_costs_equity="Rs",
        cost_rate="basis points per leg per side",
        quantities="signed normalized base-gram units; integer lots rounded down"
        if sizing_mode == "integer_lots"
        else "signed fractional 10g units",
        win_rate="fraction 0 to 1",
        returns="percent of reference capital",
        holding="database session intervals",
    )
    return dict(**common, reports=reports)
