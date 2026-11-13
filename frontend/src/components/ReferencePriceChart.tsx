import {
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { referenceChartRows } from '@/lib/chart'
import { currency, formatDate } from '@/lib/format'
import {
  AXIS,
  GRID,
  compactInr,
  draw,
  legendStyle,
  productColor,
  tooltipStyle,
} from '@/lib/chartTheme'
import type { PricesResponse } from '@/lib/types'

/** One clean line per product, each in its own colour. */
export default function ReferencePriceChart({
  response,
}: {
  response: PricesResponse
}) {
  const chartRows = referenceChartRows(response.series)
  return (
    <div
      className="chart-container"
      role="img"
      aria-label={`Fixed-expiry prices in ${response.normalization.unit}. ${response.series.map((s) => `${s.product}, expiry ${s.expiry_date}`).join('; ')}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chartRows}
          margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
          accessibilityLayer
        >
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
            tickFormatter={(value) => formatDate(String(value)).slice(0, 6)}
          />
          <YAxis
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            width={64}
            domain={['auto', 'auto']}
            tickFormatter={compactInr}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(value) => formatDate(String(value))}
            formatter={(value, name) => [
              typeof value === 'number' ? currency.format(value) : '—',
              String(name ?? ''),
            ]}
            cursor={{
              stroke: 'rgb(var(--ink-rgb) / 25%)',
              strokeDasharray: '3 3',
            }}
          />
          <Legend iconType="circle" iconSize={9} wrapperStyle={legendStyle} />
          {response.series.map((series, index) => (
            <Line
              key={`${series.product}-${series.expiry_date}`}
              type="linear"
              dataKey={`price${index}`}
              name={series.product}
              stroke={productColor(series.product, index)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls={false}
              {...draw}
              animationBegin={index * 120}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
