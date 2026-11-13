import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { currency, formatDate } from '@/lib/format'
import { curveChartRows, rolldownChartRows } from '@/lib/termStructure'
import type { CurvePoint, RolldownRow, RolldownSeries } from '@/lib/types'
const money = (v: number | null) => (v === null ? '—' : currency.format(v))
const AXIS = 'var(--axis)'
const compactInr = (v: unknown) => {
  const n = Number(v)
  const sign = n < 0 ? '−' : ''
  const size = Math.abs(n)
  return size >= 1000
    ? `${sign}₹${(size / 1000).toFixed(1)}k`
    : `${sign}₹${size.toFixed(0)}`
}
type TooltipInput = {
  active?: boolean
  payload?: readonly { payload?: unknown }[]
}
function CurveTooltip({ active, payload }: TooltipInput) {
  const row = payload?.[0]?.payload as CurvePoint | undefined
  if (!active || !row) return null
  return (
    <div className="ts-tooltip">
      <strong>
        {row.product} · {formatDate(row.expiry_date)}
      </strong>
      <p>{money(row.close_p10_999)} per 10 g</p>
      <p>
        {row.days_to_expiry} days to expiry ·{' '}
        {row.has_trade ? 'traded' : 'no trades'}
      </p>
    </div>
  )
}
function RollTooltip({ active, payload }: TooltipInput) {
  const row = payload?.[0]?.payload as RolldownRow | undefined
  if (!active || !row) return null
  return (
    <div className="ts-tooltip">
      <strong>{formatDate(row.trade_date)}</strong>
      <p>Change: {money(row.raw_change)}</p>
      <p>
        Roll-down:{' '}
        {row.decomposition_valid ? money(row.estimated_roll_down) : '—'}
      </p>
      <p>
        Everything else:{' '}
        {row.decomposition_valid ? money(row.residual_change) : '—'}
      </p>
    </div>
  )
}
function PrimaryDot(props: { cx?: number; cy?: number; value?: unknown }) {
  const { cx, cy, value } = props
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    cx !== undefined &&
    cy !== undefined ? (
    <circle cx={cx} cy={cy} r={4} fill="#5E97D0" stroke="var(--panel)" />
  ) : (
    <g />
  )
}
function HollowDot(props: { cx?: number; cy?: number; value?: unknown }) {
  const { cx, cy, value } = props
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    cx !== undefined &&
    cy !== undefined ? (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill="var(--panel)"
      stroke="#9A9AA2"
      strokeWidth={1.5}
    />
  ) : (
    <g />
  )
}
export function ExpiryCurveChart({
  points,
  unit,
}: {
  points: CurvePoint[]
  unit: string
}) {
  const rows = curveChartRows(points)
  return (
    <div
      className="chart-container ts-curve-chart"
      role="img"
      aria-label={`Expiry curve: numeric calendar days to expiry; prices in ${unit}. Hollow markers are untraded and break the traded line. Equivalent observations are in the curve table.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          accessibilityLayer
          margin={{ top: 12, right: 16, left: 0, bottom: 4 }}
        >
          <CartesianGrid stroke="rgb(var(--ink-rgb) / 6%)" vertical={false} />
          <XAxis
            type="number"
            dataKey="days_to_expiry"
            domain={['dataMin', 'dataMax']}
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}d`}
          />
          <YAxis
            width={64}
            domain={['auto', 'auto']}
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            tickFormatter={compactInr}
          />
          <Tooltip content={<CurveTooltip />} filterNull={false} />
          <Legend
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, paddingTop: 10, color: '#B4B4BA' }}
          />
          <defs>
            <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#5E97D0" stopOpacity={0.3} />
              <stop offset="1" stopColor="#5E97D0" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            dataKey="traded_price"
            type="linear"
            stroke="none"
            fill="url(#curve-fill)"
            connectNulls={false}
            isAnimationActive
            animationDuration={1000}
            legendType="none"
            tooltipType="none"
          />
          <Line
            name="Traded"
            dataKey="traded_price"
            type="linear"
            stroke="#5E97D0"
            strokeWidth={1.75}
            dot={<PrimaryDot />}
            activeDot={{ r: 6 }}
            connectNulls={false}
            isAnimationActive
            animationDuration={1000}
          />
          <Line
            name="No trades (hollow)"
            dataKey="untraded_price"
            type="linear"
            stroke="none"
            dot={<HollowDot />}
            activeDot={{ r: 6, fill: '#161618', stroke: '#9AA6B8' }}
            connectNulls={false}
            isAnimationActive
            animationDuration={1000}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
export function RolldownChart({
  series,
  unit,
}: {
  series: RolldownSeries
  unit: string
}) {
  const rows = rolldownChartRows(series)
  return (
    <div
      className="chart-container ts-roll-chart"
      role="img"
      aria-label={`Fixed-expiry ${series.expiry_date} session changes in ${unit}: raw change, estimated roll-down and residual change. Invalid decompositions remain unavailable; equivalent details are in the diagnostics table.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          accessibilityLayer
          margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
          stackOffset="sign"
        >
          <CartesianGrid stroke="rgb(var(--ink-rgb) / 6%)" vertical={false} />
          <XAxis
            dataKey="trade_date"
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
            tickFormatter={(v) => formatDate(String(v)).slice(0, 6)}
          />
          <YAxis
            width={64}
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            tickFormatter={compactInr}
          />
          <ReferenceLine y={0} stroke="rgb(var(--ink-rgb) / 25%)" />
          <Tooltip
            content={<RollTooltip />}
            filterNull={false}
            cursor={{ fill: 'rgb(var(--ink-rgb) / 4%)' }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 10, color: '#B4B4BA' }}
          />
          <Bar
            dataKey="estimated_roll_down"
            name="Roll-down"
            stackId="change"
            maxBarSize={56}
            fill="#5E97D0"
            isAnimationActive
            animationDuration={1000}
          />
          <Bar
            dataKey="residual_change"
            name="Everything else"
            stackId="change"
            maxBarSize={56}
            fill="#CA723C"
            isAnimationActive
            animationDuration={1000}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
