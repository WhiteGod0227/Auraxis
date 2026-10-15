"""Read-only metadata, fixed-expiry prices and recorded data diagnostics."""

import re
from math import isfinite

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import inspect, select

from app.analytics.normalize import normalize_prices
from app.api.database import get_connection
from app.api.schemas import (
    DataHealthResponse,
    MetaResponse,
    OverviewResponse,
    PricesResponse,
)
from app.core.config import Settings, get_settings
from app.data.loader import bhav, data_health

router = APIRouter(prefix="/api", tags=["research data"])
SELECTION_RULE = (
    "On the global latest database trade date, select the nearest expiry with "
    "has_trade=True, finite positive close and normalized prices, and at least "
    "3 calendar days to expiry. Never substitute an earlier trade date."
)


def _read(connection, table):
    available = connection is not None and inspect(connection).has_table(table.name)
    return (
        pd.read_sql(select(table), connection)
        if available
        else pd.DataFrame(columns=[column.name for column in table.columns])
    ), available


def _base(frame):
    latest = None if frame.empty else frame.trade_date.max()
    return dict(
        data_as_of=latest,
        data_available=not frame.empty,
        message="No stored market observations." if frame.empty else None,
    )


def _basis(settings):
    return dict(
        unit=f"Rs per {settings.base_grams:g} g",
        basis=f"{settings.base_purity:g} purity",
        base_grams=settings.base_grams,
        base_purity=settings.base_purity,
        quote_grams=settings.quote_grams,
        purity_assumptions=settings.purity,
        purity_verification_status="unverified",
        default_purity_adjustment=False,
        comparison_basis_status="provisional",
        comparison_basis_warning=(
            "Delivery purity alone does not establish a quoted-price multiplier. "
            "GOLDPETAL is ex-Mumbai; other gold products are ex-Ahmedabad. "
            "Normalized gaps do not establish equivalent executable prices."
        ),
    )


def _valid_price(row):
    return all(
        pd.notna(row[name]) and isfinite(row[name]) and row[name] > 0
        for name in ("close_p10_raw", "close_p10_999")
    )


def _quality(row, settings):
    if not row.has_trade:
        return "no_trade"
    if not _valid_price(row):
        return "invalid_price"
    if row.volume_grams < settings.api_min_volume_grams:
        return "thin_volume"
    return ""


def _normalized(frame, settings, purity):
    return normalize_prices(
        frame.loc[frame.symbol.isin(settings.bhavcopy_symbols)],
        price_cols=("close",),
        settings=settings,
        use_purity_adjustment=purity,
    )


def _references(frame, normalized, settings):
    dates = sorted(frame.trade_date.unique())
    latest = dates[-1] if dates else None
    previous = dates[-2] if len(dates) > 1 else None
    references = []
    for product in settings.bhavcopy_symbols:
        reference = dict(
            product=product,
            reference_available=False,
            selection_reason="no_database_observations",
        )
        if latest is None:
            references.append(reference)
            continue
        rows = normalized.loc[
            (normalized.symbol == product) & (normalized.trade_date == latest)
        ].sort_values("expiry_date")
        eligible = [
            row
            for _, row in rows.iterrows()
            if row.has_trade
            and _valid_price(row)
            and (row.expiry_date - latest).days >= 3
        ]
        if not eligible:
            reference["selection_reason"] = (
                "no_observation_latest_date" if rows.empty else "no_eligible_contract"
            )
            references.append(reference)
            continue
        current = eligible[0]
        reference.update(
            reference_available=True,
            selection_reason="selected",
            expiry_date=current.expiry_date,
            trade_date=latest,
            days_to_expiry=(current.expiry_date - latest).days,
            close_p10_raw=current.close_p10_raw,
            close_p10_999=current.close_p10_999,
            has_trade=bool(current.has_trade),
            volume_grams=current.volume_grams,
            open_interest_grams=current.open_interest_grams,
            previous_comparison_date=previous,
            change_quality="unavailable",
            change_reason="no_previous_database_session",
        )
        past = normalized.loc[
            (normalized.symbol == product)
            & (normalized.expiry_date == current.expiry_date)
            & (normalized.trade_date == previous)
        ]
        if previous is not None:
            if past.empty:
                reference["change_reason"] = "missing_previous_observation"
            elif not past.iloc[0].has_trade:
                reference["change_reason"] = "previous_no_trade"
            elif not _valid_price(past.iloc[0]):
                reference["change_reason"] = "previous_invalid_price"
            else:
                previous_price = past.iloc[0].close_p10_999
                change = current.close_p10_999 - previous_price
                reference.update(
                    day_change_abs=change,
                    day_change_pct=100 * change / previous_price,
                    change_quality="traded_same_expiry",
                    change_reason="",
                )
        references.append(reference)
    return references


