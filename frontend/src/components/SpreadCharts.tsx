import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { spreadChartRows } from '@/lib/relativeValue'
import { formatDate } from '@/lib/format'
import type { SpreadSeries } from '@/lib/types'
export default function SpreadCharts({ series }: { series: SpreadSeries }) {
  const rows = spreadChartRows(series)
  return (
    <div className="rv-charts">
      {[false, true].map((isZ) => (
        <section className="panel" key={String(isZ)}>
          <h2>{isZ ? 'Z-score history' : 'Spread history'}</h2>
          <p className="section-description">
            {isZ
              ? 'Dimensionless z; +1 and -1 are simulation default entry references. Crossings are not trade recommendations.'
              : 'Spread and mean in percent of B. Descriptive historical band: mean +/- 2 standard deviations (percentage points), not a confidence interval.'}
          </p>
          <div
            className="chart-container"
            role="img"
            aria-label={`${isZ ? 'Z-score' : 'Spread'} history for expiry ${series.expiry_a}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                accessibilityLayer
                margin={{ top: 24, right: 20, bottom: 12, left: 0 }}
              >
                <CartesianGrid stroke="#232B38" vertical={false} />
                <XAxis
                  dataKey="trade_date"
                  stroke="#9AA6B8"
                  minTickGap={36}
                  tickFormatter={(v) => formatDate(String(v)).slice(0, 6)}
                />
                <YAxis
                  stroke="#9AA6B8"
                  width={65}
                  domain={['auto', 'auto']}
                  tickFormatter={(v) =>
                    `${Number(v).toFixed(2)}${isZ ? '' : '%'}`
                  }
                />
                <Tooltip
                  contentStyle={{
                    background: '#141922',
                    border: '1px solid #384355',
                    borderRadius: 12,
                    color: '#E8EDF5',
                  }}
                  labelFormatter={(v) => formatDate(String(v))}
                  formatter={(value, name) => [
                    Array.isArray(value)
                      ? value.map((v) => Number(v).toFixed(4)).join(' to ') +
                        ' pp'
                      : typeof value === 'number'
                        ? value.toFixed(4) + (isZ ? '' : '%')
                        : 'Unavailable',
                    String(name),
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 16 }} />
                {isZ ? (
                  <>
                    <ReferenceLine
                      y={0}
                      stroke="#9AA6B8"
                      label={{
                        value: 'Zero',
                        fill: '#9AA6B8',
                        position: 'insideTopLeft',
                      }}
                    />
                    {[-1, 1].map((v) => (
                      <ReferenceLine
                        key={v}
                        y={v}
                        stroke="#A78BFA"
                        strokeDasharray="4 4"
                        label={{
                          value: `${v > 0 ? '+' : ''}${v} simulation reference`,
                          fill: '#A78BFA',
                          position: 'insideTopRight',
                        }}
                      />
                    ))}
                    <Line
                      dataKey="z"
                      name="Z-score"
                      stroke="#60A5FA"
                      type="linear"
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </>
                ) : (
                  <>
                    <Area
                      dataKey="band"
                      name="Descriptive historical band (pp)"
                      stroke="none"
                      fill="#F5B942"
                      fillOpacity={0.12}
                      type="linear"
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="spread_pct"
                      name="Spread (% of B)"
                      stroke="#F5B942"
                      type="linear"
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="roll_mean"
                      name="Rolling mean (% of B)"
                      stroke="#60A5FA"
                      type="linear"
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      ))}
    </div>
  )
}
