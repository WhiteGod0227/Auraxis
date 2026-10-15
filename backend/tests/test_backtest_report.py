from copy import deepcopy
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from app.analytics.backtest import (
    EVENT_COLUMNS,
    LEDGER_COLUMNS,
    ORDER_COLUMNS,
    POSITION_COLUMNS,
    SUMMARY_COLUMNS,
    TRADE_COLUMNS,
    SimulationResult,
)
from app.analytics.backtest_report import summarize_simulation

PAIR = "GOLDTEN-GOLDPETAL"
EXPIRY = date(2026, 11, 30)
DAY = date(2026, 10, 1)


def sample(completed=True, status="open", exit_price=101, net_sequence=None):
    gross = (exit_price - 100) * 10
    entry_cost, exit_cost = 10, (exit_price * 10 + 1000) * 50 / 10000
    closed_cost = entry_cost + exit_cost if completed else 0
    closed_gross = gross if completed else 0
    positions = []
    if status:
        positions = [
            dict(
                position_id="p",
                pair=PAIR,
                expiry=EXPIRY,
                status=status,
                gross_marked_pnl=20.0,
                entry_costs=10.0,
                net_marked_pnl=10.0,
                mark_a=102.0,
                mark_b=100.0,
                mark_quality_a="observed",
                mark_quality_b="observed",
                mark_age_sessions_a=0,
                mark_age_sessions_b=0,
                mark_age_calendar_days_a=0,
                mark_age_calendar_days_b=0,
            )
        ]
    total_cost = closed_cost + (10 if status else 0)
    total_gross = closed_gross + (20 if status else 0)
    total_net = total_gross - total_cost
    trades = (
        [
            dict(
                position_id="t",
                pair=PAIR,
                expiry=EXPIRY,
                gross_pnl=gross,
                entry_costs=entry_cost,
                exit_costs=exit_cost,
                total_costs=closed_cost,
                net_pnl=gross - closed_cost,
                holding_sessions=3,
                quantity_a_10g=10.0,
                quantity_b_10g=-10.0,
                entry_raw_a=100.0,
                entry_raw_b=100.0,
                exit_raw_a=float(exit_price),
                exit_raw_b=100.0,
            )
        ]
        if completed
        else []
    )
    sequence = net_sequence if net_sequence is not None else [total_net]
    assert sequence[-1] == pytest.approx(total_net)
    ledger = []
    for i, net in enumerate(sequence):
        ledger.append(
            dict(
                trade_date=DAY + timedelta(days=i),
                pair=PAIR,
                expiry=EXPIRY,
                position_status=status or "flat",
                position_id="p" if status else None,
                mark_a=102.0 if status else np.nan,
                mark_b=100.0 if status else np.nan,
                mark_quality_a="observed",
                mark_quality_b="observed",
                mark_age_sessions_a=0,
                mark_age_sessions_b=0,
                gross_cumulative_pnl=net + total_cost,
                cumulative_costs=total_cost,
                net_cumulative_pnl=net,
                realized_gross_pnl=closed_gross,
                realized_costs=closed_cost,
                realized_net_pnl=closed_gross - closed_cost,
                unrealized_gross_pnl=20 if status else 0,
                open_entry_costs=10 if status else 0,
            )
        )
    summary = dict(
        pair=PAIR,
        expiry=EXPIRY,
        completed_count=int(completed),
        open_count=int(status == "open"),
        unresolved_count=int(status == "unresolved_expiry"),
        gross_realized_pnl=closed_gross,
        closed_trade_costs=closed_cost,
        net_realized_pnl=closed_gross - closed_cost,
        open_marked_gross_pnl=20 if status else 0,
        open_entry_costs=10 if status else 0,
    )
    return SimulationResult(
        pd.DataFrame(trades, columns=TRADE_COLUMNS),
        pd.DataFrame(positions, columns=POSITION_COLUMNS),
        pd.DataFrame(columns=ORDER_COLUMNS),
        pd.DataFrame(columns=EVENT_COLUMNS),
        pd.DataFrame(columns=EVENT_COLUMNS),
        pd.DataFrame(ledger, columns=LEDGER_COLUMNS),
        pd.DataFrame([summary], columns=SUMMARY_COLUMNS),
        dict(
            pair=PAIR,
            notional_per_leg=1000.0,
            cost_bps_per_leg_per_side=50,
            quote_grams={"GOLDTEN": 10},
        ),
        ("Settlement-based fractional sizing.",),
        (DAY, DAY + timedelta(days=len(sequence) - 1)),
    )


def report(result):
    return summarize_simulation(result)[0]


