import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { GapChip } from '@/components/ui'
import { gapLevel } from '@/lib/insight'
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

/** Where today's gap sits against its usual level, in words first. */
const ZONES = [
  { from: -3, to: -2, tone: 'low', strong: true },
  { from: -2, to: -1, tone: 'low', strong: false },
  { from: -1, to: 1, tone: 'usual', strong: false },
  { from: 1, to: 2, tone: 'high', strong: false },
  { from: 2, to: 3, tone: 'high', strong: true },
] as const

function UsualGauge({ z, span }: { z: number | null; span: number }) {
  if (!finite(z))
    return (
      <p className="pk-gauge-note">
        A reading appears once there is enough history.
      </p>
    )
  const at = (value: number) => ((value + 3) / 6) * 100
  const clamp = Math.max(-3, Math.min(3, z))
  const level = gapLevel(z)
  const size = Math.abs(z)
  const where = z >= 0 ? 'above' : 'below'
  return (
    <div className="pk-gauge">
      <p className="pk-gauge-head">
        <strong className={`tone-${level.tone}`}>
          {level.chip === 'Normal' ? 'Within its usual range' : level.chip}
        </strong>
        <span>
          {size < 0.05
            ? `Right at its ${span}-session average`
            : `${size.toFixed(1)}σ ${where} its ${span}-session average`}
        </span>
      </p>
      <div
        className="pk-gauge-track"
        role="img"
        aria-label={`${level.chip}: ${size.toFixed(1)} standard deviations ${where} average`}
      >
        {ZONES.map((zone) => (
          <i
            key={zone.from}
            className={`is-${zone.tone} ${zone.strong ? 'is-strong' : ''}`}
            style={{ width: `${((zone.to - zone.from) / 6) * 100}%` }}
          />
        ))}
        <b
          className={`is-${level.tone}`}
          style={{ left: `${at(clamp)}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="pk-gauge-labels" aria-hidden="true">
        <span>Unusually low</span>
        <span>Usual</span>
        <span>Unusually high</span>
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
      <UsualGauge z={hasRanks ? selected.z : null} span={span} />
      <dl className="pk-rows">
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
/* Gap trend: one pair's gap, drawn exactly (no smoothing)                    */
/* -------------------------------------------------------------------------- */

/** Round axis labels to a sensible rupee step. */
const tidy = (value: number) => {
  const size = Math.abs(value)
  const step = size >= 1000 ? 50 : size >= 200 ? 10 : size >= 50 ? 5 : 1
  return Math.round(value / step) * step
}

export function GapTrend({
  points,
}: {
  points: { trade_date: string; spread_abs: number | null }[]
}) {
  const [hover, setHover] = useState<number | null>(null)
  const values = points.filter((point) => finite(point.spread_abs)) as {
    trade_date: string
    spread_abs: number
  }[]
  if (values.length < 2)
    return (
      <p className="ui-muted-note">Gap history appears after two sessions.</p>
    )
  const nums = values.map((p) => p.spread_abs)
  const mean = nums.reduce((sum, v) => sum + v, 0) / nums.length
  const sd = Math.sqrt(
    nums.reduce((sum, v) => sum + (v - mean) ** 2, 0) / nums.length,
  )
  const lo = Math.min(...nums, mean - sd)
  const hi = Math.max(...nums, mean + sd)
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.1
  const min = lo - pad
  const max = hi + pad
  const width = 300
  const height = 150
  const x = (index: number) => (index / (values.length - 1)) * width
  const y = (value: number) => ((max - value) / (max - min)) * height
  const pct = (value: number, total: number) => `${(value / total) * 100}%`
  const line = values
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.spread_abs).toFixed(1)}`,
    )
    .join(' ')
  const first = values[0]
  const last = values.at(-1)!
  const change = last.spread_abs - first.spread_abs
  const ticks = [max - pad, (max + min) / 2, min + pad]
  const active = hover === null ? null : values[hover]
  return (
    <div className="gt gt-honest">
      <div className="gt-frame">
        <div className="gt-axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ top: pct(y(tick), height) }}>
              {signedInr(tidy(tick))}
            </span>
          ))}
        </div>
        <div
          className="gt-plot"
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const ratio = (event.clientX - rect.left) / rect.width
            const index = Math.round(ratio * (values.length - 1))
            setHover(Math.max(0, Math.min(values.length - 1, index)))
          }}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Gap moved from ${signedInr(first.spread_abs)} to ${signedInr(last.spread_abs)} over ${values.length} sessions; typical range ${signedInr(tidy(mean - sd))} to ${signedInr(tidy(mean + sd))}`}
          >
            {ticks.map((tick) => (
              <line
                key={tick}
                className="gt-grid"
                x1="0"
                x2={width}
                y1={y(tick)}
                y2={y(tick)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <rect
              className="gt-band"
              x="0"
              width={width}
              y={y(mean + sd)}
              height={Math.max(0, y(mean - sd) - y(mean + sd))}
            />
            <line
              className="gt-mean"
              x1="0"
              x2={width}
              y1={y(mean)}
              y2={y(mean)}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={line}
              fill="none"
              stroke="var(--aqua)"
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {values.map((p, i) => (
            <i
              key={p.trade_date}
              className={`gt-point ${i === values.length - 1 ? 'is-last' : ''} ${i === hover ? 'is-hover' : ''}`}
              aria-hidden="true"
              style={{
                left: pct(x(i), width),
                top: pct(y(p.spread_abs), height),
              }}
            />
          ))}
          {active && hover !== null && (
            <div
              className={`gt-tip ${hover > (values.length - 1) / 2 ? 'is-left' : ''}`}
              style={{ left: pct(x(hover), width) }}
            >
              <span>{shortDate(active.trade_date)}</span>
              <b>{signedInr(active.spread_abs)}</b>
            </div>
          )}
        </div>
      </div>
      <div className="gt-legend" aria-hidden="true">
        <span>
          <i className="is-line" />
          Gap
        </span>
        <span>
          <i className="is-band" />
          Typical range (±1σ)
        </span>
        <span>
          <i className="is-mean" />
          Average {signedInr(tidy(mean))}
        </span>
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
