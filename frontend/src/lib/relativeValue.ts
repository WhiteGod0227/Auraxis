import type { SpreadSeries, SpreadRow } from './types'

export function maturityMatchingChange(
  current: SpreadRow,
  other: SpreadRow | undefined,
  matching: boolean,
): number | null {
  if (
    !other ||
    current.pair !== other.pair ||
    current.expiry_a !== other.expiry_a ||
    current.trade_date !== other.trade_date ||
    current.a_p10_999 !== other.a_p10_999 ||
    current.spread_abs === null ||
    other.spread_abs === null ||
    !Number.isFinite(current.spread_abs) ||
    !Number.isFinite(other.spread_abs)
  )
    return null
  return matching
    ? current.spread_abs - other.spread_abs
    : other.spread_abs - current.spread_abs
}

// A request identity change hides prior results immediately, before effects run.
export function currentResource<T>(
  previous: unknown,
  current: unknown,
  value: T,
): T | undefined {
  return previous === current ? value : undefined
}
export function selectExpiry(
  series: Pick<SpreadSeries, 'expiry_a'>[],
  dataAsOf: string | null,
  preferred?: string,
): string | undefined {
  const dates = series.map((s) => s.expiry_a).sort()
  if (preferred && dates.includes(preferred)) return preferred
  if (dataAsOf) {
    const threshold = new Date(Date.parse(dataAsOf) + 3 * 86400000)
      .toISOString()
      .slice(0, 10)
    const next = dates.find((date) => date >= threshold)
    if (next) return next
  }
  return dates.at(-1)
}
export function spreadChartRows(series: SpreadSeries) {
  return series.rows.map((row) => {
    const valid =
      typeof row.roll_mean === 'number' &&
      Number.isFinite(row.roll_mean) &&
      typeof row.roll_std === 'number' &&
      Number.isFinite(row.roll_std)
    const lower = valid ? row.roll_mean! - 2 * row.roll_std! : null
    const upper = valid ? row.roll_mean! + 2 * row.roll_std! : null
    return {
      ...row,
      band:
        lower !== null &&
        upper !== null &&
        Number.isFinite(lower) &&
        Number.isFinite(upper)
          ? [lower, upper]
          : null,
    }
  })
}
