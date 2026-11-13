import { useState } from 'react'
import { diagnosticText } from './DiagnosticLabel'
import { legDirection } from '@/lib/backtest'
import { inr, longDate, signedInr } from '@/lib/insight'
import type { BacktestReport, OutstandingPosition } from '@/lib/types'

type View = 'completed' | 'open' | 'unresolved'

const tone = (value: number | null) =>
  typeof value === 'number' && value !== 0
    ? value > 0
      ? 'tone-up'
      : 'tone-down'
    : ''

function PositionRows({ rows }: { rows: OutstandingPosition[] }) {
  return (
    <table className="ui-table">
      <thead>
        <tr>
          <th>Position</th>
          <th>Entered</th>
          <th className="num">Held</th>
          <th className="num">Entry costs</th>
          <th className="num">Value now</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.position_id}>
            <td>{legDirection(row.side, row.pair)}</td>
            <td>{longDate(row.entry_date)}</td>
            <td className="num">{row.holding_sessions} sessions</td>
            <td className="num">{inr(row.entry_costs)}</td>
            <td className={`num ${tone(row.net_marked_pnl)}`}>
              {signedInr(row.net_marked_pnl)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** One card listing simulated trades, switchable by status. */
export default function BacktestTables({ report }: { report: BacktestReport }) {
  const open = report.open_positions
  const unresolved = report.unresolved_positions
  const [view, setView] = useState<View>(
    report.completed_trades.length || !open.length ? 'completed' : 'open',
  )
  const tabs: [View, string, number][] = [
    ['completed', 'Completed', report.completed_trades.length],
    ['open', 'Open', open.length],
  ]
  if (unresolved.length) tabs.push(['unresolved', 'Expired', unresolved.length])
  const pending = report.metrics.pending_order_count
  return (
    <section className="ui-card" aria-labelledby="bt-trades-title">
      <div className="ui-card-head">
        <h2 id="bt-trades-title">Trades</h2>
        <div className="ui-segmented" role="group" aria-label="Trade status">
          {tabs.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      </div>
      <div className="ui-table-scroll">
        {view === 'completed' ? (
          report.completed_trades.length ? (
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Entered</th>
                  <th>Exited</th>
                  <th className="num">Held</th>
                  <th className="num">Costs</th>
                  <th className="num">Net profit</th>
                  <th>Why it closed</th>
                </tr>
              </thead>
              <tbody>
                {report.completed_trades.map((trade) => (
                  <tr key={trade.position_id}>
                    <td>{legDirection(trade.side, trade.pair)}</td>
                    <td>{longDate(trade.entry_date)}</td>
                    <td>{longDate(trade.exit_date)}</td>
                    <td className="num">{trade.holding_sessions} sessions</td>
                    <td className="num">{inr(trade.total_costs)}</td>
                    <td
                      className={`num ${tone(trade.net_pnl)}`}
                      title={`Before costs ${signedInr(trade.gross_pnl)}`}
                    >
                      {signedInr(trade.net_pnl)}
                    </td>
                    <td className="cmp-notes">
                      {diagnosticText(trade.exit_reason)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No completed trades in this period.</p>
          )
        ) : view === 'open' ? (
          open.length ? (
            <PositionRows rows={open} />
          ) : (
            <p className="empty-state">No open positions.</p>
          )
        ) : (
          <>
            <p className="ui-muted-note">
              These contracts expired before the position could be closed, so
              the outcome can't be confirmed.
            </p>
            <PositionRows rows={unresolved} />
          </>
        )}
      </div>
      {pending > 0 && (
        <p className="ui-muted-note bt-pending">
          {pending} order{pending === 1 ? '' : 's'} waiting for the next
          session.
        </p>
      )}
    </section>
  )
}
