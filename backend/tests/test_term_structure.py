from datetime import date

import pandas as pd
import pytest
from sqlalchemy import create_engine, delete, update

from app.analytics.term_structure import (
    CURVE_COLUMNS,
    ROLLDOWN_COLUMNS,
    compute_rolldown,
    curve,
)
from app.core.config import Settings
from app.data.loader import bhav, metadata

PREVIOUS = date(2026, 10, 2)  # Friday
CURRENT = date(2026, 10, 4)  # Two calendar days, synthetic fixture only
EXPIRY = date(2026, 10, 10)
NEXT = date(2026, 10, 20)
FAR = date(2026, 10, 30)


def row(day, expiry, close, symbol="GOLDTEN", traded=True):
    return dict(
        symbol=symbol,
        trade_date=day,
        expiry_date=expiry,
        close=close,
        has_trade=traded,
        volume_lots=10,
        volume_text="0.100 GRMS",
        open_interest_lots=10,
        volume_grams=100,
        open_interest_grams=100,
    )


@pytest.fixture
def settings():
    return Settings(_env_file=None)


@pytest.fixture
def engine():
    instance = create_engine("sqlite:///:memory:")
    metadata.create_all(instance)
    with instance.begin() as connection:
        connection.execute(
            bhav.insert(),
            [
                row(PREVIOUS, NEXT, 110),
                row(PREVIOUS, EXPIRY, 100),
                row(CURRENT, NEXT, 999),
                row(CURRENT, EXPIRY, 103),
            ],
        )
    yield instance
    instance.dispose()


def roll(engine, settings, **options):
    return compute_rolldown("GOLDTEN", engine=engine, settings=settings, **options)


def test_curve_order_exact_date_and_days(engine, settings):
    result = curve("GOLDTEN", PREVIOUS, engine=engine, settings=settings)
    assert result.expiry_date.tolist() == [EXPIRY, NEXT]
    assert result.days_to_expiry.tolist() == [8, 18]
    latest = curve("GOLDTEN", engine=engine, settings=settings)
    assert set(latest.trade_date) == {CURRENT}
    missing = curve("GOLDTEN", "2026-10-03", engine=engine, settings=settings)
    assert missing.empty and list(missing.columns) == CURVE_COLUMNS


def test_hand_calculated_example(engine, settings):
    result = roll(engine, settings).iloc[0]
    assert result.previous_price == 100 and result.current_price == 103
    assert result.elapsed_days == 2
    assert result.slope_per_day == 1
    assert result.estimated_roll_down == -2
    assert result.raw_change == 3 and result.residual_change == 5
    assert result.decomposition_valid
    assert result.next_expiry_used == NEXT


@pytest.mark.parametrize("price", [0, -1])
def test_nonpositive_price_retains_raw_but_invalidates_decomposition(
    engine, settings, price
):
    with engine.begin() as connection:
        connection.execute(
            update(bhav)
            .where(bhav.c.trade_date == CURRENT, bhav.c.expiry_date == EXPIRY)
            .values(close=price)
        )
    point = curve("GOLDTEN", CURRENT, engine=engine, settings=settings).iloc[0]
    assert point.quality_reason == "invalid_price"
    result = roll(engine, settings).iloc[0]
    assert result.reason == "invalid_price" and not result.decomposition_valid
    assert result.raw_change == price - 100
    assert pd.isna(result.residual_change)


@pytest.mark.parametrize("next_price, expected", [(100, 0), (90, 2)])
def test_flat_and_downward_curve(engine, settings, next_price, expected):
    with engine.begin() as connection:
        connection.execute(
            update(bhav)
            .where(bhav.c.trade_date == PREVIOUS, bhav.c.expiry_date == NEXT)
            .values(close=next_price)
        )
    assert roll(engine, settings).iloc[0].estimated_roll_down == expected


def test_weekend_calendar_days(engine, settings):
    monday = date(2026, 10, 5)
    with engine.begin() as connection:
        connection.execute(
            update(bhav).where(bhav.c.trade_date == CURRENT).values(trade_date=monday)
        )
    result = roll(engine, settings).iloc[0]
    assert result.elapsed_days == 3 and result.estimated_roll_down == -3


@pytest.mark.parametrize("day", [PREVIOUS, CURRENT])
def test_missing_observation(engine, settings, day):
    with engine.begin() as connection:
        connection.execute(
            delete(bhav).where(bhav.c.trade_date == day, bhav.c.expiry_date == EXPIRY)
        )
    result = roll(engine, settings).iloc[0]
    assert result.reason == "missing_observation" and not result.decomposition_valid
    assert pd.isna(result.raw_change) and pd.isna(result.estimated_roll_down)


@pytest.mark.parametrize("day", [PREVIOUS, CURRENT])
def test_untraded_contract(engine, settings, day):
    with engine.begin() as connection:
        connection.execute(
            update(bhav)
            .where(bhav.c.trade_date == day, bhav.c.expiry_date == EXPIRY)
            .values(has_trade=False)
        )
    result = roll(engine, settings).iloc[0]
    assert result.reason == "no_trade" and result.raw_change == 3
    assert not result.decomposition_valid and pd.isna(result.slope_per_day)


