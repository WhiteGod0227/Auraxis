import {
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
import { equityChartRows } from '@/lib/backtest'
import type {
  BacktestReport,
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
      <p>Gross P&amp;L: {row.cumulative_gross_pnl ?? 'Unavailable'} Rs</p>
      <p>Incurred costs: {row.cumulative_incurred_costs ?? 'Unavailable'} Rs</p>
      <p>Net P&amp;L: {row.cumulative_net_pnl ?? 'Unavailable'} Rs</p>
      <p>
        Mark quality: {row.valuation_quality};{' '}
        {row.valuation_reason || 'no additional reason'}
      </p>
      <p>
        A: {row.mark_quality_a ?? 'Unavailable'}; B:{' '}
        {row.mark_quality_b ?? 'Unavailable'}
      </p>
    </div>
  )
}
function CostTooltip({ active, payload }: TooltipInput) {
  const row = payload?.[0]?.payload as CostSensitivityPoint | undefined
  if (!active || !row) return null
  return (
    <div className="ts-tooltip">
      <strong>{row.cost_bps_per_leg_per_side} bps per leg per side</strong>
      <p>Completed-trade gross P&amp;L: {row.gross_pnl ?? 'Unavailable'} Rs</p>
      <p>Costs: {row.costs ?? 'Unavailable'} Rs</p>
      <p>Completed-trade net P&amp;L: {row.net_pnl ?? 'Unavailable'} Rs</p>
    </div>
  )
}
export function BacktestEquityChart({ report }: { report: BacktestReport }) {
  return (
    <div
      className="chart-container bt-equity-chart"
      role="img"
      aria-label={`Cumulative simulated gross and net P&L in rupees for expiry ${report.expiry}. Missing valuations are gaps; this is not account equity. Equivalent data is in the valuation table.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={equityChartRows(report)}
          accessibilityLayer
          margin={{ top: 20, right: 20, left: 8, bottom: 12 }}
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
            width={90}
            domain={['auto', 'auto']}
            tickFormatter={(v) => currency.format(Number(v))}
          />
          <Tooltip content={<EquityTooltip />} filterNull={false} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 18 }} />
          <ReferenceLine y={0} stroke="#9AA6B8" />
          <Line
            name="Cumulative gross P&L"
            dataKey="cumulative_gross_pnl"
            stroke="#F5B942"
            type="linear"
            connectNulls={false}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            name="Cumulative net P&L"
            dataKey="cumulative_net_pnl"
            stroke="#60A5FA"
            type="linear"
            connectNulls={false}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
export function BacktestCostChart({ report }: { report: BacktestReport }) {
  return (
    <div
      className="chart-container bt-cost-chart"
      role="img"
      aria-label={`Closed-trade cost sensitivity for expiry ${report.expiry}. Fixed completed trades only; open and unresolved positions excluded. Equivalent values are in the cost sensitivity table.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={report.cost_sensitivity}
          accessibilityLayer
          margin={{ top: 20, right: 20, left: 8, bottom: 32 }}
        >
          <CartesianGrid stroke="#232B38" vertical={false} />
          <XAxis
            type="number"
            dataKey="cost_bps_per_leg_per_side"
            domain={['dataMin', 'dataMax']}
            stroke="#9AA6B8"
            label={{
              value: 'Cost bps per leg per side',
              position: 'insideBottom',
              offset: -12,
              fill: '#9AA6B8',
            }}
          />
          <YAxis
            stroke="#9AA6B8"
            width={90}
            domain={['auto', 'auto']}
            tickFormatter={(v) => currency.format(Number(v))}
          />
          <Tooltip content={<CostTooltip />} filterNull={false} />
          <ReferenceLine y={0} stroke="#9AA6B8" />
          <Line
            name="Completed-trade net P&L"
            dataKey="net_pnl"
            stroke="#F5B942"
            type="linear"
            connectNulls={false}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
