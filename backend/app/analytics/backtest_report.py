"""Independent expiry reports for existing settlement simulations; no execution."""

from copy import deepcopy
from dataclasses import dataclass
from datetime import date
from math import isclose, isfinite

import numpy as np
import pandas as pd

from app.analytics.backtest import SimulationResult

REPORT_ASSUMPTIONS = (
    "Each pair/expiry report is independent; no portfolio return or shared capital.",
    "Reference capital is twice notional_per_leg, a gross-notional reference "
    "denominator, not margin capital, required cash or brokerage-account equity.",
    "Drawdown is a nonnegative rupee loss from the running reference-equity peak, "
    "including the initial zero-P&L baseline.",
    "After an unavailable valuation, subsequent drawdown and full-window maximum "
    "drawdown are unavailable; missing equity is never bridged silently.",
    "Session count covers this expiry's recorded ledger dates, not calendar days.",
    "Win rate is the fraction of completed trades with strictly positive net P&L.",
    "Closed-trade cost tolerance uses only fixed recorded completed transactions; "
    "it excludes open/unresolved positions and is not whole-strategy break-even.",
    "The 40-session/10-trade sample checks are reporting heuristics, not "
    "statistical significance tests. This prototype does not establish profitability.",
)


@dataclass
class ExpiryReport:
    pair: str
    expiry: date
    configuration: dict
    metrics: dict
    equity_curve: pd.DataFrame
    cost_sensitivity: pd.DataFrame
    cost_tolerance: dict
    verdict: str
    assumptions: tuple[str, ...]


def _finite(value):
    return pd.notna(value) and isfinite(value)


def _sum(frame, column):
    values = frame[column].tolist()
    if not all(_finite(value) for value in values):
        return None
    total = float(sum(values))
    return total if _finite(total) else None


def _add(*values):
    if not all(_finite(value) for value in values):
        return None
    total = sum(values)
    return total if _finite(total) else None


def _net(gross, costs):
    return _add(gross, -costs) if _finite(costs) else None


def _match(actual, expected, label):
    if (
        _finite(actual)
        and _finite(expected)
        and not isclose(float(actual), float(expected), rel_tol=1e-9, abs_tol=1e-6)
    ):
        raise ValueError(f"Reconciliation failed for {label}: {actual} != {expected}")


def _quality(row):
    if row.position_status not in ("open", "unresolved_expiry", "closed"):
        return "flat"
    if row.position_status != "closed" and not all(
        _finite(row[f"mark_{leg}"]) for leg in ("a", "b")
    ):
        return "unavailable"
    if any(
        str(row[f"mark_quality_{leg}"]).startswith("stale")
        or (
            _finite(row[f"mark_age_sessions_{leg}"])
            and row[f"mark_age_sessions_{leg}"] > 0
        )
        for leg in ("a", "b")
    ):
        return "stale"
    if any(row[f"mark_quality_{leg}"] == "settlement_no_trade" for leg in ("a", "b")):
        return "settlement_no_trade"
    return "observed"


def _equity(ledger, capital):
    rows = []
    peak = capital
    gap_seen = False
    stale_seen = False
    for _, item in ledger.iterrows():
        _match(
            item.net_cumulative_pnl,
            _net(item.gross_cumulative_pnl, item.cumulative_costs),
            "session ledger net",
        )
        quality = _quality(item)
        stale_seen = stale_seen or quality == "stale"
        available = quality != "unavailable" and all(
            _finite(item[name])
            for name in (
                "gross_cumulative_pnl",
                "cumulative_costs",
                "net_cumulative_pnl",
            )
        )
        row = dict(
            trade_date=item.trade_date,
            cumulative_gross_pnl=item.gross_cumulative_pnl if available else np.nan,
            cumulative_incurred_costs=item.cumulative_costs,
            cumulative_net_pnl=item.net_cumulative_pnl if available else np.nan,
            reference_capital=capital,
            reference_equity=capital + item.net_cumulative_pnl if available else np.nan,
            drawdown_rupees=np.nan,
            valuation_quality=quality if available else "unavailable",
            valuation_reason="" if available else "valuation_unavailable",
            drawdown_reason="",
            drawdown_based_on_stale_marks=stale_seen,
        )
        for name in ledger.columns:
            if name.startswith("mark_"):
                row[name] = item[name]
        if not available:
            gap_seen = True
            row["drawdown_reason"] = "valuation_unavailable"
        elif gap_seen:
            row["drawdown_reason"] = "prior_valuation_unavailable"
        else:
            peak = max(peak, row["reference_equity"])
            row["drawdown_rupees"] = peak - row["reference_equity"]
        rows.append(row)
    columns = [
        "trade_date",
        "cumulative_gross_pnl",
        "cumulative_incurred_costs",
        "cumulative_net_pnl",
        "reference_capital",
        "reference_equity",
        "drawdown_rupees",
        "valuation_quality",
        "valuation_reason",
        "drawdown_reason",
        "drawdown_based_on_stale_marks",
        *[name for name in ledger.columns if name.startswith("mark_")],
    ]
    return pd.DataFrame(rows, columns=columns)


