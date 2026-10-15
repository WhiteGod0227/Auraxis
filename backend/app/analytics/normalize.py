"""Configurable price units and exact-expiry diagnostic snapshots only."""

from datetime import date, datetime
from math import isfinite

import pandas as pd
from sqlalchemy import select
from sqlalchemy.engine import Engine

from app.core.config import Settings, get_settings
from app.data.loader import bhav, create_loader_engine

PRICE_COLS = ("open", "high", "low", "close", "previous_close")
SNAPSHOT_COLS = [
    "symbol",
    "expiry_date",
    "close",
    "close_p10_raw",
    "close_p10_999",
    "has_trade",
    "volume_grams",
    "open_interest_grams",
    "gap_vs_goldpetal_pct",
]


def normalize_prices(
    df: pd.DataFrame,
    price_cols: tuple[str, ...] = PRICE_COLS,
    *,
    use_purity_adjustment: bool = False,
    settings: Settings | None = None,
) -> pd.DataFrame:
    """Return a copy with normalized prices; retain originals, flags and NaNs.

    With purity adjustment off, *_p10_999 equals *_p10_raw despite its name.
    Purity conversion is experimental and off by default. Explicit opt-in
    expresses the assumed 999-purity scenario. Configurable bases change those
    units while preserving the public column names.
    """
    settings = settings or get_settings()
    missing = {"symbol", *price_cols} - set(df.columns)
    if missing:
        raise ValueError(f"Missing columns: {', '.join(sorted(missing))}")
    symbols = df["symbol"].drop_duplicates().tolist()
    for symbol in symbols:
        if pd.isna(symbol) or symbol not in settings.quote_grams:
            raise ValueError(f"Unknown symbol: {symbol!r}; configure quote_grams")
        if symbol not in settings.purity:
            raise ValueError(f"Unknown symbol: {symbol!r}; configure purity")
        for label, value in (
            ("quote_grams", settings.quote_grams[symbol]),
            ("purity", settings.purity[symbol]),
        ):
            if not isfinite(value) or value <= 0:
                raise ValueError(f"{label} for {symbol} must be finite and positive")
    for label in ("base_grams", "base_purity"):
        value = getattr(settings, label)
        if not isfinite(value) or value <= 0:
            raise ValueError(f"{label} must be finite and positive")
    output = df.copy(deep=True)
    quote = output["symbol"].map(settings.quote_grams).astype(float)
    purity = output["symbol"].map(settings.purity).astype(float)
    for column in price_cols:
        prices = pd.to_numeric(output[column], errors="raise").astype(float)
        raw = prices * settings.base_grams / quote
        output[f"{column}_p10_raw"] = raw
        output[f"{column}_p10_999"] = (
            raw * settings.base_purity / purity if use_purity_adjustment else raw
        )
    return output


def cross_contract_snapshot(
    trade_date: date | str,
    *,
    use_purity_adjustment: bool = False,
    settings: Settings | None = None,
    engine: Engine | None = None,
) -> pd.DataFrame:
    """Read one date without changing SQLite; gaps are diagnostics, not signals.

    Gap = 100 * (normalized close / same-expiry GOLDPETAL close - 1).
    Missing, NaN or zero reference prices produce NaN gaps.
    """
    requested = (
        date.fromisoformat(trade_date) if isinstance(trade_date, str) else trade_date
    )
    if not isinstance(requested, date) or isinstance(requested, datetime):
        raise TypeError("trade_date must be datetime.date or ISO YYYY-MM-DD")
    settings = settings or get_settings()
    owned_engine = engine is None
    engine = engine if engine is not None else create_loader_engine(settings)
    try:
        with engine.connect() as connection:
            frame = pd.read_sql(
                select(bhav)
                .where(bhav.c.trade_date == requested)
                .order_by(bhav.c.expiry_date, bhav.c.symbol),
                connection,
            )
    finally:
        if owned_engine:
            engine.dispose()
    frame = normalize_prices(
        frame,
        price_cols=("close",),
        settings=settings,
        use_purity_adjustment=use_purity_adjustment,
    )
    if frame.duplicated(["symbol", "expiry_date"]).any():
        raise ValueError("Duplicate symbol/expiry in snapshot")
    # GOLDM normally expires around the 5th, others at month end. Do not align
    # distinct expiry dates here; that belongs to the later spread step.
    reference = frame.loc[frame["symbol"] == "GOLDPETAL"].set_index("expiry_date")
    denominator = frame["expiry_date"].map(reference["close_p10_999"])
    denominator = denominator.where(denominator != 0)
    # Settlement/close is not an executable price, including zero-volume rows.
    # Keep has_trade=False rows and their diagnostic gaps rather than dropping them.
    frame["gap_vs_goldpetal_pct"] = (frame["close_p10_999"] / denominator - 1) * 100
    return frame[SNAPSHOT_COLS]
