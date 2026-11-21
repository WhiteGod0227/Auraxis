import type { LiveSnapshot } from './live'
import type { PairSummary, PricesResponse, Reference } from './types'

/**
 * Whether today's live prices should drive the Overview.
 *
 * Live figures lead while a session is trading and after the close until that
 * session's settlement is stored (`dataAsOf` reaches the live date). Before a
 * session's first trade the snapshot still holds the previous session, which
 * the settled view already covers, so it does not lead.
 */
export function isLiveActive(
  snapshot: LiveSnapshot | null,
  dataAsOf: string | null | undefined,
): snapshot is LiveSnapshot & { trade_date: string } {
  if (!snapshot?.trade_date || snapshot.settled) return false
  if (!['live', 'closed', 'error', 'starting'].includes(snapshot.state))
    return false
  if (!snapshot.references.some((item) => item.available)) return false
  if (snapshot.state === 'live') return true
  return !dataAsOf || snapshot.trade_date > dataAsOf
}

/** Live product prices in the shape the settled Overview already renders. */
export function liveReferences(snapshot: LiveSnapshot): Reference[] {
  return snapshot.references.map((item) => {
    const price = item.price_p10 ?? null
    return {
      product: item.product,
      reference_available: item.available && price !== null,
      selection_reason: 'live',
      expiry_date: item.expiry_date ?? null,
      days_to_expiry: item.days_to_expiry ?? null,
      trade_date: snapshot.trade_date,
      close_p10_raw: price,
      close_p10_999: price,
      volume_grams: item.volume_grams ?? null,
      open_interest_grams: item.open_interest_grams ?? null,
      has_trade: item.traded_today ?? null,
      previous_comparison_date: item.previous_trade_date ?? null,
      day_change_abs: item.change_abs ?? null,
      day_change_pct: item.change_pct ?? null,
      change_quality: 'live',
      change_reason: '',
    }
  })
}

/**
 * Live pair readings as summaries. History is the settled history of the same
 * contract with today's live gap appended as the last point.
 */
export function livePairs(
  snapshot: LiveSnapshot & { trade_date: string },
  settled: PairSummary[],
): PairSummary[] {
  return snapshot.pairs
    .filter((item) => typeof item.spread_abs === 'number')
    .map((item) => {
      const previous = settled.find(
        (other) => other.pair === item.pair && other.expiry === item.expiry,
      )
      const history = (previous?.history ?? []).filter(
        (point) => point.trade_date < snapshot.trade_date,
      )
      return {
        pair: item.pair,
        expiry: item.expiry,
        trade_date: snapshot.trade_date,
        a_p10: item.a_p10,
        b_p10: item.b_p10,
        spread_abs: item.spread_abs,
        spread_pct: item.spread_pct,
        z: item.z,
        percentile: item.percentile,
        history: [
          ...history,
          { trade_date: snapshot.trade_date, spread_abs: item.spread_abs },
        ],
      }
    })
}

/** Gap change since the last settlement, per pair (live mode only). */
export function liveMoves(snapshot: LiveSnapshot) {
  return Object.fromEntries(
    snapshot.pairs.map((item) => [
      item.pair,
      typeof item.spread_abs === 'number' &&
      typeof item.settled_spread_abs === 'number'
        ? item.spread_abs - item.settled_spread_abs
        : null,
    ]),
  ) as Record<string, number | null>
}

/** Append today's live price to each settled series of the same contract. */
export function withLivePrices(
  response: PricesResponse,
  snapshot: LiveSnapshot & { trade_date: string },
): PricesResponse {
  return {
    ...response,
    series: response.series.map((series) => {
      const live = snapshot.references.find(
        (item) =>
          item.product === series.product &&
          item.expiry_date === series.expiry_date &&
          typeof item.price_p10 === 'number',
      )
      if (!live || !series.expiry_date) return series
      return {
        ...series,
        history: [
          ...series.history.filter(
            (point) => point.trade_date < snapshot.trade_date,
          ),
          {
            trade_date: snapshot.trade_date,
            expiry_date: series.expiry_date,
            close_p10_raw: live.price_p10 ?? null,
            close_p10_999: live.price_p10 ?? null,
            has_trade: true,
            quality_reason: 'live',
            volume_grams: live.volume_grams ?? null,
            open_interest_grams: live.open_interest_grams ?? null,
          },
        ],
      }
    }),
  }
}
