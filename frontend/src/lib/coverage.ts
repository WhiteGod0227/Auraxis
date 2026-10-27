import type { CoverageDay, CoverageResponse } from './types'

export interface CoverageSelection {
  month: string | null
  product: string | null
  date: string | null
}
export const initialCoverageSelection: CoverageSelection = {
  month: null,
  product: null,
  date: null,
}
const validMonth = (month: string) =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && !month.startsWith('0000-')
export function monthRange(month: string): { start: string; end: string } {
  if (!validMonth(month))
    throw new Error('Choose a valid month (years 0001–9999).')
  const start = month + '-01'
  const end = new Date(Date.parse(start) + 31 * 86400000)
  end.setUTCDate(0)
  return { start, end: end.toISOString().slice(0, 10) }
}
export function adjacentMonth(month: string, direction: number): string | null {
  if (!validMonth(month)) return null
  const value = new Date(month + '-01T00:00:00Z')
  value.setUTCMonth(value.getUTCMonth() + direction)
  const next = value.toISOString().slice(0, 7)
  return validMonth(next) ? next : null
}
export function chooseCoverageDate(
  data: CoverageResponse,
  preferred: string | null,
): string | undefined {
  return (
    data.days.find((day) => day.date === preferred)?.date ??
    data.days.find((day) => day.date === data.data_as_of)?.date ??
    data.days.find((day) => day.observation_count > 0)?.date ??
    data.days[0]?.date
  )
}
export function moveCoverageDate(
  date: string,
  key: string,
  start: string,
  end: string,
): string | null {
  const current = new Date(date + 'T00:00:00Z')
  const weekday = (current.getUTCDay() + 6) % 7
  const offsets: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
    Home: -weekday,
    End: 6 - weekday,
  }
  if (!(key in offsets)) return null
  const moved = Math.min(
    Date.parse(end),
    Math.max(Date.parse(start), current.getTime() + offsets[key] * 86400000),
  )
  return new Date(moved).toISOString().slice(0, 10)
}
export function calendarCells(days: CoverageDay[]): (CoverageDay | null)[] {
  const offset = days.length
    ? (new Date(days[0].date + 'T00:00:00Z').getUTCDay() + 6) % 7
    : 0
  return [...Array.from({ length: offset }, () => null), ...days]
}
export function coverageDayLabel(day: CoverageDay): string {
  const weekday = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(day.date + 'T00:00:00Z'))
  return `${weekday}, ${day.date}: ${day.observation_count ? `${day.observation_count} loaded observations, ${day.distinct_contract_count} distinct observed contracts` : 'Not loaded; no observations'}. No trade ${day.no_trade_count}; zero volume ${day.zero_volume_count}; thin volume ${day.thin_volume_count}; invalid settlement ${day.invalid_close_count}. File records ${day.ingestion_count ?? 'unavailable'}. Not a holiday classification.`
}