def _costs(trades, open_count, unresolved_count):
    gross = _sum(trades, "gross_pnl")
    turnover = 0.0
    valid = gross is not None
    for _, trade in trades.iterrows():
        for leg in ("a", "b"):
            quantity = trade[f"quantity_{leg}_10g"]
            for side in ("entry", "exit"):
                price = trade[f"{side}_raw_{leg}"]
                if not _finite(quantity) or not _finite(price) or price <= 0:
                    valid = False
                else:
                    turnover += abs(quantity * price)
    rows = [
        dict(
            cost_bps_per_leg_per_side=bps,
            gross_pnl=gross if valid else None,
            costs=turnover * bps / 10000 if valid else None,
            net_pnl=gross - turnover * bps / 10000 if valid else None,
        )
        for bps in range(51)
    ]
    sensitivity = pd.DataFrame(rows)
    tolerance = dict(
        label="closed-trade cost tolerance",
        highest_profitable_tested_bps=None,
        range_capped=False,
        reason="",
        excluded_open_count=open_count,
        excluded_unresolved_count=unresolved_count,
    )
    if trades.empty:
        tolerance["reason"] = "no_completed_trades"
    elif not valid:
        tolerance["reason"] = "invalid_trade_data"
    elif gross <= 0:
        tolerance["reason"] = "nonpositive_gross_pnl"
    else:
        profitable = sensitivity.loc[
            sensitivity.net_pnl > 0, "cost_bps_per_leg_per_side"
        ]
        tolerance["highest_profitable_tested_bps"] = int(profitable.max())
        tolerance["range_capped"] = tolerance["highest_profitable_tested_bps"] == 50
    return sensitivity, tolerance


def _verdict(pair, expiry, metrics, tolerance, sizing_mode="fractional"):
    def money(value):
        return "unavailable" if value is None else f"Rs {value:,.2f}"

    verdict = (
        f"{pair}, expiry {expiry}: {metrics['first_simulation_date']} to "
        f"{metrics['last_simulation_date']}, "
        f"{metrics['session_count']} available sessions. "
        f"{metrics['completed_count']} completed, {metrics['open_count']} open, "
        f"{metrics['unresolved_count']} unresolved-expiry positions. "
        "Closed-trade net P&L under configured costs: "
        f"{money(metrics['realized_net_pnl'])}. "
        f"Total marked net P&L: {money(metrics['total_marked_net_pnl'])} "
        f"(valuation {metrics['valuation_quality']}). "
    )
    bps = tolerance["highest_profitable_tested_bps"]
    if bps is None:
        verdict += f"Closed-trade cost tolerance unavailable: {tolerance['reason']}. "
    elif tolerance["range_capped"]:
        verdict += (
            "Closed-trade cost tolerance remains positive through the tested "
            "50 bps per leg per side; the range is capped, "
            "not a true break-even estimate. "
        )
    else:
        verdict += (
            f"Highest profitable tested closed-trade cost: {bps} bps per leg per side. "
        )
    verdict += (
        f"Cost tolerance excludes {metrics['open_count']} open and "
        f"{metrics['unresolved_count']} unresolved positions; "
        "it is not whole-strategy break-even. "
        "This is a settlement-based simulation with "
        + (
            "integer-lot rounding. "
            if sizing_mode == "integer_lots"
            else "idealized fractional sizing. "
        )
    )
    if metrics["completed_count"] == 0:
        verdict += (
            "No completed trades occurred; closed-trade performance is unobserved. "
        )
    if metrics["session_count"] < 40 or metrics["completed_count"] < 10:
        verdict += (
            "The sample is too small for a reliable performance conclusion "
            "(reporting heuristics, not statistical significance tests). "
        )
    if metrics["unresolved_count"]:
        verdict += (
            "Final economic outcomes are unknown; "
            "overall performance cannot be finalized. "
        )
    return verdict + "This prototype does not establish profitability."


