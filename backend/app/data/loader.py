"""Load manually downloaded MCX CSVs into SQLite, preserving every expiry."""

import argparse
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
from sqlalchemy import (
    Boolean,
    Column,
    Date,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
)
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import BACKEND_DIR, Settings, get_settings
from app.core.logging import setup_logging

logger = logging.getLogger(__name__)
KEY = ["symbol", "expiry_date", "trade_date"]
RENAME = {
    "Symbol": "symbol",
    "Date": "trade_date",
    "Expiry Date": "expiry_date",
    "Open": "open",
    "High": "high",
    "Low": "low",
    "Close": "close",
    "Previous Close": "previous_close",
    "Volume(Lots)": "volume_lots",
    "Volume(In 000's)": "volume_text",
    "Value(Lacs)": "value_lacs",
    "Open Interest(Lots)": "open_interest_lots",
}
COLUMNS = [*RENAME.values(), "volume_grams", "open_interest_grams", "has_trade"]
metadata = MetaData()
bhav = Table(
    "bhav",
    metadata,
    Column("symbol", String, primary_key=True),
    Column("expiry_date", Date, primary_key=True),
    Column("trade_date", Date, primary_key=True),
    *[
        Column(name, Float)
        for name in ("open", "high", "low", "close", "previous_close", "value_lacs")
    ],
    Column("volume_lots", Integer, nullable=False),
    Column("volume_text", Text, nullable=False),
    Column("open_interest_lots", Integer, nullable=False),
    Column("volume_grams", Integer, nullable=False),
    Column("open_interest_grams", Integer, nullable=False),
    Column("has_trade", Boolean, nullable=False),
)
data_health = Table(
    "data_health",
    metadata,
    Column("file_name", String, primary_key=True),
    Column("trade_date", Date),
    Column("status", String, nullable=False),
    Column("rows_total", Integer, nullable=False),
    Column("rows_kept", Integer, nullable=False),
    Column("notes", Text, nullable=False),
)


@dataclass
class LoadResult:
    file_name: str
    trade_date: date | None = None
    status: Literal["ok", "date_mismatch", "error", "no_gold_rows"] = "error"
    rows_total: int = 0
    rows_kept: int = 0
    notes: str = ""
    dataframe: pd.DataFrame = field(
        default_factory=lambda: pd.DataFrame(columns=COLUMNS)
    )


def create_loader_engine(settings: Settings) -> Engine:
    url = make_url(settings.database_url)
    if url.get_backend_name() != "sqlite":
        raise ValueError("The file loader requires SQLite")
    if url.database and url.database != ":memory:":
        path = Path(url.database)
        if not path.is_absolute():
            path = BACKEND_DIR / path
        path.parent.mkdir(parents=True, exist_ok=True)
        url = url.set(database=str(path))
    return create_engine(url)


def _parse(path: Path, settings: Settings, result: LoadResult) -> None:
    match = re.fullmatch(r"BhavCopyDateWise_(\d{8})\.csv", path.name)
    if not match:
        raise ValueError("Expected filename BhavCopyDateWise_DDMMYYYY.csv")
    result.trade_date = datetime.strptime(match[1], "%d%m%Y").date()
    # Read strings to preserve volume text and avoid treating option NaNs as errors.
    raw = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    raw.columns = raw.columns.str.strip()
    result.rows_total = len(raw)
    required = set(RENAME) | {"Instrument Name", "Option Type", "Strike Price"}
    missing = required - set(raw.columns)
    if missing:
        raise ValueError(f"Missing CSV columns: {', '.join(sorted(missing))}")
    dates = [
        datetime.strptime(value.strip(), "%d %b %Y").date() for value in raw["Date"]
    ]
    if any(value != result.trade_date for value in dates):
        result.status = "date_mismatch"
        result.notes = (
            f"Filename date {result.trade_date}; returned dates "
            + ", ".join(value.isoformat() for value in sorted(set(dates)))
        )
        return
    raw["Symbol"] = raw["Symbol"].str.strip()
    selected = raw.loc[
        (raw["Instrument Name"].str.strip() == "FUTCOM")
        & raw["Symbol"].isin(settings.bhavcopy_symbols)
    ].copy()
    if selected.empty:
        result.status = "no_gold_rows"
        result.notes = "No configured gold FUTCOM rows"
        return
    frame = selected.rename(columns=RENAME)[list(RENAME.values())].copy()
    frame["trade_date"] = result.trade_date
    frame["expiry_date"] = [
        datetime.strptime(value.strip(), "%d%b%Y").date()
        for value in frame["expiry_date"]
    ]
    for name in (
        "open",
        "high",
        "low",
        "close",
        "previous_close",
        "value_lacs",
        "volume_lots",
        "open_interest_lots",
    ):
        values = frame[name].str.strip().str.replace(",", "", regex=False)
        values = values.replace({"": np.nan, "NaN": np.nan, "nan": np.nan})
        frame[name] = pd.to_numeric(values, errors="raise")
        if np.isinf(frame[name]).any():
            raise ValueError(f"Non-finite {name}")
    for name in ("volume_lots", "open_interest_lots"):
        values = frame[name]
        if values.isna().any() or (values < 0).any() or (values % 1 != 0).any():
            raise ValueError(f"{name} must contain nonnegative integer lots")
        frame[name] = values.astype("int64")
    lots = frame["symbol"].map(settings.lot_grams)
    if lots.isna().any() or (lots <= 0).any():
        raise ValueError("Missing or nonpositive lot_grams for a configured symbol")
    frame["volume_grams"] = (frame["volume_lots"] * lots).astype("int64")
    frame["open_interest_grams"] = (frame["open_interest_lots"] * lots).astype("int64")
    # A settlement price on a zero-volume day is not a traded/executable price.
    frame["has_trade"] = frame["volume_lots"] > 0
    if frame.duplicated(KEY).any():
        raise ValueError("Duplicate (symbol, expiry_date, trade_date) in CSV")
    warnings = []
    for row in frame.to_dict("records"):
        number = re.match(r"^\s*([\d,]+(?:\.\d+)?)\s+\S+", row["volume_text"])
        try:
            text_grams = Decimal(number[1].replace(",", "")) * 1000 if number else None
        except InvalidOperation:
            text_grams = None
        if text_grams is None or text_grams != Decimal(int(row["volume_grams"])):
            warning = (
                f"volume mismatch: {row['symbol']} {row['expiry_date']} "
                f"volume_text={row['volume_text']!r}, "
                f"lots-derived grams={row['volume_grams']}"
            )
            warnings.append(warning)
            logger.warning("%s: %s", path.name, warning)
    result.status = "ok"
    result.rows_kept = len(frame)
    result.notes = "\n".join(warnings)
    result.dataframe = frame[COLUMNS]