@router.get("/meta", response_model=MetaResponse)
def meta(
    connection=Depends(get_connection), settings: Settings = Depends(get_settings)
):
    frame, _ = _read(connection, bhav)
    counts = {product: 0 for product in settings.bhavcopy_symbols}
    if not frame.empty:
        counts.update(frame.groupby("symbol").expiry_date.nunique().to_dict())
    return dict(
        **_base(frame),
        first_trade_date=None if frame.empty else frame.trade_date.min(),
        last_trade_date=None if frame.empty else frame.trade_date.max(),
        trading_session_count=int(frame.trade_date.nunique()),
        supported_products=settings.bhavcopy_symbols,
        available_products=sorted(frame.symbol.unique().tolist()),
        contract_counts_by_product=counts,
        prototype_window=True,
        normalization=_basis(settings),
    )


@router.get("/overview", response_model=OverviewResponse)
def overview(
    purity: bool = False,
    connection=Depends(get_connection),
    settings: Settings = Depends(get_settings),
):
    frame, _ = _read(connection, bhav)
    normalized = _normalized(frame, settings, purity)
    base = _base(frame)
    latest = base["data_as_of"]
    upcoming = []
    if latest is not None:
        for _, row in (
            normalized.loc[normalized.trade_date == latest]
            .sort_values(["symbol", "expiry_date"])
            .iterrows()
        ):
            days = (row.expiry_date - latest).days
            if days >= 0:
                upcoming.append(
                    dict(
                        product=row.symbol,
                        expiry_date=row.expiry_date,
                        days_to_expiry=days,
                        has_trade=bool(row.has_trade),
                        volume_grams=row.volume_grams,
                        open_interest_grams=row.open_interest_grams,
                        quality_reason=_quality(row, settings),
                    )
                )
    return dict(
        **base,
        purity_adjustment=purity,
        normalization=_basis(settings),
        reference_selection_rule=SELECTION_RULE,
        day_change_basis="close_p10_999; same fixed expiry, previous database session",
        references=_references(frame, normalized, settings),
        upcoming_expiries=upcoming,
    )


@router.get("/prices", response_model=PricesResponse)
def prices(
    product: str | None = None,
    purity: bool = False,
    connection=Depends(get_connection),
    settings: Settings = Depends(get_settings),
):
    if product is not None and product not in settings.bhavcopy_symbols:
        raise HTTPException(status_code=422, detail="Unsupported product.")
    frame, _ = _read(connection, bhav)
    normalized = _normalized(frame, settings, purity)
    series = []
    for reference in _references(frame, normalized, settings):
        if product is not None and reference["product"] != product:
            continue
        history = []
        selected = reference.get("expiry_date")
        if selected is not None:
            rows = normalized.loc[
                (normalized.symbol == reference["product"])
                & (normalized.expiry_date == selected)
            ].sort_values("trade_date")
            for _, row in rows.iterrows():
                history.append(
                    dict(
                        trade_date=row.trade_date,
                        expiry_date=row.expiry_date,
                        close_p10_raw=row.close_p10_raw,
                        close_p10_999=row.close_p10_999,
                        has_trade=bool(row.has_trade),
                        quality_reason=_quality(row, settings),
                    )
                )
        series.append(
            dict(
                product=reference["product"],
                reference_available=reference["reference_available"],
                selection_reason=reference["selection_reason"],
                expiry_date=selected,
                history=history,
            )
        )
    return dict(
        **_base(frame),
        purity_adjustment=purity,
        normalization=_basis(settings),
        series_type="fixed_expiry",
        reference_selection_rule=SELECTION_RULE,
        series=series,
    )


def _page(items, available, definition, limit, reason):
    return dict(
        available=available,
        unavailable_reason=None if available else reason,
        definition=definition,
        total_count=len(items),
        returned_count=min(len(items), limit),
        truncated=len(items) > limit,
        items=items[:limit],
    )


def _counts(frame, mask, products):
    counts = {product: 0 for product in products}
    counts.update(frame.loc[mask].groupby("symbol").size().to_dict())
    return counts


def _safe_ingestion_error(status, notes):
    if status == "date_mismatch":
        return "CSV observation dates do not match the filename date."
    if status != "error":
        return None
    # Only fixed allowlisted messages cross the public boundary, never notes.
    for prefix, message in (
        ("Expected filename", "Filename must be BhavCopyDateWise_DDMMYYYY.csv."),
        ("Missing CSV columns", "Required CSV columns are missing."),
        ("Duplicate (symbol", "Duplicate contract/date keys in the CSV."),
        ("Non-finite", "A numeric CSV field contains infinity."),
        (
            "SQLite persistence failed",
            "Database persistence failed; no partial import.",
        ),
        ("volume_lots must", "Volume lots must be nonnegative integers."),
        ("open_interest_lots must", "Open interest lots must be nonnegative integers."),
        ("time data", "A date does not match the required CSV date format."),
    ):
        if notes.startswith(prefix):
            return message
    return "CSV import failed; detailed local notes are withheld."


