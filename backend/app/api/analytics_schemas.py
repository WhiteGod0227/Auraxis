"""Analytics API response models; units are supplied alongside every result."""

from datetime import date
from typing import Any

from app.api.schemas import DataResponse, NormalizationBasis, ResponseModel


class DataWindow(ResponseModel):
    first_trade_date: date | None
    last_trade_date: date | None


class AnalyticsResponse(DataResponse):
    configuration: dict[str, Any]
    normalization: NormalizationBasis
    data_window: DataWindow
    units: dict[str, str]
    assumptions: list[str]


class SpreadRow(ResponseModel):
    trade_date: date
    pair: str
    expiry_a: date
    expiry_b_used: list[date]
    days_mismatch: list[int]
    a_p10_999: float | None
    b_p10_999: float | None
    spread_abs: float | None
    spread_pct: float | None
    roll_mean: float | None
    roll_std: float | None
    z: float | None
    percentile: float | None
    source_tradable: bool
    reason: str
    liquidity_ok: bool
    liquidity_reason: str
    executable_pair: bool
    analytics_only: bool
    comparison_type: str


class SpreadSeries(ResponseModel):
    expiry_a: date
    rows: list[SpreadRow]
    latest: SpreadRow
    description: str


class SpreadsResponse(AnalyticsResponse):
    convention: str = "A minus B"
    maturity_definition: str
    series: list[SpreadSeries]


class CurvePoint(ResponseModel):
    trade_date: date
    product: str
    expiry_date: date
    days_to_expiry: int
    close_p10_raw: float | None
    close_p10_999: float | None
    has_trade: bool
    volume_grams: float | None
    open_interest_grams: float | None
    quality_reason: str


class CurveResponse(AnalyticsResponse):
    selected_date: date | None
    points: list[CurvePoint]


class RolldownRow(ResponseModel):
    trade_date: date
    previous_trade_date: date
    product: str
    expiry_date: date
    next_expiry_used: date | None
    elapsed_days: int
    previous_price: float | None
    current_price: float | None
    slope_per_day: float | None
    raw_change: float | None
    estimated_roll_down: float | None
    residual_change: float | None
    decomposition_valid: bool
    reason: str


class RolldownSeries(ResponseModel):
    expiry_date: date
    rows: list[RolldownRow]


class RolldownResponse(AnalyticsResponse):
    valid_count: int
    invalid_count: int
    explanation: str
    series: list[RolldownSeries]


class BacktestExpiry(ResponseModel):
    expiry: date
    configuration: dict[str, Any]
    metrics: dict[str, Any]
    verdict: str
    equity_curve: list[dict[str, Any]]
    completed_trades: list[dict[str, Any]]
    open_positions: list[dict[str, Any]]
    unresolved_positions: list[dict[str, Any]]
    pending_orders: list[dict[str, Any]]
    order_events: list[dict[str, Any]]
    diagnostics: list[dict[str, Any]]
    cost_sensitivity: list[dict[str, Any]]
    cost_tolerance: dict[str, Any]
    reference_capital: float
    assumptions: list[str]


class BacktestResponse(AnalyticsResponse):
    aggregation: str = "Independent expiry simulations; no portfolio aggregation"
    reports: list[BacktestExpiry]
