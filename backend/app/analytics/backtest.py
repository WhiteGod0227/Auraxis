"""Idealized daily-settlement pair simulation; not executable market fills."""

from dataclasses import dataclass
from datetime import date, datetime
from math import floor, isfinite

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.engine import Engine

from app.analytics.normalize import normalize_prices
from app.analytics.spreads import compute_spreads
from app.core.config import Settings, get_settings
from app.data.loader import bhav, create_loader_engine

PAIRS = ("GOLDTEN-GOLDPETAL", "GOLDTEN-GOLDGUINEA", "GOLDGUINEA-GOLDPETAL")
TRADE_COLUMNS = [
    "position_id",
    "pair",
    "expiry",
    "side",
    "signal_date",
    "entry_date",
    "exit_signal_date",
    "exit_date",
    "signal_z",
    "entry_execution_z",
    "exit_execution_z",
    "quantity_a_10g",
    "quantity_b_10g",
    "lots_a",
    "lots_b",
    "entry_notional_a",
    "entry_notional_b",
    "residual_notional_a",
    "residual_notional_b",
    "net_exposure_grams",
    "entry_raw_a",
    "entry_raw_b",
    "exit_raw_a",
    "exit_raw_b",
    "holding_sessions",
    "exit_reason",
    "gross_pnl",
    "entry_costs",
    "exit_costs",
    "total_costs",
    "net_pnl",
]
POSITION_COLUMNS = [
    "position_id",
    "pair",
    "expiry",
    "side",
    "signal_date",
    "entry_date",
    "signal_z",
    "entry_execution_z",
    "quantity_a_10g",
    "quantity_b_10g",
    "lots_a",
    "lots_b",
    "entry_notional_a",
    "entry_notional_b",
    "residual_notional_a",
    "residual_notional_b",
    "net_exposure_grams",
    "entry_raw_a",
    "entry_raw_b",
    "entry_costs",
    "holding_sessions",
    "status",
    "gross_marked_pnl",
    "net_marked_pnl",
    "mark_a",
    "mark_b",
    "mark_quality_a",
    "mark_quality_b",
    "mark_age_sessions_a",
    "mark_age_sessions_b",
    "mark_age_calendar_days_a",
    "mark_age_calendar_days_b",
]
ORDER_COLUMNS = [
    "order_id",
    "pair",
    "expiry",
    "kind",
    "signal_date",
    "eligible_after",
    "signal_z",
    "side",
    "exit_reason",
]
EVENT_COLUMNS = [*ORDER_COLUMNS, "event_date", "status", "reason"]
LEDGER_COLUMNS = [
    "trade_date",
    "pair",
    "expiry",
    "position_id",
    "position_status",
    "holding_sessions",
    "mark_a",
    "mark_b",
    "mark_quality_a",
    "mark_quality_b",
    "mark_age_sessions_a",
    "mark_age_sessions_b",
    "mark_age_calendar_days_a",
    "mark_age_calendar_days_b",
    "realized_gross_pnl",
    "realized_costs",
    "realized_net_pnl",
    "unrealized_gross_pnl",
    "open_entry_costs",
    "unrealized_net_pnl",
    "gross_cumulative_pnl",
    "cumulative_costs",
    "net_cumulative_pnl",
]
SUMMARY_COLUMNS = [
    "pair",
    "expiry",
    "completed_count",
    "open_count",
    "unresolved_count",
    "gross_realized_pnl",
    "closed_trade_costs",
    "net_realized_pnl",
    "open_marked_gross_pnl",
    "open_entry_costs",
    "open_marked_net_pnl",
    "cancelled_order_count",
    "blocked_order_count",
    "blocked_attempt_count",
]
ASSUMPTIONS = (
    "Idealized daily close/settlement simulation, not executable market fills.",
    "Fixed idealized fractional 10g quantities; actual lot execution is not modeled.",
    "5 bps defaults are illustrative, not verified actual fees.",
    "Purity assumptions remain unverified; signals use normalized purity prices, "
    "held-contract P&L uses raw normalized prices.",
    "Each expiry is independent; results are not a portfolio or shared-capital model.",
    "Calendar consists only of available bhav dates across all products.",
    "Holding intervals = current session index minus entry session index; "
    "entry day is zero. Next-close exits and blocked exits can extend holding.",
    "Marks may use last observed finite positive settlements, including untraded "
    "observations, with quality and ages exposed; stale marks never permit fills.",
    "Outstanding positions remain open at data end; no forced liquidation. "
    "Unresolved expiry valuation freezes at the last available pre-expiry/expiry mark.",
    "Start begins flat with earlier history used only to warm up z-scores.",
    "An exit fill may generate a fresh entry order at that close, but its fill "
    "must wait for the next session; entry fills cannot exit at their own close.",
)


