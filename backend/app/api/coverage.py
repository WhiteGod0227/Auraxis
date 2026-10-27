"""Bounded, read-only calendar aggregation of stored observations and file dates."""

import re
from datetime import date, timedelta
from math import isfinite

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, inspect, select

from app.api.analytics import ISODate
from app.api.coverage_schemas import CoverageResponse
from app.api.database import get_connection
from app.api.foundation import _read, _safe_ingestion_error
from app.core.config import Settings, get_settings
from app.data.loader import bhav, data_health

router = APIRouter(prefix="/api", tags=["research data"])
MAX_RANGE_DAYS = 31
INGESTION_LIMIT = 100
DEFINITIONS = dict(
    observation_count="Stored rows for the selected product(s) and date/range.",
    distinct_contract_count=(
        "Distinct observed (product, expiry_date) keys in that date/range; "
        "not an expected roster."
    ),
    no_trade_count="Rows whose stored has_trade flag is false.",
    zero_volume_count=(
        "Rows whose stored volume_lots equals zero, independently of has_trade."
    ),
    thin_volume_count=(
        "Rows with finite volume_grams below the applied threshold, "
        "including zero-volume rows."
    ),
    invalid_close_count=(
        "Rows with missing, non-finite or non-positive stored close/settlement."
    ),
    ingestion_date=(
        "Persisted data_health.trade_date (file-declared date); not proof of "
        "valid market observations. Null dates are never inferred from "
        "filenames or notes."
    ),
    ingestion_scope=(
        "File-wide records, not attributable to individual products; "
        "unaffected by the product filter."
    ),
    undated_ingestions=(
        "All recorded files without a persisted trade date, across the database; "
        "not assigned to this month or any day."
    ),
)


def validate_range(start, end):
    if start > end or (end - start).days >= MAX_RANGE_DAYS:
        raise HTTPException(422, "Require start <= end and at most 31 inclusive days.")


def _finite(value):
    return pd.notna(value) and isfinite(value)


def _counts(frame):
    return dict(
        observation_count=len(frame),
        distinct_contract_count=len(frame[["symbol", "expiry_date"]].drop_duplicates()),
        **{
            f"{flag}_count": int(frame[flag].sum())
            for flag in ("no_trade", "zero_volume", "thin_volume", "invalid_close")
        },
    )


def _ingestion(row):
    name = row.file_name.replace("\\", "/").split("/")[-1]
    # Do not echo arbitrary malformed filenames, private paths or raw notes.
    name = (
        name
        if re.fullmatch(r"BhavCopyDateWise_\d{8}\.csv", name, re.IGNORECASE)
        else "Unrecognized CSV filename"
    )
    status = (
        row.status
        if row.status in {"ok", "error", "date_mismatch", "no_gold_rows"}
        else "unknown"
    )
    return dict(
        file_name=name,
        trade_date=row.trade_date,
        status=status,
        rows_total=row.rows_total,
        rows_kept=row.rows_kept,
        error_summary=_safe_ingestion_error(status, row.notes or ""),
    )