def _store(engine: Engine, result: LoadResult) -> None:
    metadata.create_all(engine)
    with engine.begin() as connection:
        if result.status == "ok":
            records = (
                result.dataframe.astype(object)
                .where(result.dataframe.notna(), None)
                .to_dict("records")
            )
            statement = insert(bhav)
            connection.execute(
                statement.on_conflict_do_update(
                    index_elements=KEY,
                    set_={
                        column.name: statement.excluded[column.name]
                        for column in bhav.columns
                        if column.name not in KEY
                    },
                ),
                records,
            )
        statement = insert(data_health)
        connection.execute(
            statement.on_conflict_do_update(
                index_elements=["file_name"],
                set_={
                    column.name: statement.excluded[column.name]
                    for column in data_health.columns
                    if column.name != "file_name"
                },
            ),
            {
                "file_name": result.file_name,
                "trade_date": result.trade_date,
                "status": result.status,
                "rows_total": result.rows_total,
                "rows_kept": result.rows_kept,
                "notes": result.notes,
            },
        )


def load_file(
    path: Path | str, *, settings: Settings | None = None, engine: Engine | None = None
) -> LoadResult:
    settings = settings or get_settings()
    path = Path(path)
    result = LoadResult(path.name)
    try:
        _parse(path, settings, result)
    except (OSError, ValueError, TypeError, OverflowError) as exc:
        result.status = "error"
        result.notes = str(exc)
    owned_engine = engine is None
    try:
        engine = engine if engine is not None else create_loader_engine(settings)
        try:
            _store(engine, result)
        except SQLAlchemyError as exc:
            # The transaction rolls back bhav if either upsert fails.
            result.status = "error"
            result.notes = f"SQLite persistence failed: {exc}"
            result.rows_kept = 0
            result.dataframe = pd.DataFrame(columns=COLUMNS)
            _store(engine, result)
    finally:
        if owned_engine and engine is not None:
            engine.dispose()
    logger.log(
        logging.INFO if result.status == "ok" else logging.WARNING,
        "%s status=%s trade_date=%s rows_kept=%s %s",
        path.name,
        result.status,
        result.trade_date,
        result.rows_kept,
        result.notes,
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, required=True)
    args = parser.parse_args()
    setup_logging()
    directory = args.dir
    if not directory.is_absolute():
        directory = BACKEND_DIR / directory
    if not directory.is_dir():
        parser.exit(1, f"CSV directory does not exist: {directory}\n")
    paths = sorted(directory.glob("BhavCopyDateWise_*.csv"))
    if not paths:
        print(f"No Bhavcopy CSV files found in {directory}")
        raise SystemExit(1)
    settings = get_settings()
    engine = create_loader_engine(settings)
    failed = False
    try:
        for path in paths:
            result = load_file(path, settings=settings, engine=engine)
            print(
                f"{path.name}: status={result.status} trade_date={result.trade_date} "
                f"rows_total={result.rows_total} rows_kept={result.rows_kept}"
            )
            for symbol in settings.bhavcopy_symbols:
                rows = result.dataframe.loc[result.dataframe["symbol"] == symbol]
                print(f"  {symbol}: {len(rows)}")
            for row in result.dataframe.loc[
                result.dataframe["has_trade"] == False  # noqa: E712
            ].to_dict("records"):
                print(f"  {row['symbol']} {row['expiry_date']}: has_trade=False")
            if result.notes:
                print(f"  notes: {result.notes}")
            failed |= result.status in {"error", "date_mismatch"}
    finally:
        engine.dispose()
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
