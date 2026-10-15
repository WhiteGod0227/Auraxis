import { currency, formatDate, number } from '@/lib/format'
import DiagnosticLabel from './DiagnosticLabel'
import {
  exitSignalZ,
  legDirection,
  outstandingCategories,
} from '@/lib/backtest'
import type {
  BacktestEntry,
  BacktestReport,
  BacktestOrder,
  BacktestOrderEvent,
} from '@/lib/types'
const value = (v: number | null) =>
  v === null ? 'Unavailable' : number.format(v)
const money = (v: number | null) =>
  v === null ? 'Unavailable' : currency.format(v)
function EntryDetails({
  entry,
  exit,
  sizingMode,
}: {
  entry: BacktestEntry
  sizingMode: 'fractional' | 'integer_lots'
  exit?: { a: number | null; b: number | null }
}) {
  return (
    <details>
      <summary>Quantities and prices</summary>
      <p>
        Signed fixed quantities: A {entry.quantity_a_10g}; B{' '}
        {entry.quantity_b_10g} normalized 10g units (fixed after entry).
      </p>
      <p>
        Signed lots: A {entry.lots_a ?? 'Unavailable'}; B{' '}
        {entry.lots_b ?? 'Unavailable'}.{' '}
        {sizingMode === 'integer_lots'
          ? 'Integer lots rounded down independently at entry.'
          : 'Idealized fractional lots; not integer exchange-lot execution.'}
      </p>
      <p>
        Actual entry notional: A{' '}
        {entry.entry_notional_a === undefined
          ? 'Unavailable'
          : money(entry.entry_notional_a)}
        ; B{' '}
        {entry.entry_notional_b === undefined
          ? 'Unavailable'
          : money(entry.entry_notional_b)}
        .
      </p>
      <p>
        Unused target notional: A{' '}
        {entry.residual_notional_a === undefined
          ? 'Unavailable'
          : money(entry.residual_notional_a)}
        ; B{' '}
        {entry.residual_notional_b === undefined
          ? 'Unavailable'
          : money(entry.residual_notional_b)}
        . Signed net gram exposure: {entry.net_exposure_grams ?? 'Unavailable'}{' '}
        g.
      </p>
      <p>
        Entry raw normalized prices: A {entry.entry_raw_a ?? 'Unavailable'}; B{' '}
        {entry.entry_raw_b ?? 'Unavailable'} Rs per 10 g.
      </p>
      {exit && (
        <p>
          Exit raw normalized prices: A {exit.a ?? 'Unavailable'}; B{' '}
          {exit.b ?? 'Unavailable'} Rs per 10 g.
        </p>
      )}
      <p>
        Signal z: {entry.signal_z ?? 'Unavailable'}; entry execution-date z:{' '}
        {entry.entry_execution_z ?? 'Unavailable'}.
      </p>
      <p>
        Actual leg direction: {legDirection(entry.side, entry.pair)} (
        {entry.side}). Idealized settlement prices, not executable fills.
      </p>
    </details>
  )
}
function OrderTable({
  orders,
  events = false,
  label,
}: {
  orders: (BacktestOrder | BacktestOrderEvent)[]
  events?: boolean
  label: string
}) {
  return orders.length ? (
    <div
      className="table-scroll bt-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Type</th>
            <th>Direction</th>
            <th>Signal date / z</th>
            <th>Eligible after</th>
            {events && (
              <>
                <th>Event date</th>
                <th>Status</th>
                <th>Reason</th>
              </>
            )}
            <th>Exit reason</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order, index) => (
            <tr key={`${order.order_id}-${index}`}>
              <td>{order.order_id}</td>
              <td>{order.kind}</td>
              <td>{legDirection(order.side, order.pair)}</td>
              <td>
                {formatDate(order.signal_date)} / {value(order.signal_z)}
              </td>
              <td>{formatDate(order.eligible_after)}</td>
              {events && 'event_date' in order && (
                <>
                  <td>{formatDate(order.event_date)}</td>
                  <td>{order.status}</td>
                  <td className="rv-reasons">
                    {order.reason || 'No reason provided'}
                  </td>
                </>
              )}
              <td>{order.exit_reason || 'No reason provided'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="empty-state">No {label.toLowerCase()} in this report.</p>
  )
}
export default function BacktestTables({ report }: { report: BacktestReport }) {
  const categories = outstandingCategories(report)
  const valuation = report.equity_curve.at(-1)
  return (
    <>
      <section className="panel bt-completed">
        <h2>Completed trades ({report.completed_trades.length})</h2>
        <p className="mobile-scroll-hint">
          Scroll horizontally for execution z, costs and price details.
        </p>
        {report.completed_trades.length ? (
          <div
            className="table-scroll bt-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Completed trades"
          >
            <table>
              <thead>
                <tr>
                  <th>Direction</th>
                  <th>Entry date</th>
                  <th>Exit signal / exit date</th>
                  <th>Exit reason</th>
                  <th>Exit signal z</th>
                  <th>Exit execution z</th>
                  <th>Holding sessions</th>
                  <th>Gross P&amp;L</th>
                  <th>Total costs</th>
                  <th>Net P&amp;L</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {report.completed_trades.map((trade) => (
                  <tr key={trade.position_id}>
                    <td>{legDirection(trade.side, trade.pair)}</td>
                    <td>{formatDate(trade.entry_date)}</td>
                    <td>
                      {formatDate(trade.exit_signal_date)} /{' '}
                      {formatDate(trade.exit_date)}
                    </td>
                    <td>
                      <DiagnosticLabel code={trade.exit_reason} />
                    </td>
                    <td>{value(exitSignalZ(trade, report.order_events))}</td>
                    <td>{value(trade.exit_execution_z)}</td>
                    <td>{trade.holding_sessions}</td>
                    <td>{money(trade.gross_pnl)}</td>
                    <td>{money(trade.total_costs)}</td>
                    <td>{money(trade.net_pnl)}</td>
                    <td>
                      <details>
                        <summary>Signal and cost breakdown</summary>
                        <p>
                          Entry signal date: {formatDate(trade.signal_date)};
                          signal z: {value(trade.signal_z)}; execution z:{' '}
                          {value(trade.entry_execution_z)}.
                        </p>
                        <p>
                          Entry costs: {money(trade.entry_costs)}; exit costs:{' '}
                          {money(trade.exit_costs)}.
                        </p>
                      </details>
                      <EntryDetails
                        entry={trade}
                        sizingMode={report.configuration.sizing_mode}
                        exit={{ a: trade.exit_raw_a, b: trade.exit_raw_b }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">
            No completed trades. Closed-trade performance is unobserved.
          </p>
        )}
      </section>
      {(['open', 'unresolved'] as const).map((category) => (
        <section
          className={`panel bt-positions bt-${category} ${category === 'unresolved' ? 'bt-unresolved-warning' : ''}`}
          key={category}
        >
          <h2>
            {category === 'open'
              ? 'Open positions'
              : 'Unresolved-expiry positions'}{' '}
            ({categories[category].length})
          </h2>
          <p>
            {category === 'unresolved'
              ? 'Final economic outcome is unknown. These positions are not completed trades and are separate from normal open positions.'
              : 'Outstanding positions remain open at data end; marked P&L is not a finalized economic outcome.'}
          </p>
          <p className="mobile-scroll-hint">
            Scroll horizontally for mark quality, costs and pending exit
            details.
          </p>
          {categories[category].length ? (
            <div
              className="table-scroll bt-table-scroll"
              tabIndex={0}
              role="region"
              aria-label={`${category} positions`}
            >
              <table>
                <thead>
                  <tr>
                    <th>Entry date / direction</th>
                    <th>Status</th>
                    <th>Report valuation date</th>
                    <th>Mark quality / ages</th>
                    <th>Marked gross P&amp;L</th>
                    <th>Entry costs</th>
                    <th>Marked net P&amp;L</th>
                    <th>Holding sessions</th>
                    <th>Pending exit</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {categories[category].map((position) => (
                    <tr key={position.position_id}>
                      <td>
                        {formatDate(position.entry_date)} /{' '}
                        {legDirection(position.side, position.pair)}
                      </td>
                      <td>{position.status}</td>
                      <td>
                        {formatDate(valuation?.trade_date ?? null)} (
                        {valuation?.valuation_quality ?? 'Unavailable'})
                      </td>
                      <td className="rv-reasons">
                        A: {position.mark_quality_a ?? 'Unavailable'},{' '}
                        {value(position.mark_age_sessions_a)} sessions /{' '}
                        {value(position.mark_age_calendar_days_a)} calendar
                        days; B: {position.mark_quality_b ?? 'Unavailable'},{' '}
                        {value(position.mark_age_sessions_b)} sessions /{' '}
                        {value(position.mark_age_calendar_days_b)} calendar
                        days.
                      </td>
                      <td>{money(position.gross_marked_pnl)}</td>
                      <td>{money(position.entry_costs)}</td>
                      <td>{money(position.net_marked_pnl)}</td>
                      <td>{position.holding_sessions}</td>
                      <td className="rv-reasons">
                        {report.pending_orders
                          .filter(
                            (o) =>
                              o.kind === 'exit' && o.side === position.side,
                          )
                          .map(
                            (o) =>
                              `${o.order_id}: signal ${o.signal_date}, ${o.exit_reason}, eligible after ${o.eligible_after}`,
                          )
                          .join(' | ') || 'No reason provided'}
                      </td>
                      <td>
                        <EntryDetails
                          entry={position}
                          sizingMode={report.configuration.sizing_mode}
                        />
                        <p>
                          Marks A {position.mark_a ?? 'Unavailable'}; B{' '}
                          {position.mark_b ?? 'Unavailable'} Rs per 10 g.
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">
              No {category === 'open' ? 'open' : 'unresolved-expiry'} positions.
            </p>
          )}
        </section>
      ))}
      <section className="panel bt-orders">
        <h2>Pending orders ({report.pending_orders.length})</h2>
        <OrderTable orders={report.pending_orders} label="Pending orders" />
        <h3>Cancelled, blocked and unresolved order diagnostics</h3>
        <p>
          Blocked exits: {report.metrics.blocked_exit_count} distinct exit
          orders; {report.metrics.blocked_exit_attempt_count} attempts. Attempts
          are not a count of affected positions. Cancelled entries:{' '}
          {report.metrics.cancelled_entry_count}.
        </p>
        <OrderTable
          orders={report.diagnostics}
          events
          label="Order diagnostics"
        />
        <details>
          <summary>All order events ({report.order_events.length})</summary>
          <OrderTable
            orders={report.order_events}
            events
            label="Order events"
          />
        </details>
      </section>
    </>
  )
}