@dataclass
class SimulationResult:
    completed_trades: pd.DataFrame
    positions: pd.DataFrame
    pending_orders: pd.DataFrame
    order_events: pd.DataFrame
    diagnostics: pd.DataFrame
    ledger: pd.DataFrame
    summary: pd.DataFrame
    configuration: dict
    assumptions: tuple[str, ...]
    data_window: tuple[date | None, date | None]


def _date(value):
    if value is None:
        return None
    result = date.fromisoformat(value) if isinstance(value, str) else value
    if not isinstance(result, date) or isinstance(result, datetime):
        raise TypeError("Dates must be datetime.date or ISO YYYY-MM-DD strings")
    return result


def _positive(value):
    return pd.notna(value) and isfinite(value) and value > 0


def _eligible(legs, volume, oi):
    if any(leg is None for leg in legs):
        return "missing_observation"
    if any(not leg.has_trade for leg in legs):
        return "no_trade"
    if any(not _positive(leg.close_p10_raw) for leg in legs):
        return "invalid_price"
    if any(not isfinite(leg.volume_grams) or leg.volume_grams < volume for leg in legs):
        return "thin_volume"
    if any(
        not isfinite(leg.open_interest_grams) or leg.open_interest_grams < oi
        for leg in legs
    ):
        return "thin_oi"
    return ""


