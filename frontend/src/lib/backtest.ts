import { selectContractExpiry } from './termStructure'
import type { CompletedTrade, BacktestOrderEvent } from './types'
import type { BacktestParameters, BacktestReport, CostTolerance } from './types'
export const backtestPairs = [
  'GOLDTEN-GOLDPETAL',
  'GOLDTEN-GOLDGUINEA',
  'GOLDGUINEA-GOLDPETAL',
]
export const defaultDraft = {
  pair: backtestPairs[0],
  z_entry: 1,
  z_exit: 0.25,
  cost_bps_per_leg_per_side: 5,
  min_volume_grams: 2000,
  max_hold_sessions: 5,
  purity: false,
  sizing_mode: 'fractional' as 'fractional' | 'integer_lots',
}
export type BacktestDraft = typeof defaultDraft
export function validateDraft(draft: BacktestDraft): string | undefined {
  if (!['fractional', 'integer_lots'].includes(draft.sizing_mode))
    return 'Choose fractional or integer-lot sizing.'
  if (!backtestPairs.includes(draft.pair))
    return 'Choose a supported same-expiry pair.'
  const ranges = [
    ['z_entry', 0.5, 3, 0.25],
    ['z_exit', 0, 1, 0.05],
    ['cost_bps_per_leg_per_side', 0, 50, 1],
    ['min_volume_grams', 0, 10000, 500],
    ['max_hold_sessions', 1, 10, 1],
  ] as const
  for (const [key, min, max, step] of ranges) {
    const value = draft[key]
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      Math.abs((value - min) / step - Math.round((value - min) / step)) > 1e-8
    )
      return `${key} must be ${min}-${max}, in steps of ${step}.`
  }
  if (draft.z_exit >= draft.z_entry) return 'z_exit must be less than z_entry.'
}
export function draftParameters(draft: BacktestDraft): BacktestParameters {
  return { ...draft }
}
export function hasDraftChanges(draft: BacktestDraft, applied: BacktestDraft) {
  return Object.keys(defaultDraft).some(
    (key) =>
      draft[key as keyof BacktestDraft] !== applied[key as keyof BacktestDraft],
  )
}
export function selectBacktestExpiry(
  reports: BacktestReport[],
  dataAsOf: string | null,
  preferred?: string,
) {
  return selectContractExpiry(
    reports.map((report) => report.expiry),
    dataAsOf,
    preferred,
  )
}
export function completedMetrics(report: BacktestReport) {
  return {
    winRate:
      report.metrics.completed_count > 0 ? report.metrics.win_rate : null,
    averageHolding:
      report.metrics.completed_count > 0
        ? report.metrics.average_holding_sessions
        : null,
    reason:
      report.metrics.completed_count === 0
        ? 'no_completed_trades'
        : 'Metric unavailable from returned completed trades.',
  }
}
export function costToleranceMessage(t: CostTolerance) {
  if (t.reason === 'no_completed_trades')
    return 'Unavailable: no_completed_trades. Closed-trade performance is unobserved.'
  if (t.reason === 'nonpositive_gross_pnl')
    return 'No profitable tested cost, including zero cost (nonpositive_gross_pnl).'
  if (t.reason) return `Unavailable: ${t.reason}.`
  if (t.range_capped)
    return 'Still positive at 50 bps; tolerance beyond tested range is unknown.'
  return t.highest_profitable_tested_bps === null
    ? 'Unavailable: no profitable tested cost returned.'
    : `${t.highest_profitable_tested_bps} bps per leg per side: highest profitable tested integer cost.`
}
export function equityChartRows(report: BacktestReport) {
  return report.equity_curve.map((row) => ({
    ...row,
    cumulative_gross_pnl:
      row.valuation_quality === 'unavailable' ? null : row.cumulative_gross_pnl,
    cumulative_net_pnl:
      row.valuation_quality === 'unavailable' ? null : row.cumulative_net_pnl,
  }))
}
export function outstandingCategories(report: BacktestReport) {
  return {
    open: report.open_positions,
    unresolved: report.unresolved_positions,
  }
}
export function legDirection(side: string, pair: string) {
  const [a, b] = pair.split('-')
  return side === 'long_a_short_b'
    ? `Long ${a} / short ${b}`
    : side === 'short_a_long_b'
      ? `Short ${a} / long ${b}`
      : side
}

export function savedDefaults(applied: BacktestDraft): BacktestDraft {
  return { ...defaultDraft, pair: applied.pair, purity: applied.purity }
}

// Exit orders have their own IDs, not the entry/position ID. Confirm the
// executed entry identity, then require a unique same-lifecycle exit event.
export function exitSignalZ(
  trade: CompletedTrade,
  events: BacktestOrderEvent[],
): number | null {
  const entered = events.some(
    (e) =>
      e.order_id === trade.position_id &&
      e.kind === 'entry' &&
      e.status === 'executed' &&
      e.pair === trade.pair &&
      e.expiry === trade.expiry &&
      e.side === trade.side &&
      e.event_date === trade.entry_date &&
      e.signal_date === trade.signal_date,
  )
  if (!entered) return null
  const matches = events.filter(
    (e) =>
      e.kind === 'exit' &&
      e.status === 'executed' &&
      e.pair === trade.pair &&
      e.expiry === trade.expiry &&
      e.side === trade.side &&
      e.event_date === trade.exit_date &&
      e.signal_date === trade.exit_signal_date &&
      e.signal_date >= trade.entry_date &&
      e.exit_reason === trade.exit_reason &&
      e.order_id !== trade.position_id &&
      e.order_id.startsWith(`${trade.pair}:${trade.expiry}:`),
  )
  return matches.length === 1 &&
    typeof matches[0].signal_z === 'number' &&
    Number.isFinite(matches[0].signal_z)
    ? matches[0].signal_z
    : null
}
