import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { gapLevel } from '@/lib/insight'
import { HIGH, LOW, NORMAL, PALETTE } from '@/lib/chartTheme'

/** True one frame after mount, so CSS transitions animate from zero. */
function useMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  return mounted
}

/** Semi-circular gauge for "how unusual": −3σ … +3σ with an animated needle. */
export function ZGauge({
  z,
  size = 240,
  caption,
}: {
  z: number | null | undefined
  size?: number
  caption?: ReactNode
}) {
  const mounted = useMounted()
  const finite = typeof z === 'number' && Number.isFinite(z)
  const value = finite ? Math.max(-3, Math.min(3, z)) : 0
  const cx = 120
  const cy = 118
  const r = 96
  const point = (v: number, radius = r) => {
    const angle = Math.PI - ((v + 3) / 6) * Math.PI
    return [
      cx + radius * Math.cos(angle),
      cy - radius * Math.sin(angle),
    ] as const
  }
  const arc = (from: number, to: number, radius = r) => {
    const [x1, y1] = point(from, radius)
    const [x2, y2] = point(to, radius)
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${radius} ${radius} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
  }
  const zones: [number, number, string, number][] = [
    [-3, -2, LOW, 1],
    [-2, -1, LOW, 0.45],
    [-1, 1, NORMAL, 0.85],
    [1, 2, HIGH, 0.45],
    [2, 3, HIGH, 1],
  ]
  // Needle drawn pointing straight up (0σ) and rotated into place.
  const rotation = mounted && finite ? (value / 3) * 90 : -90
  const level = gapLevel(z)
  return (
    <figure className="lux-gauge" style={{ width: size }}>
      <svg
        viewBox="0 0 240 150"
        width={size}
        role="img"
        aria-label={`vs usual: ${finite ? z.toFixed(2) : 'not available'} standard deviations, ${level.chip}`}
      >
        <path
          d={arc(-3, 3)}
          stroke="rgb(var(--ink-rgb) / 6%)"
          strokeWidth="18"
          fill="none"
        />
        {zones.map(([from, to, color, opacity]) => (
          <path
            key={from}
            d={arc(from + 0.04, to - 0.04)}
            stroke={color}
            strokeOpacity={opacity}
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
          />
        ))}
        {[-3, -2, -1, 0, 1, 2, 3].map((tick) => {
          const [tx, ty] = point(tick, r + 15)
          return (
            <text
              key={tick}
              x={tx}
              y={ty + 3}
              textAnchor="middle"
              fontSize="9.5"
              fill="var(--axis)"
            >
              {tick > 0 ? `+${tick}` : tick}
            </text>
          )
        })}
        {finite && (
          <g className="needle" style={{ transform: `rotate(${rotation}deg)` }}>
            <line
              x1={cx}
              y1={cy}
              x2={cx}
              y2={cy - r + 20}
              stroke="var(--text-strong)"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx={cx} cy={cy} r="8" fill="var(--text-strong)" />
            <circle cx={cx} cy={cy} r="3" fill="var(--panel)" />
          </g>
        )}
      </svg>
      <figcaption>
        <strong>
          {finite
            ? `${z > 0 ? '+' : z < 0 ? '−' : ''}${Math.abs(z).toFixed(2)}σ`
            : '—'}
        </strong>
        <span className={`lux-gauge-label tone-${level.tone}`}>
          {level.chip}
        </span>
        {caption && <small>{caption}</small>}
      </figcaption>
    </figure>
  )
}

/** Circular progress ring that sweeps in; value is 0–1. */
export function Ring({
  value,
  size = 112,
  stroke = 10,
  color = PALETTE.jade,
  label,
  center,
}: {
  value: number | null | undefined
  size?: number
  stroke?: number
  color?: string
  label?: ReactNode
  center?: ReactNode
}) {
  const mounted = useMounted()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const finite = typeof value === 'number' && Number.isFinite(value)
  const v = finite ? Math.max(0, Math.min(1, value)) : 0
  return (
    <figure className="lux-ring" style={{ width: size }}>
      <div className="lux-ring-art" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgb(var(--ink-rgb) / 7%)"
            strokeWidth={stroke}
          />
          {finite && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${(mounted ? c * v : 0).toFixed(2)} ${c.toFixed(2)}`}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="lux-ring-arc"
            />
          )}
        </svg>
        <div className="lux-ring-center">
          {center ?? (
            <strong>{finite ? `${Math.round(v * 100)}%` : '—'}</strong>
          )}
        </div>
      </div>
      {label && <figcaption>{label}</figcaption>}
    </figure>
  )
}

/** Multi-segment colour donut with legend; segments sweep in on mount. */
export function Donut({
  data,
  size = 170,
  stroke = 22,
  center,
}: {
  data: {
    label: string
    value: number
    color: string
    display?: string
    note?: string
  }[]
  size?: number
  stroke?: number
  center?: ReactNode
}) {
  const mounted = useMounted()
  const total = data.reduce((sum, item) => sum + Math.max(0, item.value), 0)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="lux-donut">
      <div className="lux-ring-art" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgb(var(--ink-rgb) / 5%)"
            strokeWidth={stroke}
          />
          {total > 0 &&
            data.map((item) => {
              const length = (Math.max(0, item.value) / total) * c
              const gap = data.length > 1 ? Math.min(4, length / 3) : 0
              const shown = mounted ? Math.max(0, length - gap) : 0
              const segment = (
                <circle
                  key={item.label}
                  className="seg"
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${shown.toFixed(2)} ${c.toFixed(2)}`}
                  strokeDashoffset={(-offset).toFixed(2)}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                >
                  <title>
                    {item.label}:{' '}
                    {item.display ??
                      `${Math.round((Math.max(0, item.value) / total) * 100)}%`}
                  </title>
                </circle>
              )
              offset += length
              return segment
            })}
        </svg>
        <div className="lux-ring-center">{center}</div>
      </div>
      <ul className="lux-legend">
        {data.map((item) => (
          <li key={item.label}>
            <span className="lux-swatch" style={{ background: item.color }} />
            <span>
              {item.label}
              {item.note && <em className="lux-note">{item.note}</em>}
            </span>
            <strong>
              {item.display ??
                (total
                  ? `${Math.round((Math.max(0, item.value) / total) * 100)}%`
                  : '—')}
            </strong>
          </li>
        ))}
      </ul>
    </div>
  )
}
