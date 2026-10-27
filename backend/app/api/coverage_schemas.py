"""Observed historical coverage; no inferred exchange calendar or contract roster."""

from datetime import date

from app.api.analytics_schemas import DataWindow
from app.api.schemas import DataResponse, ResponseModel


class CoverageConfiguration(ResponseModel):
    start: date
    end: date
    product: str | None


class CoverageCounts(ResponseModel):
    observation_count: int
    distinct_contract_count: int
    no_trade_count: int
    zero_volume_count: int
    thin_volume_count: int
    invalid_close_count: int


class ProductCoverage(CoverageCounts):
    product: str


class CoverageObservation(ResponseModel):
    product: str
    expiry_date: date
    has_trade: bool
    volume_lots: int
    volume_grams: float | None
    open_interest_grams: float | None
    no_trade: bool
    zero_volume: bool
    thin_volume: bool
    invalid_close: bool


class CoverageIngestion(ResponseModel):
    file_name: str
    trade_date: date | None
    status: str
    rows_total: int
    rows_kept: int
    error_summary: str | None


class CoverageDay(CoverageCounts):
    date: date
    products: list[ProductCoverage]
    observations: list[CoverageObservation]
    ingestion_count: int | None
    ingestions: list[CoverageIngestion]
    ingestions_truncated: bool


class CoverageResponse(DataResponse):
    configuration: CoverageConfiguration
    data_window: DataWindow
    supported_products: list[str]
    counts: CoverageCounts
    min_volume_grams: float
    days: list[CoverageDay]
    expected_coverage_available: bool
    expected_contract_count: int | None
    missing_contract_count: int | None
    expected_coverage_reason: str
    official_calendar_available: bool
    file_records_available: bool
    ingestion_record_limit: int
    undated_ingestion_count: int | None
    undated_ingestions: list[CoverageIngestion]
    undated_ingestions_truncated: bool
    definitions: dict[str, str]
    limitations: list[str]
