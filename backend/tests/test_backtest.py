from datetime import date, timedelta

import pandas as pd
import pytest
from sqlalchemy import create_engine, delete, update

from app.analytics.backtest import simulate_pair
from app.core.config import Settings
from app.data.loader import bhav, metadata

PAIR = "GOLDTEN-GOLDPETAL"
EXPIRY = date(2026, 11, 30)


def sessions(count):
    day = date(2026, 10, 5)
    result = []
    while len(result) < count:
        if day.weekday() < 5:
            result.append(day)
        day += timedelta(days=1)
    return result


@pytest.fixture
def settings():
    return Settings(_env_file=None)


@pytest.fixture
def make_engine():
    engines = []

    def create(values=(0, 2, -4, -2, -3, 1), expiry=EXPIRY):
        engine = create_engine("sqlite:///:memory:")
        metadata.create_all(engine)
        rows = []
        for day, value in zip(sessions(len(values)), values, strict=True):
            for symbol, close in [("GOLDTEN", 100 + value), ("GOLDPETAL", 10)]:
                rows.append(
                    dict(
                        symbol=symbol,
                        expiry_date=expiry,
                        trade_date=day,
                        close=close,
                        has_trade=True,
                        volume_lots=1000,
                        volume_text="10 GRMS",
                        volume_grams=10000,
                        open_interest_lots=1000,
                        open_interest_grams=10000,
                    )
                )
        with engine.begin() as connection:
            connection.execute(bhav.insert(), rows)
        engines.append(engine)
        return engine

    yield create
    for engine in engines:
        engine.dispose()


def run(engine, settings, **options):
    return simulate_pair(
        PAIR, engine=engine, settings=settings, window=2, min_periods=2, **options
    )


def alter(engine, day, symbol="GOLDPETAL", **values):
    with engine.begin() as connection:
        connection.execute(
            update(bhav)
            .where(bhav.c.trade_date == day, bhav.c.symbol == symbol)
            .values(**values)
        )


def test_long_direction_fixed_quantity_costs_and_next_close(make_engine, settings):
    result = run(make_engine(), settings, notional_per_leg=9800)
    trade = result.completed_trades.iloc[0]
    days = sessions(6)
    assert trade.side == "long_a_short_b"
    assert trade.signal_date == days[2] and trade.entry_date == days[3]
    assert trade.exit_signal_date == days[4] and trade.exit_date == days[5]
    assert trade.entry_execution_z != trade.signal_z
    assert trade.quantity_a_10g == 100 and trade.quantity_b_10g == -98
    assert trade.gross_pnl == pytest.approx(300)
    assert trade.entry_costs == pytest.approx(9.8)
    assert trade.exit_costs == pytest.approx(9.95)
    assert trade.total_costs == pytest.approx(19.75)
    assert trade.net_pnl == pytest.approx(280.25)
    entry = result.ledger.loc[result.ledger.trade_date == days[3]].iloc[0]
    assert entry.unrealized_gross_pnl == 0
    assert entry.net_cumulative_pnl == pytest.approx(-9.8)
    assert trade.holding_sessions == 2
    assert result.positions.empty
    assert len(result.pending_orders) == 1
    assert result.pending_orders.iloc[0].kind == "entry"
    assert result.pending_orders.iloc[0].signal_date == days[5]
    assert len(result.completed_trades) == 1  # No same-close reversal fill.


def test_short_direction_hand_pnl(make_engine, settings):
    result = run(make_engine((0, -2, 4, 2, 3, -1)), settings, notional_per_leg=10200)
    trade = result.completed_trades.iloc[0]
    assert trade.side == "short_a_long_b"
    assert trade.quantity_a_10g == -100 and trade.quantity_b_10g == 102
    assert trade.gross_pnl == pytest.approx(300)
    assert trade.total_costs == pytest.approx(20.25)
    assert trade.net_pnl == pytest.approx(279.75)


def test_both_leg_price_changes_and_closing_ledger_marks(make_engine, settings):
    engine = make_engine()
    alter(engine, sessions(6)[5], close=11)
    result = run(engine, settings, notional_per_leg=9800)
    trade = result.completed_trades.iloc[0]
    assert trade.quantity_a_10g == 100 and trade.quantity_b_10g == -98
    assert trade.gross_pnl == pytest.approx(100 * (101 - 98) - 98 * (110 - 100))
    assert trade.exit_costs == pytest.approx((100 * 101 + 98 * 110) * 5 / 10000)
    closing = result.ledger.iloc[-1]
    assert closing.position_status == "closed"
    assert closing.mark_a == 101 and closing.mark_b == 110
    assert closing.unrealized_gross_pnl == closing.open_entry_costs == 0
    assert closing.realized_net_pnl == pytest.approx(trade.net_pnl)