class _ExpirySimulation:
    def __init__(self, pair, expiry, config):
        self.pair, self.expiry, self.config = pair, expiry, config
        self.position = None
        self.closed_position = None
        self.pending = None
        self.started = False
        self.orders = 0
        self.trades = []
        self.events = []
        self.ledger = []
        self.realized_gross = 0.0
        self.realized_costs = 0.0

    def event(self, order, day, status, reason=""):
        self.events.append(dict(order, event_date=day, status=status, reason=reason))

    def order(self, kind, day, z, side, exit_reason=""):
        self.orders += 1
        return dict(
            order_id=f"{self.pair}:{self.expiry}:{self.orders}",
            pair=self.pair,
            expiry=self.expiry,
            kind=kind,
            signal_date=day,
            eligible_after=day,
            signal_z=z,
            side=side,
            exit_reason=exit_reason,
        )

    def mark(self, day, session, legs):
        position = self.position
        for label, leg in zip(("a", "b"), legs, strict=True):
            # Never update marks with a post-expiry quote or manufacture missing P&L.
            if day <= self.expiry and leg is not None and _positive(leg.close_p10_raw):
                position[f"mark_{label}"] = leg.close_p10_raw
                position[f"mark_day_{label}"] = day
                position[f"mark_session_{label}"] = session
                quality = "observed" if leg.has_trade else "settlement_no_trade"
            else:
                quality = (
                    "stale_expired" if day > self.expiry else "stale_missing_price"
                )
            position[f"mark_quality_{label}"] = quality
            position[f"mark_age_sessions_{label}"] = (
                session - position[f"mark_session_{label}"]
            )
            position[f"mark_age_calendar_days_{label}"] = (
                day - position[f"mark_day_{label}"]
            ).days
        position["holding_sessions"] = session - position["entry_session"]

    def gross(self):
        p = self.position
        return sum(
            p[f"quantity_{label}_10g"] * (p[f"mark_{label}"] - p[f"entry_raw_{label}"])
            for label in ("a", "b")
        )

    def fill_entry(self, order, day, session, z, legs):
        signs = (1, -1) if order["side"] == "long_a_short_b" else (-1, 1)
        self.position = dict(
            position_id=order["order_id"],
            pair=self.pair,
            expiry=self.expiry,
            side=order["side"],
            signal_date=order["signal_date"],
            entry_date=day,
            signal_z=order["signal_z"],
            entry_execution_z=z,
            entry_session=session,
            entry_costs=0.0,
            holding_sessions=0,
            status="open",
        )
        for label, sign, leg in zip(("a", "b"), signs, legs, strict=True):
            lot_units = self.config["lot_grams"][leg.symbol] / self.config["base_grams"]
            units = self.config["notional_per_leg"] / leg.close_p10_raw
            lots = (
                floor(units / lot_units)
                if self.config["sizing_mode"] == "integer_lots"
                else units / lot_units
            )
            quantity = (
                sign * lots * lot_units
                if self.config["sizing_mode"] == "integer_lots"
                else sign * units
            )
            actual_notional = (
                abs(quantity * leg.close_p10_raw)
                if self.config["sizing_mode"] == "integer_lots"
                else self.config["notional_per_leg"]
            )
            self.position.update(
                {
                    f"quantity_{label}_10g": quantity,
                    f"lots_{label}": sign * lots,
                    f"entry_notional_{label}": actual_notional,
                    f"residual_notional_{label}": self.config["notional_per_leg"]
                    - actual_notional,
                    f"entry_raw_{label}": leg.close_p10_raw,
                    f"mark_{label}": leg.close_p10_raw,
                    f"mark_day_{label}": day,
                    f"mark_session_{label}": session,
                }
            )
            self.position["entry_costs"] += (
                actual_notional * self.config["cost_bps_per_leg_per_side"] / 10000
            )
        self.position["net_exposure_grams"] = sum(
            self.position[f"quantity_{label}_10g"] * self.config["base_grams"]
            for label in ("a", "b")
        )

    def fill_exit(self, order, day, z, legs):
        p = self.position
        cost = sum(
            abs(p[f"quantity_{label}_10g"] * leg.close_p10_raw)
            * self.config["cost_bps_per_leg_per_side"]
            / 10000
            for label, leg in zip(("a", "b"), legs, strict=True)
        )
        gross = self.gross()
        trade = {name: p[name] for name in TRADE_COLUMNS if name in p}
        trade.update(
            exit_signal_date=order["signal_date"],
            exit_date=day,
            exit_execution_z=z,
            exit_raw_a=legs[0].close_p10_raw,
            exit_raw_b=legs[1].close_p10_raw,
            exit_reason=order["exit_reason"],
            gross_pnl=gross,
            exit_costs=cost,
            total_costs=p["entry_costs"] + cost,
            net_pnl=gross - p["entry_costs"] - cost,
        )
        self.trades.append(trade)
        self.realized_gross += gross
        self.realized_costs += p["entry_costs"] + cost
        p["status"] = "closed"
        self.closed_position = p
        self.position = None

    def step(self, day, session, legs, z):
        self.closed_position = None
        if not self.started and any(leg is not None for leg in legs):
            self.started = True
        if not self.started:
            return
        if day > self.expiry and self.position is None and self.pending is None:
            return
        filled = False
        reason = _eligible(
            legs, self.config["min_volume_grams"], self.config["min_oi_grams"]
        )
        buffer_reached = (self.expiry - day).days <= self.config[
            "expiry_buffer_calendar_days"
        ]
        if self.pending is not None:
            order = self.pending
            if order["kind"] == "entry":
                failure = "expiry_buffer" if buffer_reached else reason
                if not failure and self.config["sizing_mode"] == "integer_lots":
                    if any(
                        self.config["notional_per_leg"]
                        < leg.close_p10_raw
                        * self.config["lot_grams"][leg.symbol]
                        / self.config["base_grams"]
                        for leg in legs
                    ):
                        failure = "insufficient_notional_for_lot"
                if failure:
                    self.event(order, day, "cancelled", failure)
                else:
                    self.fill_entry(order, day, session, z, legs)
                    self.event(order, day, "executed")
                    filled = True
                self.pending = None
            elif day <= self.expiry and not reason:
                self.mark(day, session, legs)
                self.fill_exit(order, day, z, legs)
                self.event(order, day, "executed")
                self.pending = None
                filled = True
            elif self.position["status"] != "unresolved_expiry":
                self.event(
                    order, day, "blocked", "expired" if day > self.expiry else reason
                )
        if self.position is not None:
            self.mark(day, session, legs)
            if day >= self.expiry and self.position["status"] != "unresolved_expiry":
                self.position["status"] = "unresolved_expiry"
                if self.pending is not None:
                    self.event(self.pending, day, "unresolved", "unresolved_expiry")
            if (
                not filled
                and self.pending is None
                and self.position["status"] == "open"
            ):
                exit_reason = (
                    "expiry_buffer"
                    if buffer_reached
                    else "max_hold_sessions"
                    if self.position["holding_sessions"]
                    >= self.config["max_hold_sessions"]
                    else "z_exit"
                    if pd.notna(z) and isfinite(z) and abs(z) <= self.config["z_exit"]
                    else ""
                )
                if exit_reason:
                    self.pending = self.order(
                        "exit", day, z, self.position["side"], exit_reason
                    )
                    self.event(self.pending, day, "generated")
        elif day < self.expiry and pd.notna(z) and isfinite(z):
            # A fresh post-exit signal is an order for a later session, not a
            # same-close reversal. Entry fills still have a position above.
            side = (
                "long_a_short_b"
                if z <= -self.config["z_entry"]
                else "short_a_long_b"
                if z >= self.config["z_entry"]
                else ""
            )
            if side:
                order = self.order("entry", day, z, side)
                failure = "expiry_buffer" if buffer_reached else reason
                if failure:
                    self.event(order, day, "cancelled", f"signal_{failure}")
                else:
                    self.pending = order
                    self.event(order, day, "generated")
        self.record(day)

    def record(self, day):
        # Preserve execution-day marks in the ledger after moving P&L to realized.
        p = self.position if self.position is not None else self.closed_position
        row = dict.fromkeys(LEDGER_COLUMNS, np.nan)
        row.update(
            trade_date=day,
            pair=self.pair,
            expiry=self.expiry,
            position_id=p["position_id"] if p else None,
            position_status=p["status"] if p else "flat",
            holding_sessions=p["holding_sessions"] if p else 0,
            realized_gross_pnl=self.realized_gross,
            realized_costs=self.realized_costs,
            realized_net_pnl=self.realized_gross - self.realized_costs,
        )
        if p:
            for name in LEDGER_COLUMNS:
                if name.startswith("mark_"):
                    row[name] = p[name]
        gross = self.gross() if self.position is not None else 0.0
        costs = self.position["entry_costs"] if self.position is not None else 0.0
        row.update(
            unrealized_gross_pnl=gross,
            open_entry_costs=costs,
            unrealized_net_pnl=gross - costs,
            gross_cumulative_pnl=self.realized_gross + gross,
            cumulative_costs=self.realized_costs + costs,
            net_cumulative_pnl=self.realized_gross
            + gross
            - self.realized_costs
            - costs,
        )
        self.ledger.append(row)