@router.get("/coverage", response_model=CoverageResponse)
def coverage(
    start: ISODate,
    end: ISODate,
    product: str | None = None,
    connection=Depends(get_connection),
    settings: Settings = Depends(get_settings),
):
    validate_range(start, end)
    if product is not None and product not in settings.bhavcopy_symbols:
        raise HTTPException(422, "Unsupported product.")
    available = connection is not None and inspect(connection).has_table("bhav")
    frame = pd.DataFrame(columns=[column.name for column in bhav.columns])
    first = latest = None
    total = 0
    if available:
        supported = bhav.c.symbol.in_(settings.bhavcopy_symbols)
        first, latest, total = connection.execute(
            select(
                func.min(bhav.c.trade_date), func.max(bhav.c.trade_date), func.count()
            ).select_from(bhav)
        ).one()
        query = select(bhav).where(
            supported, bhav.c.trade_date >= start, bhav.c.trade_date <= end
        )
        if product is not None:
            query = query.where(bhav.c.symbol == product)
        frame = pd.read_sql(
            query.order_by(bhav.c.trade_date, bhav.c.symbol, bhav.c.expiry_date),
            connection,
        )
    frame["no_trade"] = frame.has_trade == False  # noqa: E712
    frame["zero_volume"] = frame.volume_lots == 0
    frame["thin_volume"] = frame.volume_grams.map(
        lambda v: _finite(v) and v < settings.api_min_volume_grams
    )
    frame["invalid_close"] = frame.close.map(lambda v: not _finite(v) or v <= 0)
    files, files_available = _read(connection, data_health)
    file_days = {}
    undated = []
    for row in files.sort_values("file_name").itertuples():
        if pd.isna(row.trade_date):
            undated.append(_ingestion(row))
        elif start <= row.trade_date <= end:
            file_days.setdefault(row.trade_date, []).append(_ingestion(row))
    days = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        daily = frame.loc[frame.trade_date == day]
        ingestions = file_days.get(day, [])
        days.append(
            dict(
                date=day,
                **_counts(daily),
                products=[
                    dict(product=symbol, **_counts(rows))
                    for symbol, rows in daily.groupby("symbol", sort=True)
                ],
                observations=[
                    dict(
                        product=row.symbol,
                        expiry_date=row.expiry_date,
                        has_trade=bool(row.has_trade),
                        volume_lots=row.volume_lots,
                        volume_grams=row.volume_grams,
                        open_interest_grams=row.open_interest_grams,
                        **{
                            flag: bool(getattr(row, flag))
                            for flag in (
                                "no_trade",
                                "zero_volume",
                                "thin_volume",
                                "invalid_close",
                            )
                        },
                    )
                    for row in daily.itertuples()
                ],
                ingestion_count=len(ingestions) if files_available else None,
                ingestions=ingestions[:INGESTION_LIMIT],
                ingestions_truncated=len(ingestions) > INGESTION_LIMIT,
            )
        )
    return dict(
        data_as_of=latest,
        data_available=bool(total),
        message="No stored market observations."
        if not total
        else "No observations in the selected date range/product."
        if frame.empty
        else None,
        configuration=dict(start=start, end=end, product=product),
        data_window=dict(first_trade_date=first, last_trade_date=latest),
        supported_products=settings.bhavcopy_symbols,
        counts=_counts(frame),
        min_volume_grams=settings.api_min_volume_grams,
        days=days,
        expected_coverage_available=False,
        expected_contract_count=None,
        missing_contract_count=None,
        expected_coverage_reason="Expected contract coverage unavailable.",
        official_calendar_available=False,
        file_records_available=files_available,
        ingestion_record_limit=INGESTION_LIMIT,
        undated_ingestion_count=len(undated) if files_available else None,
        undated_ingestions=undated[:INGESTION_LIMIT],
        undated_ingestions_truncated=len(undated) > INGESTION_LIMIT,
        definitions=DEFINITIONS,
        limitations=[
            "Not loaded does not mean exchange holiday. "
            "No official trading calendar is integrated.",
            "No authoritative expected-contract roster exists; missing-contract "
            "counts cannot be inferred from other dates.",
            "Diagnostic categories may overlap; their sum is not a count "
            "of unique problematic rows.",
            "File records are file-wide, independent of the product filter. "
            "Undated errors remain undated.",
            "Ingestion records retain the latest status per filename, "
            "not a complete ingestion-event history.",
            "Volume mismatch warnings are unstructured file notes; structured "
            "row-level volume-mismatch counts are unavailable.",
            "Historical observations, not live market coverage "
            "or executable settlement fills.",
        ],
    )


def coverage_requests(connection, settings):
    """Exact month/product offline sets for observed or reliably dated file months."""
    months = set()
    for table in (bhav, data_health):
        if connection is not None and inspect(connection).has_table(table.name):
            query = (
                select(table.c.trade_date)
                .where(table.c.trade_date.is_not(None))
                .distinct()
            )
            if table is bhav:
                query = query.where(bhav.c.symbol.in_(settings.bhavcopy_symbols))
            months.update(day.replace(day=1) for day in connection.scalars(query))
    for first in sorted(months):
        last = (
            date(first.year, first.month + 1, 1) - timedelta(days=1)
            if first.month < 12
            else date(first.year, 12, 31)
        )
        for product in (None, *settings.bhavcopy_symbols):
            yield "/api/coverage", dict(start=first, end=last, product=product)
