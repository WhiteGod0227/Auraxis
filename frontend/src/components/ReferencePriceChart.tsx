import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { referenceChartRows } from '@/lib/chart'
import { number, currency, formatDate } from '@/lib/format'
import type { PricesResponse } from '@/lib/types'

const colors = ['#F5B942', '#60A5FA', '#A78BFA', '#2DD4BF']
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
        <LineChart
          data={chartRows}
          margin={{ top: 18, right: 18, left: 8, bottom: 10 }}
          accessibilityLayer
        >
          <CartesianGrid stroke="#232B38" vertical={false} />
          <XAxis
            dataKey="date"
            stroke="#9AA6B8"
            tickLine={false}
            axisLine={false}
            minTickGap={36}
            tickFormatter={(value) => formatDate(String(value)).slice(0, 6)}
          />
          <YAxis
            stroke="#9AA6B8"
            tickLine={false}
            axisLine={false}
            width={78}
            domain={['auto', 'auto']}
            tickFormatter={(value) => `₹${number.format(Number(value))}`}
          />
          <Tooltip
            contentStyle={{
              background: '#141922',
              border: '1px solid #384355',
              borderRadius: 12,
              color: '#E8EDF5',
            }}
            labelFormatter={(value) => formatDate(String(value))}
            formatter={(value, name) => [
              typeof value === 'number'
                ? currency.format(value)
                : 'Unavailable',
              String(name ?? ''),
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 18 }} />
          {response.series.map((series, index) => (
            <Line
              key={`${series.product}-${series.expiry_date}`}
              type="linear"
              dataKey={`price${index}`}
              name={`${series.product} · ${series.expiry_date ?? 'no reference'}`}
              stroke={colors[index % colors.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