@pytest.mark.parametrize("status", ["open", "unresolved_expiry"])
def test_reconciliation_categories_and_no_double_count(status):
    result = sample(status=status)
    metrics = report(result).metrics
    assert metrics["completed_count"] == 1
    assert metrics["open_count"] + metrics["unresolved_count"] == 1
    assert metrics["realized_gross_pnl"] == 10
    assert metrics["completed_trade_costs"] == pytest.approx(20.05)
    assert metrics["total_marked_gross_pnl"] == 30
    assert metrics["total_incurred_costs"] == pytest.approx(30.05)
    assert metrics["total_marked_net_pnl"] == pytest.approx(-0.05)
    assert metrics["open_entry_costs"] + metrics["unresolved_entry_costs"] == 10
    assert (
        metrics["open_marked_gross_pnl"] + metrics["unresolved_marked_gross_pnl"] == 20
    )


def test_zero_trades_null_metrics_and_honest_verdict():
    result = report(sample(completed=False, status=None))
    assert result.metrics["win_rate"] is None
    assert result.metrics["average_holding_sessions"] is None
    assert result.metrics["valuation_quality"] == "flat"
    assert result.cost_tolerance["highest_profitable_tested_bps"] is None
    assert result.cost_tolerance["reason"] == "no_completed_trades"
    assert "No completed trades occurred" in result.verdict
    assert "does not establish profitability" in result.verdict


def test_win_rate_net_not_gross_and_reference_denominator():
    result = report(sample())
    assert result.metrics["realized_gross_pnl"] > 0
    assert result.metrics["realized_net_pnl"] < 0
    assert result.metrics["win_rate"] == 0
    assert result.metrics["average_holding_sessions"] == 3
    assert result.metrics["reference_capital"] == 2000
    assert result.metrics["net_pnl_pct_reference"] == pytest.approx(100 * -0.05 / 2000)
    assert "gross-notional" in result.metrics["reference_capital_label"]


def test_drawdown_initial_baseline_and_known_sequence():
    result = report(sample(net_sequence=[-10, 20, 5, -30, -0.05]))
    assert result.equity_curve.drawdown_rupees.tolist() == pytest.approx(
        [10, 0, 15, 50, 20.05]
    )
    assert result.metrics["maximum_drawdown_rupees"] == 50
    assert result.equity_curve.reference_equity.tolist() == pytest.approx(
        [1990, 2020, 2005, 1970, 1999.95]
    )


def test_stale_mark_labels():
    result = sample()
    result.ledger.loc[0, "mark_quality_a"] = "stale_missing_price"
    result.ledger.loc[0, "mark_age_sessions_a"] = 2
    result.positions.loc[0, "mark_quality_a"] = "stale_missing_price"
    output = report(result)
    assert output.metrics["valuation_quality"] == "stale"
    assert output.metrics["drawdown_based_on_stale_marks"]
    assert output.equity_curve.iloc[0].drawdown_based_on_stale_marks
    assert output.metrics["maximum_drawdown_rupees"] == pytest.approx(0.05)


def test_unavailable_valuation_no_invisible_bridge():
    result = sample(net_sequence=[-10, 20, 5, -30, -0.05])
    result.ledger.loc[1, "mark_a"] = np.nan
    output = report(result)
    assert pd.isna(output.equity_curve.loc[1, "reference_equity"])
    assert output.equity_curve.loc[1, "valuation_reason"] == "valuation_unavailable"
    assert pd.isna(output.equity_curve.loc[2, "drawdown_rupees"])
    assert (
        output.equity_curve.loc[2, "drawdown_reason"] == "prior_valuation_unavailable"
    )
    assert output.metrics["maximum_drawdown_rupees"] is None
    assert output.metrics["valuation_quality"] == "partial_unavailable"
    assert output.metrics["total_marked_net_pnl"] == pytest.approx(-0.05)
    result.ledger.loc[4, "mark_b"] = np.nan
    result.positions.loc[0, "mark_b"] = np.nan
    unavailable = report(result)
    assert unavailable.metrics["total_marked_net_pnl"] is None
    assert unavailable.metrics["net_pnl_pct_reference"] is None
    assert unavailable.metrics["open_marked_gross_pnl"] is None
    assert unavailable.metrics["total_incurred_costs"] == pytest.approx(30.05)


def test_fixed_transaction_cost_sensitivity_and_monotonicity():
    output = report(sample())
    costs = output.cost_sensitivity
    assert len(costs) == 51
    # Entry notional 2000, exit value 2010: use quantities times recorded prices.
    assert costs.loc[1, "costs"] == pytest.approx(4010 / 10000)
    assert costs.loc[50, "costs"] == pytest.approx(20.05)
    assert costs.loc[50, "net_pnl"] == pytest.approx(-10.05)
    assert (costs.net_pnl.diff().dropna() <= 0).all()
    assert output.cost_tolerance["highest_profitable_tested_bps"] == 24
    assert not output.cost_tolerance["range_capped"]
    assert output.cost_tolerance["excluded_open_count"] == 1