def summarize_simulation(
    result: SimulationResult, expiry: date | str | None = None
) -> list[ExpiryReport]:
    """Return one report per expiry, optionally selected by date/ISO string.

    Read only existing result frames. Win rate is 0..1, drawdown is nonnegative,
    and undefined KPIs are None. No simulated fills or source frames are changed.
    Raise ValueError for inconsistent finite accounting values.
    """
    if isinstance(expiry, str):
        expiry = date.fromisoformat(expiry)
    capital = 2 * result.configuration["notional_per_leg"]
    if not _finite(capital) or capital <= 0:
        raise ValueError("Reference capital must be finite and positive")
    reports = []
    pair = result.configuration["pair"]
    for _, source in result.summary.iterrows():
        selected = source.expiry
        if expiry is not None and selected != expiry:
            continue
        trades = result.completed_trades.loc[result.completed_trades.expiry == selected]
        positions = result.positions.loc[result.positions.expiry == selected]
        if not positions.status.isin(["open", "unresolved_expiry"]).all():
            raise ValueError("Unexpected outstanding position status")
        opened = positions.loc[positions.status == "open"]
        unresolved = positions.loc[positions.status == "unresolved_expiry"]
        pending = result.pending_orders.loc[result.pending_orders.expiry == selected]
        ledger = result.ledger.loc[result.ledger.expiry == selected].sort_values(
            "trade_date"
        )
        diagnostics = result.diagnostics.loc[result.diagnostics.expiry == selected]
        realized_gross = _sum(trades, "gross_pnl")
        closed_costs = _sum(trades, "total_costs")
        realized_net = _net(realized_gross, closed_costs)
        for _, trade in trades.iterrows():
            _match(
                trade.total_costs,
                _add(trade.entry_costs, trade.exit_costs),
                "trade costs",
            )
            _match(
                trade.net_pnl, _net(trade.gross_pnl, trade.total_costs), "trade net P&L"
            )
        for _, position in positions.iterrows():
            _match(
                position.net_marked_pnl,
                _net(position.gross_marked_pnl, position.entry_costs),
                "position net P&L",
            )

        def marked_gross(category):
            if any(
                not _finite(value)
                for leg in ("a", "b")
                for value in category[f"mark_{leg}"]
            ):
                return None
            return _sum(category, "gross_marked_pnl")

        open_gross, unresolved_gross = marked_gross(opened), marked_gross(unresolved)
        open_costs, unresolved_costs = (
            _sum(opened, "entry_costs"),
            _sum(unresolved, "entry_costs"),
        )
        total_gross = _add(realized_gross, open_gross, unresolved_gross)
        total_costs = _add(closed_costs, open_costs, unresolved_costs)
        total_net = _net(total_gross, total_costs)
        equity = _equity(ledger, capital)
        unavailable = (
            not equity.empty and (equity.valuation_quality == "unavailable").any()
        )
        stale = not equity.empty and (equity.valuation_quality == "stale").any()
        last_available = (
            not equity.empty and equity.iloc[-1].valuation_quality != "unavailable"
        )
        position_marks_available = all(
            _finite(value) for value in positions["mark_a"]
        ) and all(_finite(value) for value in positions["mark_b"])
        if not position_marks_available:
            total_gross = total_net = None
            last_available = False
        if not last_available:
            total_gross = total_net = None
        warnings = []
        if len(unresolved):
            warnings.append(
                "Unresolved expiry outcomes are unknown; "
                "overall performance cannot be finalized."
            )
        if stale:
            warnings.append("Drawdown and equity include stale settlement marks.")
        if unavailable or not last_available:
            warnings.append(
                "Valuation unavailable; affected metrics cannot be calculated."
            )
        max_dd = (
            float(equity.drawdown_rupees.max())
            if not equity.empty and not unavailable and last_available
            else None
        )
        metrics = dict(
            first_simulation_date=ledger.trade_date.min() if not ledger.empty else None,
            last_simulation_date=ledger.trade_date.max() if not ledger.empty else None,
            session_count=int(ledger.trade_date.nunique()),
            overall_data_window=result.data_window,
            completed_count=len(trades),
            open_count=len(opened),
            unresolved_count=len(unresolved),
            pending_order_count=len(pending),
            realized_gross_pnl=realized_gross,
            completed_trade_costs=closed_costs,
            realized_net_pnl=realized_net,
            open_marked_gross_pnl=open_gross,
            unresolved_marked_gross_pnl=unresolved_gross,
            open_entry_costs=open_costs,
            unresolved_entry_costs=unresolved_costs,
            open_marked_net_pnl=_net(open_gross, open_costs),
            unresolved_marked_net_pnl=_net(unresolved_gross, unresolved_costs),
            total_marked_gross_pnl=total_gross,
            total_incurred_costs=total_costs,
            total_marked_net_pnl=total_net,
            total_marked_pnl_reason=""
            if total_net is not None
            else "valuation_unavailable",
            win_rate=float((trades.net_pnl > 0).mean())
            if len(trades) and all(_finite(v) for v in trades.net_pnl)
            else None,
            average_holding_sessions=float(trades.holding_sessions.mean())
            if len(trades) and all(_finite(v) for v in trades.holding_sessions)
            else None,
            blocked_exit_count=int(
                diagnostics.loc[
                    (diagnostics.kind == "exit") & (diagnostics.status == "blocked"),
                    "order_id",
                ].nunique()
            ),
            blocked_exit_attempt_count=int(
                ((diagnostics.kind == "exit") & (diagnostics.status == "blocked")).sum()
            ),
            cancelled_entry_count=int(
                diagnostics.loc[
                    (diagnostics.kind == "entry") & (diagnostics.status == "cancelled"),
                    "order_id",
                ].nunique()
            ),
            reference_capital=capital,
            reference_capital_label="gross-notional reference denominator",
            net_pnl_pct_reference=100 * total_net / capital
            if total_net is not None
            else None,
            maximum_drawdown_rupees=max_dd,
            maximum_drawdown_reason="valuation_unavailable" if max_dd is None else "",
            drawdown_based_on_stale_marks=stale,
            stale_session_count=int((equity.valuation_quality == "stale").sum()),
            unavailable_session_count=int(
                (equity.valuation_quality == "unavailable").sum()
            ),
            valuation_quality="unavailable"
            if not last_available
            else "partial_unavailable"
            if unavailable
            else "stale"
            if stale
            else "settlement_no_trade"
            if (equity.valuation_quality == "settlement_no_trade").any()
            else "flat"
            if (equity.valuation_quality == "flat").all()
            else "observed",
            warnings=warnings,
        )
        for name, expected in (
            ("completed_count", len(trades)),
            ("open_count", len(opened)),
            ("unresolved_count", len(unresolved)),
            ("gross_realized_pnl", realized_gross),
            ("closed_trade_costs", closed_costs),
            ("net_realized_pnl", realized_net),
            ("open_marked_gross_pnl", _add(open_gross, unresolved_gross)),
            ("open_entry_costs", _add(open_costs, unresolved_costs)),
            (
                "open_marked_net_pnl",
                _net(
                    _add(open_gross, unresolved_gross),
                    _add(open_costs, unresolved_costs),
                ),
            ),
        ):
            _match(source[name], expected, name)
        if not ledger.empty:
            last = ledger.iloc[-1]
            _match(last.realized_gross_pnl, realized_gross, "ledger realized gross")
            _match(last.realized_costs, closed_costs, "ledger realized costs")
            _match(last.gross_cumulative_pnl, total_gross, "ledger total gross")
            _match(last.cumulative_costs, total_costs, "ledger total costs")
            _match(last.net_cumulative_pnl, total_net, "ledger total net")
        sensitivity, tolerance = _costs(trades, len(opened), len(unresolved))
        cost_per_bps = sensitivity.loc[1, "costs"]
        if _finite(cost_per_bps):
            _match(
                closed_costs,
                cost_per_bps * result.configuration["cost_bps_per_leg_per_side"],
                "recorded transaction costs",
            )
        reports.append(
            ExpiryReport(
                pair,
                selected,
                deepcopy(result.configuration),
                metrics,
                equity,
                sensitivity,
                tolerance,
                _verdict(
                    pair,
                    selected,
                    metrics,
                    tolerance,
                    result.configuration.get("sizing_mode", "fractional"),
                ),
                tuple(result.assumptions) + REPORT_ASSUMPTIONS,
            )
        )
    return reports
