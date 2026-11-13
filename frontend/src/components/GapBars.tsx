import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { gapLevel, pairLabel, signedInr } from '@/lib/insight'
import {
  AXIS,
  GRID,
  HIGH,
  LOW,
  NORMAL,
  draw,
  tooltipStyle,
} from '@/lib/chartTheme'

export interface GapBarItem {
  pair: string
  z: number | null
  gap: number | null
}

const short = (pair: string) =>
  pair
    .split('-')
    .map((p) => p.replace(/^GOLD/, '') || 'GOLD')
    .join(' / ')

const colorFor = (z: number) => {
  const level = gapLevel(z)
  return level.tone === 'normal' ? NORMAL : level.tone === 'high' ? HIGH : LOW
}

const kInr = (v: number) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}₹${Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toFixed(1)}k` : Math.round(Math.abs(v))}`

/**
 * Diverging bars per pair. `z` mode: distance from the usual level (σ).
 * `gap` mode: today's gap in ₹ per 10 g, for when there is no history yet.
 */
export default function GapBars({
  items,
  onSelect,
  mode = 'z',
}: {
  items: GapBarItem[]
  onSelect?: (pair: string) => void
  mode?: 'z' | 'gap'
}) {
  const byGap = mode === 'gap'
  const rows = items
    .map((item) => ({
      ...item,
      label: short(item.pair),
      v: byGap ? item.gap : item.z,
    }))
    .filter(
      (item): item is typeof item & { v: number } =>
        typeof item.v === 'number' && Number.isFinite(item.v),
    )
    .sort((x, y) => (byGap ? Math.abs(y.v) - Math.abs(x.v) : 0))
  const largest = Math.max(1, ...rows.map((row) => Math.abs(row.v)))
  const step = largest > 2000 ? 1000 : largest > 400 ? 500 : 100
  const limit = byGap
    ? Math.ceil((largest * 1.05) / step) * step
    : Math.max(3, ...rows.map((row) => Math.ceil(Math.abs(row.v))))
  const ticks = byGap
    ? [-limit, -limit / 2, 0, limit / 2, limit]
    : Array.from({ length: limit * 2 + 1 }, (_, i) => i - limit)
  return (
    <div
      className="chart-container gap-bars"
      role="img"
      aria-label={`Gap versus usual level for ${rows.length} pairs`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
          barCategoryGap={10}
        >
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis
            type="number"
            domain={[-limit, limit]}
            interval={0}
            tick={{ fontSize: 10 }}
            ticks={ticks}
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) =>
              byGap ? kInr(Number(v)) : `${v > 0 ? '+' : ''}${v}σ`
            }
          />
          <YAxis
            type="category"
            dataKey="label"
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            width={118}
            tick={{ fontSize: 11 }}
          />
          <ReferenceLine x={0} stroke="rgb(var(--ink-rgb) / 30%)" />
          {(byGap ? [] : [-2, 2]).map((v) => (
            <ReferenceLine
              key={v}
              x={v}
              stroke="rgb(var(--ink-rgb) / 18%)"
              strokeDasharray="4 4"
            />
          ))}
          <Tooltip
            cursor={{ fill: 'rgb(var(--ink-rgb) / 4%)' }}
            contentStyle={tooltipStyle}
            formatter={(value, _name, item) =>
              byGap
                ? [`${signedInr(Number(value))} per 10 g`, 'Gap today']
                : [
                    `${Number(value).toFixed(2)}σ · gap ${signedInr(
                      (item?.payload as GapBarItem | undefined)?.gap,
                    )}`,
                    gapLevel(Number(value)).chip,
                  ]
            }
            labelFormatter={(_, payload) =>
              pairLabel(
                (payload?.[0]?.payload as GapBarItem | undefined)?.pair ?? '',
              )
            }
          />
          <Bar
            dataKey="v"
            radius={[4, 4, 4, 4]}
            {...draw}
            onClick={(data) => {
              const pair = (data as unknown as { payload?: GapBarItem })
                ?.payload?.pair
              if (pair) onSelect?.(pair)
            }}
            style={{ cursor: onSelect ? 'pointer' : undefined }}
          >
            {rows.map((row) => (
              <Cell
                key={row.pair}
                fill={byGap ? (row.v < 0 ? LOW : HIGH) : colorFor(row.v)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
