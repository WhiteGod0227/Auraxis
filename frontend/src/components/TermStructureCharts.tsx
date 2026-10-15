import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { currency, formatDate } from '@/lib/format'
import { curveChartRows, rolldownChartRows } from '@/lib/termStructure'
import type { CurvePoint, RolldownRow, RolldownSeries } from '@/lib/types'
const money = (v: number | null) =>
  v === null ? 'Unavailable' : currency.format(v)
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
        {row.product} - {formatDate(row.expiry_date)}
      </strong>
      <p>
        {formatDate(row.trade_date)}; {row.days_to_expiry} calendar days to
        expiry
      </p>
      <p>Normalized price: {money(row.close_p10_999)}</p>
      <p>Trade activity: {row.has_trade ? 'Passed' : 'Failed'}</p>
      <p>Volume: {row.volume_grams ?? 'Unavailable'} grams</p>
      <p>Open interest: {row.open_interest_grams ?? 'Unavailable'} grams</p>
      <p>{row.quality_reason || 'No quality reason returned'}</p>
    </div>
  )
}
function RollTooltip({ active, payload }: TooltipInput) {
  const row = payload?.[0]?.payload as RolldownRow | undefined
  if (!active || !row) return null
  return (
    <div className="ts-tooltip">
      <strong>{formatDate(row.trade_date)}</strong>
      <p>
        Previous: {formatDate(row.previous_trade_date)}; elapsed{' '}
        {row.elapsed_days} calendar days
      </p>
      <p>Next expiry: {formatDate(row.next_expiry_used)}</p>
      <p>Raw change: {row.raw_change ?? 'Unavailable'} Rs per 10 g</p>
      <p>
        Estimated roll-down:{' '}
        {row.decomposition_valid
          ? (row.estimated_roll_down ?? 'Unavailable')
          : 'Unavailable'}{' '}
        Rs per 10 g
      </p>
      <p>
        Residual change:{' '}
        {row.decomposition_valid
          ? (row.residual_change ?? 'Unavailable')
          : 'Unavailable'}{' '}
        Rs per 10 g
      </p>
      <p>
        Valid: {String(row.decomposition_valid)} {row.reason}
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
    <circle cx={cx} cy={cy} r={4} fill="#F5B942" stroke="#0B0E14" />
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
      fill="#141922"
      stroke="#9AA6B8"
      strokeWidth={2}
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
        <LineChart
          data={rows}
          accessibilityLayer
          margin={{ top: 20, right: 24, left: 8, bottom: 24 }}
        >
          <CartesianGrid stroke="#232B38" vertical={false} />
          <XAxis
            type="number"
            dataKey="days_to_expiry"
            domain={['dataMin', 'dataMax']}
            stroke="#9AA6B8"
            label={{
              value: 'Calendar days to expiry',
              position: 'insideBottom',
              offset: -14,
              fill: '#9AA6B8',
            }}
          />
          <YAxis
            width={86}
            domain={['auto', 'auto']}
            stroke="#9AA6B8"
            tickFormatter={(v) => currency.format(Number(v))}
          />
          <Tooltip content={<CurveTooltip />} filterNull={false} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 20 }} />
          <Line
            name="Traded settlement"
            dataKey="traded_price"
            type="linear"
            stroke="#F5B942"
            strokeWidth={2}
            dot={<PrimaryDot />}
            activeDot={{ r: 6 }}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            name="Untraded settlement (hollow)"
            dataKey="untraded_price"
            type="linear"
            stroke="none"
            dot={<HollowDot />}
            activeDot={{ r: 6, fill: '#141922', stroke: '#9AA6B8' }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
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
          margin={{ top: 18, right: 16, left: 8, bottom: 8 }}
        >
          <CartesianGrid stroke="#232B38" vertical={false} />
          <XAxis
            dataKey="trade_date"
            stroke="#9AA6B8"
            minTickGap={36}
            tickFormatter={(v) => formatDate(String(v)).slice(0, 6)}
          />
          <YAxis
            width={84}
            stroke="#9AA6B8"
            tickFormatter={(v) => currency.format(Number(v))}
          />
          <ReferenceLine y={0} stroke="#9AA6B8" />
          <Tooltip content={<RollTooltip />} filterNull={false} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 18 }} />
          <Bar
            dataKey="raw_change"
            name="Raw change"
            fill="#F5B942"
            isAnimationActive={false}
          />
          <Bar
            dataKey="estimated_roll_down"
            name="Estimated roll-down"
            fill="#60A5FA"
            isAnimationActive={false}
          />
          <Bar
            dataKey="residual_change"
            name="Residual change"
            fill="#A78BFA"
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
