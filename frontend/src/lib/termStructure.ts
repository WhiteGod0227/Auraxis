import { selectExpiry } from './relativeValue'
import type {
  CurvePoint,
  RolldownRow,
  RolldownSeries,
  CurveResponse,
  RolldownResponse,
} from './types'
const finite = (value: number | null) =>
  typeof value === 'number' && Number.isFinite(value)
export function curveChartRows(points: CurvePoint[]) {
  return [...points]
    .sort(
      (a, b) =>
        a.days_to_expiry - b.days_to_expiry ||
        a.expiry_date.localeCompare(b.expiry_date),
    )
    .map((point) => ({
      ...point,
      traded_price:
        point.has_trade && finite(point.close_p10_999)
          ? point.close_p10_999
          : null,
      untraded_price:
        !point.has_trade && finite(point.close_p10_999)
          ? point.close_p10_999
          : null,
    }))
}
export function availableCurveDates(
  curve?: CurveResponse,
  rolldown?: RolldownResponse,
) {
  const dates = new Set(curve?.points.map((p) => p.trade_date) ?? [])
  for (const series of rolldown?.series ?? [])
    for (const row of series.rows) {
      dates.add(row.previous_trade_date)
      dates.add(row.trade_date)
    }
  return [...dates].sort()
}
export function selectContractExpiry(
  expiries: string[],
  dataAsOf: string | null,
  preferred?: string,
) {
  return selectExpiry(
    expiries.map((expiry_a) => ({ expiry_a })),
    dataAsOf,
    preferred,
  )
}
export function rolldownChartRows(series: RolldownSeries) {
  return [...series.rows]
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    .map((row) => ({
      ...row,
      raw_change: finite(row.raw_change) ? row.raw_change : null,
      estimated_roll_down:
        row.decomposition_valid && finite(row.estimated_roll_down)
          ? row.estimated_roll_down
          : null,
      residual_change:
        row.decomposition_valid && finite(row.residual_change)
          ? row.residual_change
          : null,
    }))
}
export function expiryDiagnostics(series: RolldownSeries) {
  const reasons = new Map<string, number>()
  let valid = 0
  for (const row of series.rows) {
    if (row.decomposition_valid) valid++
    if (row.reason) reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1)
  }
  return {
    total: series.rows.length,
    valid,
    invalid: series.rows.length - valid,
    reasons: Object.fromEntries(reasons),
  }
}
export function latestRolldown(
  series: RolldownSeries,
): RolldownRow | undefined {
  return [...series.rows]
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    .at(-1)
}
export function reconciliation(row: RolldownRow) {
  if (
    !row.decomposition_valid ||
    !finite(row.raw_change) ||
    !finite(row.estimated_roll_down) ||
    !finite(row.residual_change)
  )
    return null
  // Compare full-precision API values, allowing only floating-point rounding.
  const difference =
    row.raw_change! - row.estimated_roll_down! - row.residual_change!
  const tolerance =
    1e-10 *
    Math.max(
      1,
      Math.abs(row.raw_change!),
      Math.abs(row.estimated_roll_down!),
      Math.abs(row.residual_change!),
    )
  return { difference, reconciles: Math.abs(difference) <= tolerance }
}
