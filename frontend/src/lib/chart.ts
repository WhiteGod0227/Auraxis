import type { PriceSeries } from './types'
export function referenceChartRows(series: PriceSeries[]) {
  const dates = [
    ...new Set(
      series.flatMap((item) => item.history.map((point) => point.trade_date)),
    ),
  ].sort()
  return dates.map((day) => {
    const row: Record<string, string | number | null> = { date: day }
    series.forEach((item, index) => {
      const observation = item.history.find((point) => point.trade_date === day)
      row[`price${index}`] =
        observation?.has_trade && observation.close_p10_999 !== null
          ? observation.close_p10_999
          : null
    })
    return row
  })
}