def test_no_next_and_immediate_untraded_not_skipped(engine, settings):
    assert roll(engine, settings).iloc[-1].reason == "no_next_expiry"
    with engine.begin() as connection:
        connection.execute(bhav.insert(), row(PREVIOUS, FAR, 120))
        connection.execute(
            update(bhav)
            .where(bhav.c.trade_date == PREVIOUS, bhav.c.expiry_date == NEXT)
            .values(has_trade=False)
        )
    result = roll(engine, settings).iloc[0]
    assert result.next_expiry_used == NEXT
    assert result.reason == "next_expiry_no_trade"
    assert pd.isna(result.residual_change)


@pytest.mark.parametrize(
    "day, expiry, value",
    [(PREVIOUS, EXPIRY, None), (CURRENT, EXPIRY, float("inf")), (PREVIOUS, NEXT, None)],
)
def test_invalid_price(engine, settings, day, expiry, value):
    with engine.begin() as connection:
        connection.execute(
            update(bhav)
            .where(bhav.c.trade_date == day, bhav.c.expiry_date == expiry)
            .values(close=value)
        )
    result = roll(engine, settings).iloc[0]
    assert result.reason == "invalid_price" and not result.decomposition_valid
    assert pd.isna(result.estimated_roll_down)


def test_no_lookahead_and_current_next_price(engine, settings):
    original = roll(engine, settings)
    with engine.begin() as connection:
        connection.execute(
            update(bhav)
            .where(bhav.c.trade_date == CURRENT, bhav.c.expiry_date == NEXT)
            .values(close=800)
        )
        connection.execute(
            bhav.insert(),
            [row(date(2026, 10, 5), EXPIRY, 900), row(date(2026, 10, 5), NEXT, 1000)],
        )
    changed = roll(engine, settings)
    pd.testing.assert_series_equal(original.iloc[0], changed.iloc[0])
    cutoff = roll(engine, settings, end=CURRENT)
    assert cutoff.iloc[0].slope_per_day == original.iloc[0].slope_per_day
    with engine.begin() as connection:
        connection.execute(
            update(bhav).where(bhav.c.trade_date > CURRENT).values(close=1)
        )
    pd.testing.assert_frame_equal(cutoff, roll(engine, settings, end=CURRENT))
    pd.testing.assert_frame_equal(
        cutoff,
        roll(engine, settings)
        .loc[lambda frame: frame.trade_date <= CURRENT]
        .reset_index(drop=True),
    )


def test_start_preserves_history(engine, settings):
    pd.testing.assert_frame_equal(
        roll(engine, settings), roll(engine, settings, start=CURRENT)
    )


def test_purity_switch(engine, settings):
    with engine.begin() as connection:
        connection.execute(update(bhav).values(symbol="GOLDM"))
    adjusted = compute_rolldown(
        "GOLDM", engine=engine, settings=settings, use_purity_adjustment=True
    )
    raw = compute_rolldown(
        "GOLDM", engine=engine, settings=settings, use_purity_adjustment=False
    )
    for column in [
        "previous_price",
        "current_price",
        "raw_change",
        "slope_per_day",
        "estimated_roll_down",
        "residual_change",
    ]:
        assert adjusted.loc[0, column] == pytest.approx(raw.loc[0, column] * 999 / 995)
    assert curve(
        "GOLDM", engine=engine, settings=settings, use_purity_adjustment=True
    ).iloc[0].close_p10_999 == pytest.approx(103 * 999 / 995)


def test_expired_and_curve_quality(engine, settings):
    expired = date(2026, 10, 3)
    with engine.begin() as connection:
        connection.execute(
            bhav.insert(), [row(PREVIOUS, expired, 100), row(CURRENT, expired, 103)]
        )
        connection.execute(
            update(bhav)
            .where(bhav.c.trade_date == CURRENT, bhav.c.expiry_date == EXPIRY)
            .values(has_trade=False)
        )
    result = roll(engine, settings).iloc[0]
    assert result.reason == "expired_contract" and not result.decomposition_valid
    latest = curve("GOLDTEN", engine=engine, settings=settings)
    assert expired not in latest.expiry_date.tolist()
    assert latest.iloc[0].quality_reason == "no_trade"


def test_empty_and_unknown_product(engine, settings):
    assert list(roll(engine, settings, start="2027-01-01").columns) == ROLLDOWN_COLUMNS
    assert roll(engine, settings, start="2027-01-01").empty
    assert curve("GOLDPETAL", engine=engine, settings=settings).empty
    assert compute_rolldown("GOLDPETAL", engine=engine, settings=settings).empty
    with pytest.raises(ValueError, match="Unknown product"):
        curve("GOLD", engine=engine, settings=settings)
