import { useId } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatDate } from '@/lib/format'
import { breakEvenBps, equityChartRows } from '@/lib/backtest'
import { signedInr } from '@/lib/insight'
import {
  AXIS,
  DOWN,
  GRID,
  MUTED_LINE,
  UP,
  compactInr,
  draw,
  legendStyle,
  tooltipStyle,
} from '@/lib/chartTheme'
import type {
  BacktestReport,
  CompletedTrade,
  BacktestEquityPoint,
  CostSensitivityPoint,
} from '@/lib/types'

type TooltipInput = {
  active?: boolean
  payload?: readonly { payload?: unknown }[]
}
function EquityTooltip({ active, payload }: TooltipInput) {
  const row = payload?.[0]?.payload as BacktestEquityPoint | undefined
  if (!active || !row) return null
  return (
    <div className="ts-tooltip">
      <strong>{formatDate(row.trade_date)}</strong>
      <p>After costs: {signedInr(row.cumulative_net_pnl)}</p>
      <p>Before costs: {signedInr(row.cumulative_gross_pnl)}</p>
      <p>Costs so far: {signedInr(row.cumulative_incurred_costs)}</p>
    </div>
  )
}
function CostTooltip({ active, payload }: TooltipInput) {
  const row = payload?.[0]?.payload as CostSensitivityPoint | undefined
  if (!active || !row) return null
  return (
    <div className="ts-tooltip">
      <strong>{row.cost_bps_per_leg_per_side} bps per leg per side</strong>
      <p>Net profit: {signedInr(row.net_pnl)}</p>
      <p>Costs: {signedInr(row.costs)}</p>
    </div>
  )
}

/**
 * Position of zero within the values' range, as a 0–1 gradient offset, so a
 * line or area can be green above zero and coral below.
 */
function zeroOffset(values: (number | null | undefined)[]) {
  const finite = values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  )
  if (!finite.length) return 1
  const max = Math.max(...finite, 0)
  const min = Math.min(...finite, 0)
  if (max === min) return 1
  return Math.min(1, Math.max(0, max / (max - min)))
}

export function BacktestEquityChart({ report }: { report: BacktestReport }) {
  const uid = useId().replace(/:/g, '')
  const rows = equityChartRows(report)
  const split = zeroOffset(rows.map((row) => row.cumulative_net_pnl))
  return (
    <div
      className="chart-container bt-equity-chart"
      role="img"
      aria-label={`Cumulative simulated profit before and after costs for expiry ${report.expiry}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          accessibilityLayer
          margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
        >
          <defs>
            <linearGradient id={`net-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={UP} stopOpacity={0.32} />
              <stop offset={split} stopColor={UP} stopOpacity={0.04} />
              <stop offset={split} stopColor={DOWN} stopOpacity={0.04} />
              <stop offset="1" stopColor={DOWN} stopOpacity={0.32} />
            </linearGradient>
            <linearGradient id={`netline-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={split} stopColor={UP} />
              <stop offset={split} stopColor={DOWN} />
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
            width={64}
            domain={['auto', 'auto']}
            tickFormatter={compactInr}
          />
          <Tooltip
            content={<EquityTooltip />}
            filterNull={false}
            cursor={{
              stroke: 'rgb(var(--ink-rgb) / 25%)',
              strokeDasharray: '3 3',
            }}
          />
          <Legend iconType="circle" iconSize={9} wrapperStyle={legendStyle} />
          <ReferenceLine y={0} stroke="rgb(var(--ink-rgb) / 25%)" />
          <Line
            name="Before costs"
            dataKey="cumulative_gross_pnl"
            stroke={MUTED_LINE}
            strokeWidth={1.4}
            strokeDasharray="5 4"
            type="linear"
            connectNulls={false}
            dot={false}
            {...draw}
          />
          <Area
            name="After costs"
            dataKey="cumulative_net_pnl"
            stroke={`url(#netline-${uid})`}
            strokeWidth={2.2}
            fill={`url(#net-${uid})`}
            baseValue={0}
            type="linear"
            connectNulls={false}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--text-strong)', strokeWidth: 0 }}
            {...draw}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function BacktestCostChart({ report }: { report: BacktestReport }) {
  const uid = useId().replace(/:/g, '')
  const split = zeroOffset(report.cost_sensitivity.map((p) => p.net_pnl))
  const current = report.configuration.cost_bps_per_leg_per_side
  const breakEven = breakEvenBps(report.cost_sensitivity)
  return (
    <div
      className="chart-container bt-cost-chart"
      role="img"
      aria-label={`Net profit of completed trades at different cost levels for expiry ${report.expiry}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={report.cost_sensitivity}
          accessibilityLayer
          margin={{ top: 12, right: 12, left: 0, bottom: 18 }}
        >
          <defs>
            <linearGradient id={`cost-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={UP} stopOpacity={0.3} />
              <stop offset={split} stopColor={UP} stopOpacity={0.04} />
              <stop offset={split} stopColor={DOWN} stopOpacity={0.04} />
              <stop offset="1" stopColor={DOWN} stopOpacity={0.3} />
            </linearGradient>
            <linearGradient id={`costline-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={split} stopColor={UP} />
              <stop offset={split} stopColor={DOWN} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            type="number"
            dataKey="cost_bps_per_leg_per_side"
            domain={['dataMin', 'dataMax']}
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v} bps`}
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
            content={<CostTooltip />}
            filterNull={false}
            cursor={{
              stroke: 'rgb(var(--ink-rgb) / 25%)',
              strokeDasharray: '3 3',
            }}
          />
          <ReferenceLine y={0} stroke="rgb(var(--ink-rgb) / 25%)" />
          {breakEven !== null && (
            <ReferenceLine
              x={breakEven}
              stroke="rgb(var(--ink-rgb) / 35%)"
              strokeDasharray="4 4"
              label={{
                value: `Break-even ≈ ${breakEven.toFixed(1)} bps`,
                position: 'insideTopLeft',
                fill: 'var(--text-2)',
                fontSize: 11,
              }}
            />
          )}
          <ReferenceLine
            x={current}
            stroke="var(--text-strong)"
            strokeWidth={1.5}
            label={{
              value: 'This run',
              position: 'insideBottomLeft',
              fill: 'var(--text-strong)',
              fontSize: 11,
            }}
          />
          <Area
            name="Net profit"
            dataKey="net_pnl"
            stroke={`url(#costline-${uid})`}
            strokeWidth={2}
            fill={`url(#cost-${uid})`}
            baseValue={0}
            type="linear"
            connectNulls={false}
            dot={false}
            {...draw}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/** One bar per completed trade: green made money, red lost. */
export function TradeBars({ trades }: { trades: CompletedTrade[] }) {
  const rows = trades.map((trade, index) => ({
    label: `#${index + 1} · ${formatDate(trade.exit_date).slice(0, 6)}`,
    net: trade.net_pnl,
  }))
  return (
    <div
      className="chart-container"
      role="img"
      aria-label={`Net profit of ${trades.length} completed trades`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
        >
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="label"
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            stroke={AXIS}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={compactInr}
          />
          <ReferenceLine y={0} stroke="rgb(var(--ink-rgb) / 25%)" />
          <Tooltip
            cursor={{ fill: 'rgb(var(--ink-rgb) / 4%)' }}
            contentStyle={tooltipStyle}
            formatter={(value) => [signedInr(Number(value)), 'Net profit']}
          />
          <Bar dataKey="net" radius={[6, 6, 6, 6]} maxBarSize={56} {...draw}>
            {rows.map((row) => (
              <Cell key={row.label} fill={(row.net ?? 0) >= 0 ? UP : DOWN} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