def test_common_calendar_missing_pair_session_cancels_entry(make_engine, settings):
    engine = make_engine((0, 2, -4, -2, -3))
    day = sessions(5)[3]
    with engine.begin() as connection:
        connection.execute(delete(bhav).where(bhav.c.trade_date == day))
        connection.execute(
            bhav.insert(),
            dict(
                symbol="GOLDM",
                trade_date=day,
                expiry_date=EXPIRY,
                close=100,
                has_trade=True,
                volume_lots=1,
                volume_text="0.100 GRMS",
                open_interest_lots=1,
                volume_grams=100,
                open_interest_grams=100,
            ),
        )
    result = run(engine, settings)
    assert result.positions.empty and result.completed_trades.empty
    assert result.diagnostics.iloc[0].event_date == day
    assert result.diagnostics.iloc[0].reason == "missing_observation"


def test_empty_data_well_shaped(make_engine, settings):
    engine = make_engine()
    with engine.begin() as connection:
        connection.execute(delete(bhav))
    result = run(engine, settings)
    assert result.data_window == (None, None)
    for frame in (
        result.completed_trades,
        result.positions,
        result.pending_orders,
        result.order_events,
        result.ledger,
        result.summary,
    ):
        assert frame.empty and len(frame.columns) > 0


def test_execution_liquidity_cancels_entry(make_engine, settings):
    engine = make_engine((0, 2, -4, -2))
    alter(engine, sessions(4)[3], has_trade=False, volume_grams=0)
    result = run(engine, settings)
    assert result.completed_trades.empty and result.positions.empty
    cancelled = result.diagnostics.loc[result.diagnostics.reason == "no_trade"]
    assert len(cancelled) == 1 and cancelled.iloc[0].event_date == sessions(4)[3]


def test_signal_component_liquidity_checked(make_engine, settings):
    engine = make_engine((0, 2, -4))
    alter(engine, sessions(3)[2], volume_grams=100)
    result = run(engine, settings)
    assert result.pending_orders.empty and result.positions.empty
    assert result.diagnostics.iloc[0].reason == "signal_thin_volume"


def test_blocked_exit_stays_pending_then_fills(make_engine, settings):
    engine = make_engine((0, 2, -4, -2, -3, 1, 0))
    alter(engine, sessions(7)[5], has_trade=False)
    blocked = run(engine, settings, end=sessions(7)[5])
    assert blocked.completed_trades.empty
    assert len(blocked.positions) == len(blocked.pending_orders) == 1
    assert blocked.pending_orders.iloc[0].kind == "exit"
    assert blocked.diagnostics.iloc[-1].status == "blocked"
    complete = run(engine, settings)
    assert len(complete.completed_trades) == 1
    assert complete.completed_trades.iloc[0].exit_date == sessions(7)[6]
    assert complete.completed_trades.iloc[0].holding_sessions == 3
    assert (
        len(
            complete.order_events.loc[
                complete.order_events.kind == "entry", "order_id"
            ].unique()
        )
        == 1
    )


def test_near_expiry_blocks_signal_and_execution(make_engine, settings):
    expiry = sessions(4)[3] + timedelta(days=3)
    result = run(make_engine((0, 2, -4, -2), expiry), settings)
    assert result.positions.empty
    assert "expiry_buffer" in result.diagnostics.reason.tolist()
    signal_expiry = sessions(3)[2] + timedelta(days=3)
    signal = run(make_engine((0, 2, -4), signal_expiry), settings)
    assert signal.diagnostics.iloc[0].reason == "signal_expiry_buffer"


def test_unresolved_expiry_no_post_expiry_fill(make_engine, settings):
    days = sessions(9)
    expiry = days[6]
    engine = make_engine((0, 2, -4, -2, -3, 1, 0, 5, 6), expiry)
    for day in days[5:]:
        alter(engine, day, has_trade=False)
    result = run(engine, settings, expiry_buffer_calendar_days=0)
    assert result.completed_trades.empty
    assert result.positions.iloc[0].status == "unresolved_expiry"
    assert result.summary.iloc[0].unresolved_count == 1
    assert len(result.pending_orders) == 1
    last = result.ledger.iloc[-1]
    assert last.mark_quality_a == "stale_expired"
    assert last.mark_age_sessions_a == 2


def test_end_open_and_pending_entry_not_forced(make_engine, settings):
    result = run(make_engine((0, 2, -4, -2)), settings)
    assert len(result.positions) == 1 and result.completed_trades.empty
    assert result.positions.iloc[0].holding_sessions == 0
    assert result.positions.iloc[0].gross_marked_pnl == 0
    pending = run(make_engine((0, 2, -4)), settings)
    assert len(pending.pending_orders) == 1 and pending.positions.empty


def test_holding_intervals_and_execution_delay(make_engine, settings):
    result = run(
        make_engine((0, 2, -4, -2, -5, -6, -7)), settings, max_hold_sessions=2, z_exit=0
    )
    trade = result.completed_trades.iloc[0]
    assert trade.exit_signal_date == sessions(7)[5]
    assert trade.exit_date == sessions(7)[6]
    assert trade.holding_sessions == 3
    assert trade.exit_reason == "max_hold_sessions"


