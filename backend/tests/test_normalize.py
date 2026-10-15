from datetime import date

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine

from app.analytics.normalize import (
    PRICE_COLS,
    cross_contract_snapshot,
    normalize_prices,
)
from app.core.config import Settings
from app.data.loader import bhav, metadata


@pytest.fixture
def settings():
    return Settings(_env_file=None)


@pytest.fixture
def prices():
    frame = pd.DataFrame(
        {
            "symbol": ["GOLDPETAL", "GOLDGUINEA", "GOLDTEN", "GOLDM"],
            "close": [15002.0, 119993.0, 149436.0, 149055.0],
            "has_trade": [True, True, True, False],
        }
    )
    for column in PRICE_COLS:
        frame[column] = frame["close"]
    return frame


def test_hand_computed_values_and_no_mutation(prices, settings):
    original = prices.copy(deep=True)
    result = normalize_prices(prices, settings=settings, use_purity_adjustment=True)
    pd.testing.assert_frame_equal(prices, original)
    for column in PRICE_COLS:
        assert result[f"{column}_p10_raw"].tolist() == [
            150020.0,
            149991.25,
            149436.0,
            149055.0,
        ]
        assert result[f"{column}_p10_999"].tolist() == pytest.approx(
            [150020.0, 149991.25, 149436.0, 149055 * 999 / 995]
        )
    pd.testing.assert_frame_equal(result[prices.columns], original)


def test_purity_switch_changes_only_goldm(prices, settings):
    adjusted = normalize_prices(prices, settings=settings, use_purity_adjustment=True)
    raw = normalize_prices(prices, settings=settings, use_purity_adjustment=False)
    for column in PRICE_COLS:
        assert raw[f"{column}_p10_999"].equals(raw[f"{column}_p10_raw"])
        assert adjusted[f"{column}_p10_raw"].equals(raw[f"{column}_p10_raw"])
        changed = adjusted[f"{column}_p10_999"] != raw[f"{column}_p10_999"]
        assert changed.tolist() == [False, False, False, True]


def test_nan_prices(prices, settings):
    prices.loc[0, list(PRICE_COLS)] = np.nan
    result = normalize_prices(prices, settings=settings, use_purity_adjustment=True)
    for column in PRICE_COLS:
        assert pd.isna(result.loc[0, f"{column}_p10_raw"])
        assert pd.isna(result.loc[0, f"{column}_p10_999"])


def test_unknown_symbol(prices, settings):
    prices.loc[0, "symbol"] = "GOLD"
    with pytest.raises(ValueError, match="Unknown symbol.*GOLD"):
        normalize_prices(prices, settings=settings)


def test_configurable_base_and_contract(prices, settings):
    settings.quote_grams["GOLDPETAL"] = 2
    settings.base_grams = 20
    settings.base_purity = 995
    result = normalize_prices(prices, settings=settings, use_purity_adjustment=True)
    assert result.loc[0, "close_p10_raw"] == 150020
    assert result.loc[0, "close_p10_999"] == pytest.approx(150020 * 995 / 999)


@pytest.fixture
def engine(prices):
    instance = create_engine("sqlite:///:memory:")
    metadata.create_all(instance)
    rows = []
    for row in prices.to_dict("records"):
        row.update(
            trade_date=date(2026, 10, 1),
            expiry_date=date(2026, 10, 5)
            if row["symbol"] == "GOLDM"
            else date(2026, 10, 30),
            volume_lots=1,
            volume_text="0.001 GRMS",
            open_interest_lots=1,
            volume_grams=1,
            open_interest_grams=1,
            value_lacs=1,
        )
        rows.append(row)
    extra = dict(rows[0], expiry_date=date(2026, 11, 30), close=0)
    rows.append(extra)
    with instance.begin() as connection:
        connection.execute(bhav.insert(), rows)
    yield instance
    instance.dispose()


def test_snapshot_exact_expiry_gaps_and_zero_reference(engine, settings):
    result = cross_contract_snapshot("2026-10-01", engine=engine, settings=settings)
    assert len(result) == 5
    october = result.loc[result.expiry_date == date(2026, 10, 30)].set_index("symbol")
    assert october.loc["GOLDTEN", "gap_vs_goldpetal_pct"] == pytest.approx(
        -0.3892814291
    )
    assert october.loc["GOLDGUINEA", "gap_vs_goldpetal_pct"] == pytest.approx(
        -0.01916411145
    )
    assert october.loc["GOLDPETAL", "gap_vs_goldpetal_pct"] == 0
    goldm = result.loc[result.symbol == "GOLDM"].iloc[0]
    assert pd.isna(goldm.gap_vs_goldpetal_pct)
    assert not goldm.has_trade
    november = result.loc[result.expiry_date == date(2026, 11, 30)].iloc[0]
    assert pd.isna(november.gap_vs_goldpetal_pct)


def test_snapshot_no_date_rows(engine, settings):
    assert cross_contract_snapshot("2026-10-02", engine=engine, settings=settings).empty
