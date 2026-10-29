"""Public response schemas; non-finite numeric values serialize as null."""

from datetime import date
from math import isfinite

import numpy as np
from pydantic import BaseModel, model_validator


def json_safe(value):
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, np.generic):
        return json_safe(value.item())
    if isinstance(value, float) and not isfinite(value):
        return None
    return value


class ResponseModel(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def sanitize(cls, value):
        return json_safe(value)


class NormalizationBasis(ResponseModel):
    unit: str
    basis: str
    base_grams: float
    base_purity: float
    quote_grams: dict[str, int]
    purity_assumptions: dict[str, int]
    purity_verification_status: str = "unverified"
    default_purity_adjustment: bool = False
    purity_adjustment_label: str = "Experimental; off by default"
    comparison_basis_status: str = "provisional"
    comparison_basis_warning: str = (
        "Delivery purity alone does not establish a quoted-price multiplier. "
        "GOLDPETAL is ex-Mumbai; other gold products are ex-Ahmedabad. "
        "Normalized gaps do not establish equivalent executable prices."
    )


class DataResponse(ResponseModel):
    data_as_of: date | None
    data_available: bool
    message: str | None = None


class MetaResponse(DataResponse):
    first_trade_date: date | None
    last_trade_date: date | None
    trading_session_count: int
    supported_products: list[str]
    available_products: list[str]
    contract_counts_by_product: dict[str, int]
    prototype_window: bool = True
    normalization: NormalizationBasis


class Reference(ResponseModel):
    product: str
    reference_available: bool
    selection_reason: str
    expiry_date: date | None = None
    days_to_expiry: int | None = None
    trade_date: date | None = None
    close_p10_raw: float | None = None
    close_p10_999: float | None = None
    volume_grams: float | None = None
    open_interest_grams: float | None = None
    has_trade: bool | None = None
    previous_comparison_date: date | None = None
    day_change_abs: float | None = None
    day_change_pct: float | None = None
    change_quality: str = "unavailable"
    change_reason: str = "no_reference"


class UpcomingExpiry(ResponseModel):
    product: str
    expiry_date: date
    days_to_expiry: int
    has_trade: bool
    volume_grams: float | None
    open_interest_grams: float | None
    quality_reason: str


class OverviewResponse(DataResponse):
    purity_adjustment: bool
    normalization: NormalizationBasis
    reference_selection_rule: str
    day_change_basis: str
    references: list[Reference]
    upcoming_expiries: list[UpcomingExpiry]


class PricePoint(ResponseModel):
    trade_date: date
    expiry_date: date
    close_p10_raw: float | None
    close_p10_999: float | None
    has_trade: bool
    quality_reason: str


class PriceSeries(ResponseModel):
    product: str
    reference_available: bool
    selection_reason: str
    expiry_date: date | None
    history: list[PricePoint]


class PricesResponse(DataResponse):
    series_type: str = "fixed_expiry"
    purity_adjustment: bool
    normalization: NormalizationBasis
    reference_selection_rule: str
    series: list[PriceSeries]


class FileDiagnostic(ResponseModel):
    file_name: str
    trade_date: date | None
    status: str
    rows_total: int
    rows_kept: int
    notes_recorded: bool
    notes_available: bool = False
    error_summary: str | None = None
    notes_unavailable_reason: str = (
        "Free-form notes withheld to protect local paths and database details."
    )
    recorded_dates_in_notes: list[date]


class ObservationDiagnostic(ResponseModel):
    product: str
    trade_date: date
    expiry_date: date
    volume_grams: float | None
    open_interest_grams: float | None
    has_trade: bool


class FileDiagnosticPage(ResponseModel):
    available: bool
    unavailable_reason: str | None
    definition: str
    total_count: int
    returned_count: int
    truncated: bool
    items: list[FileDiagnostic]


class ObservationDiagnosticPage(ResponseModel):
    available: bool
    unavailable_reason: str | None
    definition: str
    total_count: int
    returned_count: int
    truncated: bool
    items: list[ObservationDiagnostic]


class DiagnosticAvailability(ResponseModel):
    available: bool
    reason: str


class IngestionAttempt(ResponseModel):
    id: int
    recorded_at: str
    file_name: str
    trade_date: date | None
    status: str
    rows_total: int
    rows_kept: int
    error_summary: str | None


class VolumeMismatch(ResponseModel):
    attempt_id: int
    symbol: str
    trade_date: date
    expiry_date: date
    text_grams: str | None
    volume_grams: int
    reason: str


class IngestionAttemptPage(ResponseModel):
    available: bool
    unavailable_reason: str | None
    definition: str
    total_count: int
    returned_count: int
    truncated: bool
    items: list[IngestionAttempt]


class VolumeMismatchPage(ResponseModel):
    available: bool
    unavailable_reason: str | None
    definition: str
    total_count: int
    returned_count: int
    truncated: bool
    items: list[VolumeMismatch]


class DataHealthResponse(DataResponse):
    file_records_available: bool
    recorded_file_count: int
    file_status_counts: dict[str, int]
    database_session_count: int
    database_observation_count: int
    zero_volume_counts_by_product: dict[str, int]
    no_trade_counts_by_product: dict[str, int]
    thin_volume_counts_by_product: dict[str, int]
    min_volume_grams: float
    diagnostic_limit: int
    recorded_files: FileDiagnosticPage
    rejected_files: FileDiagnosticPage
    date_mismatch_files: FileDiagnosticPage
    no_trade_observations: ObservationDiagnosticPage
    thin_volume_observations: ObservationDiagnosticPage
    unavailable_diagnostics: dict[str, DiagnosticAvailability]
    assumptions: list[str]
    # Optional additions preserve historical snapshots without these tables/fields.
    ingestion_history: IngestionAttemptPage | None = None
    volume_mismatches: VolumeMismatchPage | None = None
