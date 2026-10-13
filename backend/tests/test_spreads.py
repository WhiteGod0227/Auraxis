from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine, delete, update

from app.analytics.spreads import compute_spreads, latest_snapshot
from app.core.config import Settings
from app.data.loader import bhav, metadata


def row(symbol, expiry, close, day=date(2026, 10, 1), traded=True):
    return dict(
        symbol=symbol,
        expiry_date=expiry,
        trade_date=day,
        close=close,
        has_trade=traded,
        volume_lots=10,
        volume_text="1 GRMS",
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
    oct_exp, nov_exp, mar_exp = (
        date(2026, 10, 30),
        date(2026, 11, 30),
        date(2027, 3, 31),
    )
    rows = [
        row("GOLDPETAL", oct_exp, 15002),
        row("GOLDGUINEA", oct_exp, 119993),
        row("GOLDTEN", oct_exp, 149436),
        row("GOLDTEN", nov_exp, 150834),
        row("GOLDM", date(2026, 11, 5), 149055),
        row("GOLDM", date(2026, 10, 5), 147729),
        row("GOLDGUINEA", mar_exp, 124050, traded=False),
        row("GOLDPETAL", mar_exp, 15693),
    ]
    with instance.begin() as connection:
        connection.execute(bhav.insert(), rows)
    yield instance
    instance.dispose()


def compute(pair, engine, settings, **options):
    return compute_spreads(pair, engine=engine, settings=settings, **options)


def test_real_same_expiry_values(engine, settings):
    ten = compute("GOLDTEN-GOLDPETAL", engine, settings)
    guinea = compute("GOLDGUINEA-GOLDPETAL", engine, settings)
    assert ten.iloc[0].spread_pct == pytest.approx(100 * (149436 / 150020 - 1))
    assert guinea.iloc[0].spread_pct == pytest.approx(100 * (149991.25 / 150020 - 1))
    assert ten.iloc[0].days_mismatch == 0
    assert ten.iloc[0].tradable
    zero = guinea.loc[guinea.expiry_a == date(2027, 3, 31)].iloc[0]
    assert not zero.tradable and zero.reason == "no_trade"
    assert pd.notna(zero.spread_pct)


def test_interpolation_and_no_bracket(engine, settings):
    result = compute("GOLDM-GOLDTEN", engine, settings).set_index("expiry_a")
    november = result.loc[date(2026, 11, 5)]
    b = 149436 + 6 / 31 * (150834 - 149436)
    assert november.b_p10_999 == pytest.approx(b)
    assert november.spread_pct == pytest.approx(100 * ((149055 * 999 / 995) / b - 1))
    assert november.days_mismatch == (-6, 25)
    assert november.expiry_b_used == (date(2026, 10, 30), date(2026, 11, 30))
    assert november.tradable
    october = result.loc[date(2026, 10, 5)]
    assert october.reason == "no_bracket" and not october.tradable
    assert pd.isna(october.spread_pct)


def test_nearest_and_purity_switch(engine, settings):
    adjusted = compute("GOLDM-GOLDTEN", engine, settings)
    nearest = compute("GOLDM-GOLDTEN", engine, settings, carry_adjusted=False)
    no_purity = compute("GOLDM-GOLDTEN", engine, settings, use_purity_adjustment=False)
    assert nearest.iloc[1].days_mismatch == -6
    assert nearest.iloc[1].spread_pct != adjusted.iloc[1].spread_pct
    assert no_purity.iloc[1].a_p10_999 == 149055
    assert no_purity.iloc[1].spread_pct != adjusted.iloc[1].spread_pct


def test_untraded_bracket_and_liquidity(engine, settings):
    with engine.begin() as connection:
        connection.execute(
            update(bhav)
            .where(bhav.c.symbol == "GOLDTEN", bhav.c.expiry_date == date(2026, 11, 30))
            .values(has_trade=False)
        )
    result = compute("GOLDM-GOLDTEN", engine, settings).iloc[1]
    assert result.reason == "leg_no_trade" and pd.isna(result.spread_pct)
    for options, reason in [
        ({"min_volume_grams": 101}, "thin_volume"),
        ({"min_oi_grams": 101}, "thin_oi"),
    ]:
        thin = compute("GOLDTEN-GOLDPETAL", engine, settings, **options).iloc[0]
        assert not thin.tradable and thin.reason == reason
        assert pd.notna(thin.spread_pct)


@pytest.fixture
def history(engine):
    expiry = date(2026, 12, 31)
    days = [date(2026, 10, 2) + timedelta(days=i * 2) for i in range(12)]
    with engine.begin() as connection:
        connection.execute(
            bhav.insert(),
            [
                item
                for i, day in enumerate(days)
                for item in (
                    row("GOLDTEN", expiry, 100 + i, day),
                    row("GOLDPETAL", expiry, 10, day),
                )
            ],
        )
    return engine, days, expiry


def test_shifted_stats_holiday_counts_and_start_history(history, settings):
    engine, days, expiry = history
    result = compute("GOLDTEN-GOLDPETAL", engine, settings, window=3, min_periods=2)
    series = result.loc[result.expiry_a == expiry].reset_index(drop=True)
    assert pd.isna(series.loc[1, "z"])
    assert series.loc[2, "roll_mean"] == pytest.approx(0.5)
    assert series.loc[2, "roll_std"] == pytest.approx(np.std([0, 1], ddof=1))
    assert series.loc[2, "z"] == pytest.approx((2 - 0.5) / np.std([0, 1], ddof=1))
    assert series.loc[2, "percentile"] == 100
    assert series.loc[4, "roll_mean"] == pytest.approx(2)
    cropped = compute(
        "GOLDTEN-GOLDPETAL", engine, settings, window=3, min_periods=2, start=days[4]
    )
    assert cropped.loc[cropped.expiry_a == expiry].iloc[0].z == series.loc[4, "z"]
    with engine.begin() as connection:
        connection.execute(delete(bhav).where(bhav.c.trade_date == days[1]))
    sparse = compute("GOLDTEN-GOLDPETAL", engine, settings, window=3, min_periods=2)
    sparse = sparse.loc[sparse.expiry_a == expiry].reset_index(drop=True)
    assert sparse.loc[2, "roll_mean"] == pytest.approx(1)  # prior values 0 and 2


def test_no_lookahead_future_changes_and_truncation(history, settings):
    engine, days, _ = history
    options = dict(window=4, min_periods=2)
    full = compute("GOLDTEN-GOLDPETAL", engine, settings, **options)
    cutoff = days[6]
    earlier = full.loc[full.trade_date <= cutoff].reset_index(drop=True)
    with engine.begin() as connection:
        connection.execute(
            update(bhav).where(bhav.c.trade_date > cutoff).values(close=99999)
        )
    altered = compute("GOLDTEN-GOLDPETAL", engine, settings, end=cutoff, **options)
    pd.testing.assert_frame_equal(earlier, altered)
    # Recompute without an end bound after changing future prices as well.
    altered_full = compute("GOLDTEN-GOLDPETAL", engine, settings, **options)
    pd.testing.assert_frame_equal(
        earlier,
        altered_full.loc[altered_full.trade_date <= cutoff].reset_index(drop=True),
    )
    with engine.begin() as connection:
        connection.execute(delete(bhav).where(bhav.c.trade_date > cutoff))
    pd.testing.assert_frame_equal(
        earlier, compute("GOLDTEN-GOLDPETAL", engine, settings, **options)
    )


def test_zero_std_and_latest_snapshot(history, settings):
    engine, _, expiry = history
    with engine.begin() as connection:
        connection.execute(
            update(bhav)
            .where(bhav.c.expiry_date == expiry, bhav.c.symbol == "GOLDTEN")
            .values(close=100)
        )
    result = compute("GOLDTEN-GOLDPETAL", engine, settings, window=3, min_periods=2)
    series = result.loc[result.expiry_a == expiry]
    assert series.z.isna().all()
    assert series.iloc[-1].roll_std == 0
    assert series.iloc[-1].percentile == 50
    latest = latest_snapshot(engine=engine, settings=settings, window=3, min_periods=2)
    assert len(latest) == 1 and latest.iloc[0].expiry_a == expiry
    assert latest.iloc[0].roll_std == 0


def test_bad_pair_and_window(engine, settings):
    with pytest.raises(ValueError, match="pair"):
        compute("GOLD-GOLDPETAL", engine, settings)
    with pytest.raises(ValueError, match="window"):
        compute("GOLDTEN-GOLDPETAL", engine, settings, window=3, min_periods=4)