def test_negative_gross_and_range_capped_tolerance():
    for price in (99, 100):
        negative = report(sample(exit_price=price))
        assert negative.cost_tolerance["highest_profitable_tested_bps"] is None
        assert negative.cost_tolerance["reason"] == "nonpositive_gross_pnl"
    capped = report(sample(exit_price=110))
    assert capped.cost_tolerance["highest_profitable_tested_bps"] == 50
    assert capped.cost_tolerance["range_capped"]
    assert "not a true break-even" in capped.verdict


def test_verdict_small_sample_and_unknown_expiry_outcomes():
    output = report(sample(status="unresolved_expiry"))
    assert "too small for a reliable performance conclusion" in output.verdict
    assert "Final economic outcomes are unknown" in output.verdict
    assert "overall performance cannot be finalized" in output.verdict
    assert "settlement-based" in output.verdict
    assert "fractional sizing" in output.verdict


def test_reporting_does_not_mutate_result():
    result = sample()
    before = deepcopy(result)
    output = report(result)
    output.configuration["quote_grams"]["GOLDTEN"] = 99
    for name in [
        "completed_trades",
        "positions",
        "pending_orders",
        "order_events",
        "diagnostics",
        "ledger",
        "summary",
    ]:
        pd.testing.assert_frame_equal(getattr(result, name), getattr(before, name))
    assert result.configuration == before.configuration


def test_reconciliation_failure_is_reported():
    result = sample()
    result.summary.loc[0, "closed_trade_costs"] = 999
    with pytest.raises(ValueError, match="Reconciliation failed"):
        report(result)


def test_independent_expiry_reports_and_selection():
    first = sample()
    second = sample(completed=False, status="unresolved_expiry")
    other = date(2026, 12, 31)
    for name in [
        "completed_trades",
        "positions",
        "pending_orders",
        "order_events",
        "diagnostics",
        "ledger",
        "summary",
    ]:
        frame = getattr(second, name).copy()
        frame["expiry"] = other
        setattr(
            first, name, pd.concat([getattr(first, name), frame], ignore_index=True)
        )
    output = summarize_simulation(first)
    assert len(output) == 2
    assert output[0].metrics["total_marked_net_pnl"] == pytest.approx(-0.05)
    assert output[1].metrics["total_marked_net_pnl"] == 10
    assert len(summarize_simulation(first, "2026-12-31")) == 1


def test_pending_and_unique_diagnostic_order_counts():
    result = sample()
    result.pending_orders = pd.DataFrame(
        [
            dict(
                order_id="exit1",
                pair=PAIR,
                expiry=EXPIRY,
                kind="exit",
            )
        ],
        columns=ORDER_COLUMNS,
    )
    result.diagnostics = pd.DataFrame(
        [
            dict(order_id="exit1", expiry=EXPIRY, kind="exit", status="blocked"),
            dict(order_id="exit1", expiry=EXPIRY, kind="exit", status="blocked"),
            dict(order_id="entry2", expiry=EXPIRY, kind="entry", status="cancelled"),
        ],
        columns=EVENT_COLUMNS,
    )
    output = report(result)
    assert output.metrics["pending_order_count"] == 1
    assert output.metrics["blocked_exit_count"] == 1
    assert output.metrics["blocked_exit_attempt_count"] == 2
    assert output.metrics["cancelled_entry_count"] == 1


def test_exact_zero_at_upper_cost_limit_is_not_profitable():
    result = sample(status=None)
    result.completed_trades.loc[
        0, ["exit_raw_b", "gross_pnl", "exit_costs", "total_costs", "net_pnl"]
    ] = [99, 20, 10, 20, 0]
    result.summary.loc[
        0, ["gross_realized_pnl", "closed_trade_costs", "net_realized_pnl"]
    ] = [20, 20, 0]
    result.ledger.loc[
        0,
        [
            "gross_cumulative_pnl",
            "cumulative_costs",
            "net_cumulative_pnl",
            "realized_gross_pnl",
            "realized_costs",
            "realized_net_pnl",
        ],
    ] = [20, 20, 0, 20, 20, 0]
    output = report(result)
    assert output.cost_sensitivity.loc[50, "net_pnl"] == 0
    assert output.cost_tolerance["highest_profitable_tested_bps"] == 49
    assert not output.cost_tolerance["range_capped"]