def test_missing_mark_stale_ages_and_no_execution(make_engine, settings):
    engine = make_engine((0, 2, -4, -2, -3, 1))
    alter(engine, sessions(6)[4], close=None)
    result = run(engine, settings)
    stale = result.ledger.loc[result.ledger.trade_date == sessions(6)[4]].iloc[0]
    assert stale.mark_b == 100
    assert stale.mark_quality_b == "stale_missing_price"
    assert stale.mark_age_sessions_b == 1
    assert stale.mark_age_calendar_days_b == 1
    assert result.completed_trades.empty
    assert len(result.positions) == 1


def test_future_changes_preserve_orders_fills_and_ledger(make_engine, settings):
    engine = make_engine((0, 2, -4, -2, -3, 1, 5, 0))
    cutoff = sessions(8)[4]
    original = run(engine, settings)
    with engine.begin() as connection:
        connection.execute(
            update(bhav).where(bhav.c.trade_date > cutoff).values(close=999)
        )
    changed = run(engine, settings)
    pd.testing.assert_frame_equal(
        original.ledger.loc[original.ledger.trade_date <= cutoff],
        changed.ledger.loc[changed.ledger.trade_date <= cutoff],
    )
    pd.testing.assert_frame_equal(
        original.order_events.loc[original.order_events.event_date <= cutoff],
        changed.order_events.loc[changed.order_events.event_date <= cutoff],
    )
    truncated = run(engine, settings, end=cutoff)
    assert (
        truncated.positions.iloc[0].quantity_a_10g
        == original.completed_trades.iloc[0].quantity_a_10g
    )
    with engine.begin() as connection:
        connection.execute(delete(bhav).where(bhav.c.trade_date > cutoff))
    deleted = run(engine, settings)
    pd.testing.assert_frame_equal(truncated.ledger, deleted.ledger)
    pd.testing.assert_frame_equal(truncated.pending_orders, deleted.pending_orders)


def test_reconciliation_closed_and_open(make_engine, settings):
    for values in [(0, 2, -4, -2, -3, 1), (0, 2, -4, -2, -5)]:
        result = run(make_engine(values), settings)
        ledger = result.ledger
        assert (
            ledger.net_cumulative_pnl
            == ledger.gross_cumulative_pnl - ledger.cumulative_costs
        ).all()
        assert (
            ledger.net_cumulative_pnl
            == ledger.realized_net_pnl + ledger.unrealized_net_pnl
        ).all()
        summary = result.summary.iloc[0]
        assert summary.net_realized_pnl == pytest.approx(
            result.completed_trades.net_pnl.sum()
        )
        assert summary.open_marked_net_pnl == pytest.approx(
            result.positions.net_marked_pnl.sum()
        )
        assert ledger.iloc[-1].net_cumulative_pnl == pytest.approx(
            summary.net_realized_pnl + summary.open_marked_net_pnl
        )


@pytest.mark.parametrize(
    "options",
    [
        {"notional_per_leg": 0},
        {"notional_per_leg": float("inf")},
        {"cost_bps_per_leg_per_side": -1},
        {"z_entry": 0},
        {"z_exit": 1},
        {"min_volume_grams": -1},
        {"max_hold_sessions": 0},
        {"expiry_buffer_calendar_days": -1},
    ],
)
def test_validation(make_engine, settings, options):
    with pytest.raises(ValueError):
        run(make_engine(), settings, **options)


def test_goldm_rejected(settings):
    with pytest.raises(ValueError, match="GOLDM.*analytics-only"):
        simulate_pair("GOLDM-GOLDTEN", settings=settings)


def test_integer_lots_round_down_and_reconcile_actual_turnover(make_engine, settings):
    from app.analytics.backtest_report import summarize_simulation

    result = run(
        make_engine(), settings, notional_per_leg=9850, sizing_mode="integer_lots"
    )
    trade = result.completed_trades.iloc[0]
    assert trade.lots_a == 100 and trade.lots_b == -985
    assert trade.quantity_a_10g == 100 and trade.quantity_b_10g == -98.5
    assert trade.entry_notional_a == 9800 and trade.entry_notional_b == 9850
    assert trade.residual_notional_a == 50 and trade.residual_notional_b == 0
    assert trade.net_exposure_grams == pytest.approx(15)
    assert trade.entry_costs == pytest.approx((9800 + 9850) * 5 / 10000)
    assert trade.net_pnl == pytest.approx(trade.gross_pnl - trade.total_costs)
    report = summarize_simulation(result)[0]
    assert report.metrics["realized_net_pnl"] == pytest.approx(trade.net_pnl)
    assert "integer-lot rounding" in report.verdict


def test_integer_lot_insufficient_notional_cancels_without_zero_leg(
    make_engine, settings
):
    result = run(
        make_engine(), settings, notional_per_leg=1, sizing_mode="integer_lots"
    )
    assert result.completed_trades.empty and result.positions.empty
    assert "insufficient_notional_for_lot" in set(result.order_events.reason)
