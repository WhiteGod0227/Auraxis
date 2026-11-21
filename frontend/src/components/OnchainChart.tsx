import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { AXIS, GRID, compactInr } from '@/lib/chartTheme'
import type { OnchainHistoryPoint } from '@/lib/onchain'

const label = (iso: string, year = false) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
const inr = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`
const signed = (value: number) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${inr(Math.abs(value))}`

interface Row {
  date: string
  mcx: number
  parity: number | null
  gap: number | null
  gapPct: number | null
  duty: number
}

function Tip({ active, payload }: TooltipContentProps<number, string>) {
  const row = payload?.[0]?.payload as Row | undefined
  if (!active || !row) return null
  return (
    <div className="pc-tip">
      <strong>{label(row.date, true)}</strong>
      <span>
        <i className="pc-dot is-main" />
        MCX settle: <b>{inr(row.mcx)}</b>
      </span>
      <span>
        <i className="pc-dot" style={{ background: 'var(--aqua)' }} />
        Token parity: <b>{row.parity === null ? '—' : inr(row.parity)}</b>
      </span>
      {row.gap !== null && row.gapPct !== null && (
        <span>
          Gap: <b>{signed(row.gap)}</b> ({row.gapPct > 0 ? '+' : ''}
          {row.gapPct.toFixed(2)}%)
        </span>
      )}
      <span>Import duty: {row.duty}%</span>
    </div>
  )
}

/** MCX settlement vs tokenized-gold parity (₹ per 10 g), daily. */
export default function OnchainChart({
  points,
  token,
  dutyChanges,
}: {
  points: OnchainHistoryPoint[]
  token: 'PAXG' | 'XAUT'
  dutyChanges: { start: string; pct: number }[]
}) {
  const rows: Row[] = points.map((point) => {
    const parity = point[`${token}_parity`]
    const gap = point[`${token}_gap`]
    return {
      date: point.date,
      mcx: point.mcx_p10,
      parity,
      gap,
      gapPct: parity && gap !== null ? (100 * gap) / parity : null,
      duty: point.duty_pct,
    }
  })
  if (rows.length < 2)
    return (
      <p className="ui-muted-note pc-empty">
        Not enough overlapping history yet.
      </p>
    )
  const first = rows[0].date
  const last = rows.at(-1)!.date
  const changes = dutyChanges.filter((c) => c.start > first && c.start <= last)
  return (
    <div
      className="pc-chart"
      role="img"
      aria-label={`MCX settlement against ${token} parity per 10 g from ${label(first)} to ${label(last)}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
            tick={{ fontSize: 11 }}
            tickFormatter={(value) => label(String(value))}
          />
          <YAxis
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            width={62}
            tick={{ fontSize: 11 }}
            domain={['auto', 'auto']}
            tickFormatter={compactInr}
          />
          <Tooltip
            cursor={{
              stroke: 'rgb(var(--ink-rgb) / 35%)',
              strokeDasharray: '3 3',
            }}
            content={(props) => (
              <Tip {...(props as TooltipContentProps<number, string>)} />
            )}
          />
          {changes.map((change) => (
            <ReferenceLine
              key={change.start}
              x={rows.find((row) => row.date >= change.start)?.date}
              stroke="var(--amber)"
              strokeDasharray="4 4"
              label={{
                value: `Duty ${change.pct}%`,
                position: 'insideTopRight',
                fill: 'var(--amber)',
                fontSize: 11,
              }}
            />
          ))}
          <Line
            type="linear"
            dataKey="mcx"
            stroke="var(--text-strong)"
            strokeWidth={1.8}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="parity"
            stroke="var(--aqua)"
            strokeWidth={1.8}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