@router.get("/data-health", response_model=DataHealthResponse)
def health_data(
    min_volume_grams: float | None = Query(default=None, ge=0, allow_inf_nan=False),
    diagnostic_limit: int = Query(default=20, ge=1, le=100),
    connection=Depends(get_connection),
    settings: Settings = Depends(get_settings),
):
    threshold = (
        settings.api_min_volume_grams if min_volume_grams is None else min_volume_grams
    )
    frame, observations_available = _read(connection, bhav)
    files, files_available = _read(connection, data_health)
    file_items = []
    for row in files.sort_values("file_name").itertuples():
        notes = row.notes or ""
        file_items.append(
            dict(
                file_name=row.file_name.replace("\\", "/").split("/")[-1],
                trade_date=row.trade_date,
                status=row.status,
                rows_total=row.rows_total,
                rows_kept=row.rows_kept,
                notes_recorded=bool(notes),
                notes_available=False,
                error_summary=_safe_ingestion_error(row.status, notes),
                recorded_dates_in_notes=sorted(
                    set(re.findall(r"\b\d{4}-\d{2}-\d{2}\b", notes))
                ),
            )
        )
    # No loader row-level validation flags exist; never imply comprehensive validation.
    no_trade_mask = frame.has_trade == False  # noqa: E712
    thin_mask = frame.volume_grams < threshold

    def observation_items(mask):
        return [
            dict(
                product=row.symbol,
                trade_date=row.trade_date,
                expiry_date=row.expiry_date,
                volume_grams=row.volume_grams,
                open_interest_grams=row.open_interest_grams,
                has_trade=bool(row.has_trade),
            )
            for row in frame.loc[mask]
            .sort_values(["trade_date", "symbol", "expiry_date"])
            .itertuples()
        ]

    unavailable = dict(
        row_level_validation=dict(
            available=False,
            reason="Loader does not persist row-level validation flags.",
        ),
        structured_volume_mismatches=dict(
            available=False,
            reason=(
                "Volume warnings are free-form file notes; no structured per-row "
                "mismatch table exists."
            ),
        ),
        mcx_contract_spec_verification=dict(
            available=False, reason="Purity and contract assumptions remain unverified."
        ),
        raw_response_or_block_diagnostics=dict(
            available=False,
            reason="CSV loader does not record HTTP response or blocking diagnostics.",
        ),
    )
    return dict(
        **_base(frame),
        file_records_available=files_available,
        recorded_file_count=len(files),
        file_status_counts=files.status.value_counts().to_dict(),
        database_session_count=int(frame.trade_date.nunique()),
        database_observation_count=len(frame),
        zero_volume_counts_by_product=_counts(
            frame, frame.volume_lots == 0, settings.bhavcopy_symbols
        ),
        no_trade_counts_by_product=_counts(
            frame, no_trade_mask, settings.bhavcopy_symbols
        ),
        thin_volume_counts_by_product=_counts(
            frame, thin_mask, settings.bhavcopy_symbols
        ),
        min_volume_grams=threshold,
        diagnostic_limit=diagnostic_limit,
        recorded_files=_page(
            file_items,
            files_available,
            "All recorded data_health rows, ordered by filename.",
            diagnostic_limit,
            "No recorded data_health table.",
        ),
        rejected_files=_page(
            [
                item
                for item in file_items
                if item["status"] in {"error", "date_mismatch"}
            ],
            files_available,
            "Recorded files with error or date_mismatch status.",
            diagnostic_limit,
            "No recorded data_health table.",
        ),
        date_mismatch_files=_page(
            [item for item in file_items if item["status"] == "date_mismatch"],
            files_available,
            "Recorded files with date_mismatch status.",
            diagnostic_limit,
            "No recorded data_health table.",
        ),
        no_trade_observations=_page(
            observation_items(no_trade_mask),
            observations_available,
            "Stored observations with has_trade=False, ordered by date/product/expiry.",
            diagnostic_limit,
            "No bhav table.",
        ),
        thin_volume_observations=_page(
            observation_items(thin_mask),
            observations_available,
            (
                "Stored observations with volume_grams strictly below threshold; "
                "includes zero volume."
            ),
            diagnostic_limit,
            "No bhav table.",
        ),
        unavailable_diagnostics=unavailable,
        assumptions=[
            (
                "CSV filename DDMMYYYY is checked against every row Date parsed "
                "as %d %b %Y."
            ),
            (
                "Expiry Date uses %d%b%Y; symbols are stripped; configured FUTCOM "
                "gold products only."
            ),
            (
                "volume_grams and open_interest_grams are lots multiplied by "
                "configured lot_grams."
            ),
            (
                "Volume text is retained; mismatch warnings do not drop rows and "
                "are not structured diagnostics."
            ),
            (
                "Purity assumptions are unverified; close/settlement is not an "
                "executable price."
            ),
            (
                "File status ok does not establish full market-data or "
                "contract-spec validation."
            ),
            (
                "Only the latest file status is retained per filename; "
                "processing-attempt history is unavailable."
            ),
            (
                "Free-form notes are withheld; ISO dates extracted from notes are "
                "reported without inferred attribution."
            ),
        ],
    )
