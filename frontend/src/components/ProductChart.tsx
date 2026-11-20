import {
  Bar,
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
import { AXIS, GRID, compactInr, productColor } from '@/lib/chartTheme'
import { grams } from '@/lib/insight'
import type { PriceSeries } from '@/lib/types'

export type ChartMetric = 'price' | 'oi'
export type ChartRange = '1M' | '3M' | '6M' | '1Y' | 'All'

const RANGE_DAYS: Record<ChartRange, number | null> = {
  '1M': 31,
  '3M': 92,
  '6M': 183,
  '1Y': 366,
  All: null,
}

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const label = (iso: string, withYear = false) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
const kg = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  const k = n / 1000
  return k >= 1000 ? `${(k / 1000).toFixed(1)}t` : `${Math.round(k)} kg`
}

interface Row {
  date: string
  value: number | null
  volume: number | null
  live?: boolean
  [key: string]: number | string | boolean | null | undefined
}

function ChartTip({
  active,
  payload,
  label: date,
  metric,
  others,
}: TooltipContentProps<number, string> & {
  metric: ChartMetric
  others: string[]
}) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as Row | undefined
  if (!row) return null
  return (
    <div className="pc-tip">
      <strong>
        {label(String(date), true)}
        {row.live ? ' · live' : ''}
      </strong>
      <span>
        <i className="pc-dot is-main" />
        {metric === 'price' ? 'Price' : 'Open interest'}:{' '}
        <b>
          {typeof row.value === 'number'
            ? metric === 'price'
              ? `₹${Math.round(row.value).toLocaleString('en-IN')}`
              : grams(row.value)
            : '—'}
        </b>
      </span>
      <span>
        <i className="pc-dot is-volume" />
        Volume:{' '}
        <b>{typeof row.volume === 'number' ? grams(row.volume) : '—'}</b>
      </span>
      {others.map((product) =>
        typeof row[product] === 'number' ? (
          <span key={product}>
            <i
              className="pc-dot"
              style={{ background: productColor(product) }}
            />
            {product}:{' '}
            <b>₹{Math.round(row[product] as number).toLocaleString('en-IN')}</b>
          </span>
        ) : null,
      )}
    </div>
  )
}

/**
 * One product's price (or open interest) with daily volume bars underneath,
 * optionally overlaid with the other products' prices.
 */
export default function ProductChart({
  product,
  series,
  metric,
  range,
  showVolume,
  compare,
}: {
  product: string
  series: PriceSeries[]
  metric: ChartMetric
  range: ChartRange
  showVolume: boolean
  compare: boolean
}) {
  const main = series.find((item) => item.product === product)
  const history = main?.history ?? []
  const lastDay = history.at(-1)?.trade_date
  const span = RANGE_DAYS[range]
  const from = lastDay && span ? day(lastDay) - span * 86_400_000 : -Infinity
  const others = compare
    ? series.filter((item) => item.product !== product).map((s) => s.product)
    : []
  const lookup = Object.fromEntries(
    series.map((item) => [
      item.product,
      new Map(item.history.map((point) => [point.trade_date, point])),
    ]),
  )
  const rows: Row[] = history
    .filter((point) => day(point.trade_date) >= from)
    .map((point) => {
      const row: Row = {
        date: point.trade_date,
        value:
          metric === 'price'
            ? point.has_trade
              ? point.close_p10_999
              : null
            : (point.open_interest_grams ?? null),
        volume: point.volume_grams ?? null,
        live: point.quality_reason === 'live',
      }
      for (const other of others) {
        const match = lookup[other]?.get(point.trade_date)
        row[other] =
          match?.has_trade && typeof match.close_p10_999 === 'number'
            ? match.close_p10_999
            : null
      }
      return row
    })
  const last = [...rows].reverse().find((row) => typeof row.value === 'number')
  const maxVolume = Math.max(0, ...rows.map((row) => row.volume ?? 0))
  const color = compare ? productColor(product) : 'var(--text-strong)'
  const yearChange =
    rows.length > 1 && rows[0].date.slice(0, 4) !== lastDay?.slice(0, 4)

  if (rows.length < 2)
    return (
      <p className="ui-muted-note pc-empty">
        Not enough history in this range yet.
      </p>
    )

  return (
    <div
      className="pc-chart"
      role="img"
      aria-label={`${product} ${metric === 'price' ? 'price per 10 g' : 'open interest'} with daily volume, ${label(rows[0].date)} to ${label(rows.at(-1)!.date)}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
          barCategoryGap={1}
        >
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            minTickGap={36}
            tick={{ fontSize: 11 }}
            tickFormatter={(value) =>
              label(String(value), yearChange && String(value).endsWith('-01'))
            }
          />
          <YAxis
            yAxisId="value"
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            width={62}
            tick={{ fontSize: 11 }}
            domain={['auto', 'auto']}
            tickFormatter={metric === 'price' ? compactInr : kg}
          />
          <YAxis
            yAxisId="volume"
            orientation="right"
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            width={showVolume ? 54 : 0}
            tick={showVolume ? { fontSize: 11 } : false}
            domain={[0, Math.max(maxVolume * 3, 1)]}
            tickFormatter={kg}
          />
          <Tooltip
            cursor={{
              stroke: 'rgb(var(--ink-rgb) / 35%)',
              strokeDasharray: '3 3',
            }}
            content={(props) => (
              <ChartTip
                {...(props as TooltipContentProps<number, string>)}
                metric={metric}
                others={others}
              />
            )}
          />
          {showVolume && (
            <Bar
              yAxisId="volume"
              dataKey="volume"
              fill="var(--lavender)"
              fillOpacity={0.5}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
          )}
          {last && typeof last.value === 'number' && (
            <ReferenceLine
              yAxisId="value"
              y={last.value}
              stroke="rgb(var(--ink-rgb) / 30%)"
              strokeDasharray="4 4"
            />
          )}
          {others.map((other) => (
            <Line
              key={other}
              yAxisId="value"
              type="linear"
              dataKey={other}
              stroke={productColor(other)}
              strokeWidth={1.4}
              strokeOpacity={0.9}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
          <Line
            yAxisId="value"
            type="linear"
            dataKey="value"
            stroke={color}
            strokeWidth={1.8}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--panel)' }}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
