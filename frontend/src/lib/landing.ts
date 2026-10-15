import { selectBacktestExpiry } from './backtest'
import type { SpreadsResponse, SpreadRow, BacktestResponse } from './types'
export interface CarryComparison {
  expiry: string
  date: string
  datasetThrough: string
  on: SpreadRow
  off: SpreadRow
}
const finite = (v: number | null) => typeof v === 'number' && Number.isFinite(v)
export function commonCarryComparison(
  on?: SpreadsResponse,
  off?: SpreadsResponse,
  historicalDataAsOf?: string | null,
): CarryComparison | null {
  if (!on || !off || !on.data_as_of || !off.data_as_of) return null
  const referenceDate =
    historicalDataAsOf ?? [on.data_as_of, off.data_as_of].sort().at(-1)!

  const matches = (d: SpreadsResponse, carry: boolean) =>
    d.configuration.pair === 'GOLDM-GOLDTEN' &&
    d.configuration.window === 10 &&
    d.configuration.min_periods === 5 &&
    !d.configuration.use_purity_adjustment &&
    d.configuration.carry_adjusted === carry &&
    d.configuration.min_volume_grams === 2000 &&
    d.configuration.min_oi_grams === 0
  if (!matches(on, true) || !matches(off, false)) return null
  const values = (r: SpreadRow) =>
    [r.a_p10_999, r.b_p10_999, r.spread_abs, r.spread_pct].every(finite)
  const candidates: CarryComparison[] = []
  for (const group of on.series) {
    const other = off.series.find((s) => s.expiry_a === group.expiry_a)
    if (!other) continue
    for (const a of group.rows) {
      const b = other.rows.find(
        (r) => r.trade_date === a.trade_date && r.expiry_a === a.expiry_a,
      )
      const bracket = a.expiry_b_used
      if (
        b &&
        a.trade_date <= referenceDate &&
        a.expiry_a >= a.trade_date &&
        a.pair === on.configuration.pair &&
        b.pair === off.configuration.pair &&
        a.expiry_a === group.expiry_a &&
        values(a) &&
        values(b) &&
        a.a_p10_999 === b.a_p10_999 &&
        a.comparison_type === 'interpolated_maturity' &&
        bracket.length === 2 &&
        bracket[0] <= a.expiry_a &&
        bracket[1] >= a.expiry_a &&
        bracket[0] < bracket[1]
      )
        candidates.push({
          expiry: a.expiry_a,
          date: a.trade_date,
          datasetThrough: referenceDate,
          on: a,
          off: b,
        })
    }
  }
  // Latest common finite date first, then nearest unexpired A expiry on that date.
  return (
    candidates.sort(
      (a, b) =>
        b.date.localeCompare(a.date) || a.expiry.localeCompare(b.expiry),
    )[0] ?? null
  )
}
export function landingBacktestReport(data?: BacktestResponse) {
  if (!data) return undefined
  const expiry = selectBacktestExpiry(data.reports, data.data_as_of)
  return data.reports.find((r) => r.expiry === expiry)
}
