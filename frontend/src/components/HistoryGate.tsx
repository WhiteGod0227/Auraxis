import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MIN_SESSIONS } from '@/lib/history'
import { Ring } from './LuxCharts'
import { inr } from '@/lib/insight'
import { productColor } from '@/lib/chartTheme'

/** Card explaining what unlocks with more history, with progress. */
export function HistoryGate({
  sessions,
  need = MIN_SESSIONS,
  title,
  children,
  compact = false,
}: {
  sessions: number
  need?: number
  title: string
  children?: ReactNode
  compact?: boolean
}) {
  const missing = Math.max(0, need - sessions)
  return (
    <section
      className={`ui-card history-gate ${compact ? 'compact' : ''}`}
      aria-label={title}
    >
      <Ring
        value={sessions / need}
        size={compact ? 64 : 96}
        stroke={compact ? 6 : 8}
        color="#5E97D0"
        center={
          <span className="history-gate-count">
            <strong>{sessions}</strong>
            <small>/ {need}</small>
          </span>
        }
      />
      <div className="history-gate-body">
        <p className="kicker">Building history</p>
        <h2>{title}</h2>
        <p>
          {children ??
            `Auraxis compares each gap with its own recent past. ${
              missing === 1
                ? '1 more trading day'
                : `${missing} more trading days`
            } of MCX Bhavcopy will unlock this view.`}
        </p>
      </div>
      <Link className="ui-button primary" to="/app/import">
        Import more days
      </Link>
    </section>
  )
}

/** Today's price per 10 g for each product, on a shared close-up scale. */
export function PriceLadder({
  items,
}: {
  items: { product: string; price: number | null }[]
}) {
  const rows = items.filter(
    (item): item is { product: string; price: number } =>
      typeof item.price === 'number' && Number.isFinite(item.price),
  )
  if (!rows.length) return null
  const prices = rows.map((row) => row.price)
  const low = Math.min(...prices)
  const high = Math.max(...prices)
  const span = Math.max(1, high - low)
  return (
    <ul className="price-ladder" aria-label="Price per 10 g by product">
      {[...rows]
        .sort((x, y) => y.price - x.price)
        .map((row, index) => {
          const share = 0.18 + ((row.price - low) / span) * 0.82
          const color = productColor(row.product, index)
          return (
            <li key={row.product}>
              <span className="price-ladder-name">
                <i style={{ background: color }} aria-hidden="true" />
                {row.product}
              </span>
              <span className="price-ladder-track">
                <span
                  className="price-ladder-bar"
                  style={
                    {
                      '--w': `${(share * 100).toFixed(1)}%`,
                      '--c': color,
                      animationDelay: `${index * 90}ms`,
                    } as React.CSSProperties
                  }
                />
              </span>
              <strong>{inr(row.price)}</strong>
              <em>
                {row.price === low ? 'cheapest' : `+${inr(row.price - low)}`}
              </em>
            </li>
          )
        })}
    </ul>
  )
}
