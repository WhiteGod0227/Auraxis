import { useId } from 'react'
import { Link } from 'react-router-dom'
import { GapChip } from '@/components/ui'
import { productColor } from '@/lib/chartTheme'
import {
  inr,
  pairLabel,
  pairParts,
  shortDate,
  signedInr,
  signedPct,
} from '@/lib/insight'
import type { PairSummary } from '@/lib/types'

/** Same-expiry pairs can be practised as a pair trade. */
const PRACTICE_PAIRS = [
  'GOLDTEN-GOLDPETAL',
  'GOLDTEN-GOLDGUINEA',
  'GOLDGUINEA-GOLDPETAL',
]

const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const toneOf = (value: number | null | undefined) =>
  finite(value) && value !== 0 ? (value > 0 ? 'up' : 'down') : 'neutral'

function rankText(row: PairSummary, span: number) {
  const p = row.percentile
  if (!finite(p)) return null
  if (p >= 99.5) return `Highest of the last ${span} sessions`
  if (p <= 0.5) return `Lowest of the last ${span} sessions`
  return p >= 50
    ? `Higher than ${Math.round(p)}% of the last ${span} sessions`
    : `Lower than ${Math.round(100 - p)}% of the last ${span} sessions`
}

/** Segmented control. */
export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: readonly T[] | { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  const items = (options as (T | { value: T; label: string })[]).map((item) =>
    typeof item === 'string' ? { value: item, label: item } : item,
  )
  return (
    <div className="seg" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={item.value === value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({
  on,
  onChange,
  children,
}: {
  on: boolean
  onChange: (on: boolean) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="switch"
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      <i aria-hidden="true" />
      {children}
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Pair check (side panel)                                                    */
/* -------------------------------------------------------------------------- */

/** σ scale from −3 to +3 with the current reading marked. */
function SigmaScale({ z }: { z: number | null }) {
  const clamp = finite(z) ? Math.max(-3, Math.min(3, z)) : null
  const at = (value: number) => ((value + 3) / 6) * 100
  return (
    <div className="pk-scale" aria-hidden="true">
      <div className="pk-track">
        {clamp !== null && (
          <span
            className={`pk-fill ${clamp < 0 ? 'is-low' : 'is-high'}`}
            style={{
              left: `${Math.min(at(0), at(clamp))}%`,
              width: `${Math.abs(at(clamp) - at(0))}%`,
            }}
          />
        )}
        {[-3, -2, -1, 0, 1, 2, 3].map((tick) => (
          <i
            key={tick}
            className={Math.abs(tick) === 2 ? 'is-edge' : ''}
            style={{ left: `${at(tick)}%` }}
          />
        ))}
        {clamp !== null && (
          <b
            className={clamp < 0 ? 'is-low' : 'is-high'}
            style={{ left: `${at(clamp)}%` }}
          />
        )}
      </div>
      <div className="pk-scale-labels">
        <span>−3σ</span>
        <span>usual</span>
        <span>+3σ</span>
      </div>
    </div>
  )
}

export function PairCheck({
  pairs,
  selected,
  onSelect,
  moves,
  live,
  settledOn,
  span,
  hasRanks,
  onExplore,
}: {
  pairs: PairSummary[]
  selected: PairSummary | undefined
  onSelect: (pair: string) => void
  moves: Record<string, number | null>
  live: boolean
  /** Latest stored settlement date, for "Since 19 Nov" labels. */
  settledOn?: string | null
  span: number
  hasRanks: boolean
  onExplore: (row: PairSummary) => void
}) {
  const selectId = useId()
  if (!selected)
    return (
      <section className="ui-card pk" id="ov-hero" aria-label="Pair check">
        <h2 className="pk-title">Pair check</h2>
        <p className="ui-muted-note">
          Gaps appear once both products in a pair have prices.
        </p>
      </section>
    )
  const [a, b] = pairParts(selected.pair)
  const move = moves[selected.pair]
  const rank = hasRanks ? rankText(selected, span) : null
  return (
    <section className="ui-card pk" id="ov-hero" aria-labelledby="pk-title">
      <div className="pk-head">
        <h2 className="pk-title" id="pk-title">
          Pair <span>check</span>
        </h2>
        {hasRanks && <GapChip z={selected.z} />}
      </div>
      <label className="pk-label" htmlFor={selectId}>
        Pair
      </label>
      <div className="pk-select">
        <select
          id={selectId}
          value={selected.pair}
          onChange={(event) => onSelect(event.target.value)}
        >
          {pairs.map((row) => (
            <option key={row.pair} value={row.pair}>
              {pairLabel(row.pair)}
              {finite(row.z)
                ? `  (${row.z > 0 ? '+' : '−'}${Math.abs(row.z).toFixed(1)}σ)`
                : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="pk-row pk-row-head">
        <span>Gap per 10 g</span>
        <span>Exp {shortDate(selected.expiry)}</span>
      </div>
      <div className="pk-value">
        <strong>{signedInr(selected.spread_abs)}</strong>
        <sup>{signedPct(selected.spread_pct)}</sup>
        <span className="pk-dots" aria-hidden="true">
          <i style={{ background: productColor(a) }} />
          <i style={{ background: productColor(b) }} />
        </span>
      </div>
      <SigmaScale z={hasRanks ? selected.z : null} />
      <dl className="pk-rows">
        <div>
          <dt>vs usual</dt>
          <dd>
            {hasRanks && finite(selected.z)
              ? `${selected.z > 0 ? '+' : '−'}${Math.abs(selected.z).toFixed(2)}σ`
              : 'Needs more history'}
          </dd>
        </div>
        {rank && (
          <div>
            <dt>Rank</dt>
            <dd>{rank}</dd>
          </div>
        )}
        <div>
          <dt>{live ? `Since ${shortDate(settledOn)} close` : 'Day change'}</dt>
          <dd className={`tone-${toneOf(move)}`}>{signedInr(move)}</dd>
        </div>
        <div>
          <dt>{a}</dt>
          <dd>{inr(selected.a_p10)}</dd>
        </div>
        <div>
          <dt>{b}</dt>
          <dd>{inr(selected.b_p10)}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="ui-button primary pk-cta"
        onClick={() => onExplore(selected)}
      >
        Explore this gap
      </button>
      {PRACTICE_PAIRS.includes(selected.pair) && (
        <Link
          className="ui-button pk-practice"
          to={`/app/practice?pair=${encodeURIComponent(selected.pair)}${
            finite(selected.z) && hasRanks
              ? `&side=${selected.z > 0 ? 'fall' : 'rise'}`
              : ''
          }`}
        >
          Practise this gap with demo money
        </Link>
      )}
      <Link className="pk-link" to="/app/backtest">
        Backtest a rule on this gap →
      </Link>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Gap trend: gradient area for one pair                                      */
/* -------------------------------------------------------------------------- */

export function GapTrend({
  points,
}: {
  points: { trade_date: string; spread_abs: number | null }[]
}) {
  const id = useId().replace(/:/g, '')
  const values = points.filter((point) => finite(point.spread_abs)) as {
    trade_date: string
    spread_abs: number
  }[]
  if (values.length < 2)
    return (
      <p className="ui-muted-note">Gap history appears after two sessions.</p>
    )
  const width = 320
  const height = 120
  const min = Math.min(...values.map((p) => p.spread_abs))
  const max = Math.max(...values.map((p) => p.spread_abs))
  const range = max - min || 1
  const coords = values.map((point, index) => [
    6 + (index / (values.length - 1)) * (width - 12),
    height - 8 - ((point.spread_abs - min) / range) * (height - 20),
  ])
  // Smooth curve through the points (Catmull-Rom → Bézier).
  let line = `M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[i - 1] ?? coords[i]
    const p1 = coords[i]
    const p2 = coords[i + 1]
    const p3 = coords[i + 2] ?? p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    line += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  const area = `${line} L${width},${height} L0,${height} Z`
  const first = values[0]
  const last = values.at(-1)!
  const change = last.spread_abs - first.spread_abs
  const [endX, endY] = coords.at(-1)!
  return (
    <div className="gt">
      <div className="gt-plot">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Gap moved from ${signedInr(first.spread_abs)} to ${signedInr(last.spread_abs)}`}
        >
          <defs>
            <linearGradient id={`gt-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--aqua)" stopOpacity="0.28" />
              <stop offset="1" stopColor="var(--aqua)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#gt-${id})`} />
          <path
            d={line}
            fill="none"
            stroke="var(--aqua)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="gt-dot"
          aria-hidden="true"
          style={{
            left: `${(endX / width) * 100}%`,
            top: `${(endY / height) * 100}%`,
          }}
        />
      </div>
      <div className="gt-foot">
        <span>
          {shortDate(first.trade_date)}: {signedInr(first.spread_abs)}
        </span>
        <span>
          Now {signedInr(last.spread_abs)}{' '}
          <b className={`tone-${toneOf(change)}`}>({signedInr(change)})</b>
        </span>
      </div>
    </div>
  )
}
