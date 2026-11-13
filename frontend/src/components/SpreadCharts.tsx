import { useId, useState } from 'react'
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
import {
  AXIS,
  GRID,
  HIGH,
  LOW,
  MUTED_LINE,
  PALETTE,
  draw,
  legendStyle,
  tooltipStyle,
} from '@/lib/chartTheme'
import type { SpreadSeries } from '@/lib/types'

/** One chart card with a toggle between the gap and its z-score. */
export default function SpreadCharts({ series }: { series: SpreadSeries }) {
  const uid = useId().replace(/:/g, '')
  const [view, setView] = useState<'gap' | 'z'>('gap')
  const rows = spreadChartRows(series)
  const isZ = view === 'z'
  return (
    <section className="ui-card" aria-labelledby="gap-chart-title">
      <div className="ui-card-head">
        <div>
          <h2 id="gap-chart-title">Gap over time</h2>
          <p>
            {isZ
              ? 'Distance from the usual level in standard deviations — beyond ±2 is unusual.'
              : 'Gap as % of price, with its recent average and usual range.'}
          </p>
        </div>
        <div className="ui-segmented" role="group" aria-label="Chart view">
          <button
            type="button"
            aria-pressed={!isZ}
            onClick={() => setView('gap')}
          >
            Gap
          </button>
          <button type="button" aria-pressed={isZ} onClick={() => setView('z')}>
            vs usual
          </button>
        </div>
      </div>
      <div
        className="chart-container"
        role="img"
        aria-label={`${isZ ? 'Z-score' : 'Gap'} history for expiry ${series.expiry_a}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            accessibilityLayer
            margin={{ top: 12, right: 12, bottom: 4, left: 0 }}
          >
            <defs>
              <linearGradient id={`gap-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={PALETTE.slate} stopOpacity={0.35} />
                <stop offset="1" stopColor={PALETTE.slate} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`zfill-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={HIGH} stopOpacity={0.45} />
                <stop offset="0.5" stopColor={HIGH} stopOpacity={0.03} />
                <stop offset="0.5" stopColor={LOW} stopOpacity={0.03} />
                <stop offset="1" stopColor={LOW} stopOpacity={0.45} />
              </linearGradient>
              <linearGradient id={`zline-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0.5" stopColor={HIGH} />
                <stop offset="0.5" stopColor={LOW} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="trade_date"
              stroke={AXIS}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
              tickFormatter={(v) => formatDate(String(v)).slice(0, 6)}
            />
            <YAxis
              stroke={AXIS}
              tickLine={false}
              axisLine={false}
              width={52}
              domain={isZ ? [-4, 4] : ['auto', 'auto']}
              ticks={isZ ? [-4, -2, 0, 2, 4] : undefined}
              allowDataOverflow={isZ}
              tickFormatter={(v) =>
                isZ ? `${Number(v)}σ` : `${Number(v).toFixed(2)}%`
              }
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => formatDate(String(v))}
              cursor={{
                stroke: 'rgb(var(--ink-rgb) / 25%)',
                strokeDasharray: '3 3',
              }}
              formatter={(value, name) => [
                Array.isArray(value)
                  ? value.map((v) => `${Number(v).toFixed(2)}%`).join(' to ')
                  : typeof value === 'number'
                    ? isZ
                      ? `${value.toFixed(2)}σ`
                      : `${value.toFixed(3)}%`
                    : '—',
                String(name),
              ]}
            />
            <Legend iconType="circle" iconSize={9} wrapperStyle={legendStyle} />
            {isZ ? (
              <>
                <ReferenceLine y={0} stroke="rgb(var(--ink-rgb) / 25%)" />
                {[-2, 2].map((v) => (
                  <ReferenceLine
                    key={v}
                    y={v}
                    stroke="rgb(var(--ink-rgb) / 35%)"
                    strokeDasharray="4 5"
                  />
                ))}
                <Area
                  dataKey="z"
                  name="vs usual (σ)"
                  type="linear"
                  baseValue={0}
                  stroke={`url(#zline-${uid})`}
                  strokeWidth={2}
                  fill={`url(#zfill-${uid})`}
                  dot={false}
                  connectNulls={false}
                  {...draw}
                />
              </>
            ) : (
              <>
                <Area
                  dataKey="band"
                  name="Usual range"
                  stroke="none"
                  fill={PALETTE.slate}
                  fillOpacity={0.1}
                  type="linear"
                  connectNulls={false}
                  {...draw}
                />
                <Area
                  dataKey="spread_pct"
                  name="Gap (% of price)"
                  type="linear"
                  stroke={PALETTE.slate}
                  strokeWidth={2.2}
                  fill={`url(#gap-${uid})`}
                  baseValue="dataMin"
                  dot={false}
                  activeDot={{ r: 4, fill: PALETTE.slate, strokeWidth: 0 }}
                  connectNulls={false}
                  {...draw}
                />
                <Line
                  dataKey="roll_mean"
                  name="Recent average"
                  stroke={MUTED_LINE}
                  strokeWidth={1.4}
                  strokeDasharray="5 4"
                  type="linear"
                  dot={false}
                  connectNulls={false}
                  {...draw}
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
