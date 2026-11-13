import { useId } from 'react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { gapLevel } from '@/lib/insight'

/** Consistent page title row: title + optional subtitle left, actions right. */
export function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header-row">
        <div className="ui-page-title">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="ui-page-actions">{actions}</div>}
      </div>
      {children}
    </header>
  )
}

/** Underlined tab strip that links between sibling routes. */
export function Tabs({
  label,
  items,
}: {
  label: string
  items: { to: string; label: string }[]
}) {
  return (
    <nav className="ui-tabs" aria-label={label}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end
          className={({ isActive }) => `ui-tab ${isActive ? 'active' : ''}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function GapChip({ z }: { z: number | null | undefined }) {
  const level = gapLevel(z)
  return (
    <span
      className={`ui-chip tone-${level.tone} ${level.strong ? 'strong' : ''}`}
    >
      <span className="ui-chip-dot" aria-hidden="true" />
      {level.chip}
    </span>
  )
}

/** Small "?" that reveals a definition on hover/focus. */
export function InfoTip({ children }: { children: ReactNode }) {
  const id = useId()
  return (
    <span className="ui-info">
      <button
        type="button"
        className="ui-info-button"
        aria-describedby={id}
        aria-label="What does this mean?"
      >
        ?
      </button>
      <span role="tooltip" id={id} className="ui-info-text">
        {children}
      </span>
    </span>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone,
  info,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'up' | 'down' | 'neutral'
  info?: ReactNode
}) {
  return (
    <div className="ui-stat">
      <span className="ui-stat-label">
        {label}
        {info && <InfoTip>{info}</InfoTip>}
      </span>
      <strong className={`ui-stat-value ${tone ? `tone-${tone}` : ''}`}>
        {value}
      </strong>
      {hint && <span className="ui-stat-hint">{hint}</span>}
    </div>
  )
}

const SPARK_COLORS = {
  up: '#4FAE8A',
  down: '#D9705F',
  neutral: 'var(--text-2)',
}

/** Dependency-free inline trend with a soft gradient area. */
export function Sparkline({
  values,
  width = 120,
  height = 36,
  tone = 'neutral',
  color,
}: {
  values: (number | null)[]
  width?: number
  height?: number
  tone?: 'up' | 'down' | 'neutral'
  color?: string
}) {
  const id = useId().replace(/:/g, '')
  const points = values
    .map((value, index) => ({ value, index }))
    .filter(
      (p): p is { value: number; index: number } =>
        typeof p.value === 'number' && Number.isFinite(p.value),
    )
  if (points.length < 2) return <span className="ui-sparkline-empty" />
  const min = Math.min(...points.map((p) => p.value))
  const max = Math.max(...points.map((p) => p.value))
  const span = max - min || 1
  const last = values.length - 1 || 1
  const coords = points.map((p) => [
    (p.index / last) * (width - 4) + 2,
    height - 3 - ((p.value - min) / span) * (height - 8),
  ])
  const line = coords
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')
  const area = `${line} L${coords.at(-1)![0].toFixed(1)},${height} L${coords[0][0].toFixed(1)},${height} Z`
  const stroke = color ?? SPARK_COLORS[tone]
  const [endX, endY] = coords.at(-1)!
  return (
    <svg
      className={`ui-sparkline tone-${tone}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.32" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={area}
        fill={`url(#spark-${id})`}
        stroke="none"
        className="spark-area"
      />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        className="spark-line"
        pathLength={1}
      />
      <circle cx={endX} cy={endY} r="2.6" fill={stroke} className="spark-dot" />
    </svg>
  )
}

export function Skeleton({ height = 120 }: { height?: number }) {
  return (
    <div
      className="ui-skeleton"
      style={{ height }}
      role="status"
      aria-label="Loading"
    />
  )
}

/** One collapsible "How is this calculated?" per page. */
export function HowItWorks({
  title = 'How is this calculated?',
  children,
}: {
  title?: string
  children: ReactNode
}) {
  return (
    <details className="ui-how">
      <summary>{title}</summary>
      <div className="ui-how-body">{children}</div>
    </details>
  )
}