def simulate_pair(
    pair,
    start=None,
    end=None,
    window=10,
    min_periods=5,
    z_entry=1.0,
    z_exit=0.25,
    max_hold_sessions=5,
    expiry_buffer_calendar_days=3,
    min_volume_grams=2000,
    min_oi_grams=0,
    notional_per_leg=1_000_000,
    cost_bps_per_leg_per_side=5,
    use_purity_adjustment=False,
    sizing_mode="fractional",
    *,
    settings: Settings | None = None,
    engine: Engine | None = None,
) -> SimulationResult:
    """Independent fixed-expiry simulations with next-session close execution.

    No final forced exit, stale entry retry, same-entry-close exit, or portfolio
    capital assumption. Quantity fields are signed, fixed fractional 10g units.
    Costs belong to realized P&L only when the trade closes; until then entry
    costs belong to open-position net marked P&L. Ledger rows report cumulative
    P&L, not invented daily price changes.
    """
    if isinstance(pair, str) and "GOLDM" in pair.split("-"):
        raise ValueError(
            "GOLDM pairs are analytics-only; interpolated legs cannot be simulated"
        )
    if pair not in PAIRS:
        raise ValueError(f"Unsupported same-expiry pair: {pair!r}")
    for name, value, minimum in (
        ("window", window, 1),
        ("min_periods", min_periods, 1),
        ("max_hold_sessions", max_hold_sessions, 1),
        ("expiry_buffer_calendar_days", expiry_buffer_calendar_days, 0),
    ):
        if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
            raise ValueError(f"{name} must be an integer >= {minimum}")
    if min_periods > window:
        raise ValueError("min_periods must be <= window")
    for name, value in (
        ("notional_per_leg", notional_per_leg),
        ("z_entry", z_entry),
        ("z_exit", z_exit),
        ("cost_bps_per_leg_per_side", cost_bps_per_leg_per_side),
        ("min_volume_grams", min_volume_grams),
        ("min_oi_grams", min_oi_grams),
    ):
        try:
            valid = not isinstance(value, bool) and isfinite(value) and value >= 0
        except (TypeError, ValueError):
            valid = False
        if not valid:
            raise ValueError(f"{name} must be finite and nonnegative")
    if notional_per_leg == 0 or z_entry == 0 or z_exit >= z_entry:
        raise ValueError("Require positive notional/z_entry and 0 <= z_exit < z_entry")
    start, end = _date(start), _date(end)
    if start is not None and end is not None and start > end:
        raise ValueError("start must be <= end")
    config = dict(
        pair=pair,
        start=start,
        end=end,
        window=window,
        min_periods=min_periods,
        z_entry=z_entry,
        z_exit=z_exit,
        max_hold_sessions=max_hold_sessions,
        expiry_buffer_calendar_days=expiry_buffer_calendar_days,
        min_volume_grams=min_volume_grams,
        min_oi_grams=min_oi_grams,
        notional_per_leg=notional_per_leg,
        cost_bps_per_leg_per_side=cost_bps_per_leg_per_side,
        use_purity_adjustment=use_purity_adjustment,
    )
    settings = settings or get_settings()
    if sizing_mode not in {"fractional", "integer_lots"}:
        raise ValueError("sizing_mode must be fractional or integer_lots")
    for symbol in pair.split("-"):
        lot = settings.lot_grams.get(symbol)
        if isinstance(lot, bool) or not isinstance(lot, int) or lot <= 0:
            raise ValueError(f"lot_grams for {symbol} must be a positive integer")
    config.update(
        sizing_mode=sizing_mode,
        lot_grams=dict(settings.lot_grams),
        quote_grams=dict(settings.quote_grams),
        purity=dict(settings.purity),
        base_grams=settings.base_grams,
        base_purity=settings.base_purity,
    )
    owned = engine is None
    engine = engine if engine is not None else create_loader_engine(settings)
    try:
        with engine.connect() as connection:
            calendar_query = (
                select(bhav.c.trade_date).distinct().order_by(bhav.c.trade_date)
            )
            query = select(bhav).where(bhav.c.symbol.in_(pair.split("-")))
            if end is not None:
                calendar_query = calendar_query.where(bhav.c.trade_date <= end)
                query = query.where(bhav.c.trade_date <= end)
            if start is not None:
                calendar_query = calendar_query.where(bhav.c.trade_date >= start)
                query = query.where(bhav.c.trade_date >= start)
            calendar = list(connection.scalars(calendar_query))
            raw = pd.read_sql(query, connection)
        spread = compute_spreads(
            pair,
            start=start,
            end=end,
            window=window,
            min_periods=min_periods,
            min_volume_grams=min_volume_grams,
            min_oi_grams=min_oi_grams,
            use_purity_adjustment=use_purity_adjustment,
            settings=settings,
            engine=engine,
        )
    finally:
        if owned:
            engine.dispose()
    raw = normalize_prices(
        raw,
        price_cols=("close",),
        settings=settings,
        use_purity_adjustment=use_purity_adjustment,
    )
    observations = {
        (r.trade_date, r.expiry_date, r.symbol): r for r in raw.itertuples()
    }
    zs = {(r.trade_date, r.expiry_a): r.z for r in spread.itertuples()}
    machines = []
    symbol_a, symbol_b = pair.split("-")
    for expiry in sorted(raw.expiry_date.unique()):
        machine = _ExpirySimulation(pair, expiry, config)
        for session, day in enumerate(calendar):
            legs = [
                observations.get((day, expiry, symbol))
                for symbol in (symbol_a, symbol_b)
            ]
            machine.step(day, session, legs, zs.get((day, expiry), np.nan))
        machines.append(machine)
    trades, positions, pending, events, ledger, summaries = [], [], [], [], [], []
    for machine in machines:
        trades.extend(machine.trades)
        events.extend(machine.events)
        ledger.extend(machine.ledger)
        p = machine.position
        if p:
            position = {name: p[name] for name in POSITION_COLUMNS if name in p}
            position.update(
                gross_marked_pnl=machine.gross(),
                net_marked_pnl=machine.gross() - p["entry_costs"],
            )
            positions.append(position)
        if machine.pending:
            pending.append(machine.pending)
        summaries.append(
            dict(
                pair=pair,
                expiry=machine.expiry,
                completed_count=len(machine.trades),
                open_count=int(p is not None and p["status"] == "open"),
                unresolved_count=int(
                    p is not None and p["status"] == "unresolved_expiry"
                ),
                gross_realized_pnl=machine.realized_gross,
                closed_trade_costs=machine.realized_costs,
                net_realized_pnl=machine.realized_gross - machine.realized_costs,
                open_marked_gross_pnl=machine.gross() if p else 0.0,
                open_entry_costs=p["entry_costs"] if p else 0.0,
                open_marked_net_pnl=machine.gross() - p["entry_costs"] if p else 0.0,
                cancelled_order_count=sum(
                    e["status"] == "cancelled" for e in machine.events
                ),
                blocked_order_count=len(
                    {e["order_id"] for e in machine.events if e["status"] == "blocked"}
                ),
                blocked_attempt_count=sum(
                    e["status"] == "blocked" for e in machine.events
                ),
            )
        )
    event_frame = pd.DataFrame(events, columns=EVENT_COLUMNS)
    diagnostics = event_frame.loc[
        event_frame.status.isin(["cancelled", "blocked", "unresolved"])
    ].reset_index(drop=True)
    return SimulationResult(
        pd.DataFrame(trades, columns=TRADE_COLUMNS),
        pd.DataFrame(positions, columns=POSITION_COLUMNS),
        pd.DataFrame(pending, columns=ORDER_COLUMNS),
        event_frame,
        diagnostics,
        pd.DataFrame(ledger, columns=LEDGER_COLUMNS),
        pd.DataFrame(summaries, columns=SUMMARY_COLUMNS),
        config,
        tuple(
            "Integer lots rounded down independently per leg at entry; quantities "
            "remain fixed. Residual notional and signed gram exposure are reported; "
            "no margin or guaranteed fills are modeled."
            if sizing_mode == "integer_lots" and "fractional 10g" in assumption
            else assumption
            for assumption in ASSUMPTIONS
        ),
        (calendar[0], calendar[-1]) if calendar else (None, None),
    )
