import type { SpreadsResponse, SpreadRow } from './types'
import { currency, number } from './format'

export const comparisonReasons: Record<string, string> = {
  no_bracket:
    'Required maturity brackets are missing; the comparison is unavailable.',
  missing_brackets: 'Required maturity brackets are missing.',
  missing_component: 'A required source observation is missing.',
  leg_no_trade:
    'A required interpolation component has no recorded trade; its synthetic price is unavailable.',
  no_trade:
    'A required component has no recorded trade. Any retained settlement is not a traded price.',
  thin_volume: 'A required component is below the applied volume threshold.',
  thin_oi: 'A required component is below the applied open-interest threshold.',
  missing_price: 'A component price is missing, so no price gap is available.',
  invalid_price:
    'A component price is invalid, so no valid price gap is available.',
}
export function explainComparison(
  data: SpreadsResponse,
  row: SpreadRow,
): string[] {
  if (row.pair !== data.configuration.pair)
    return [
      'Explanation unavailable: the observation does not match the applied pair.',
    ]
  const [a, b] = row.pair.split('-')
  const gap = row.spread_abs
  const messages = [
    `${a}, expiry ${row.expiry_a}, is compared with ${b} ${row.expiry_b_used.length ? `expiry ${row.expiry_b_used.join(' / ')}` : 'with no available comparison expiry'} on ${row.trade_date}.`,
    gap === null || !Number.isFinite(gap)
      ? 'The normalized settlement gap is unavailable for this observation.'
      : gap === 0
        ? `A and B have the same normalized settlement on the applied ${data.normalization.unit} basis.`
        : `A's normalized settlement is ${currency.format(Math.abs(gap))} ${gap > 0 ? 'higher' : 'lower'} than B, on the applied ${data.normalization.unit} basis.`,
    data.configuration.use_purity_adjustment
      ? 'Purity adjustment is enabled as an experimental assumption. Cross-product price-basis equivalence remains unverified.'
      : 'Purity adjustment is off: only quote-size conversion is applied. This does not establish complete contract equivalence.',
  ]
  if (row.analytics_only)
    messages.push(
      data.configuration.carry_adjusted
        ? 'Maturity matching uses same-date B expiry brackets. The synthetic comparison is analytics only; it is not an executable contract.'
        : 'Maturity matching is off: the nearest B expiry is used, with ties choosing the earlier expiry. These are different contract maturities; the comparison is analytics only.',
    )
  else
    messages.push(
      'The contracts share an expiry. Structural eligibility is not a fill guarantee.',
    )
  messages.push(
    `Liquidity check ${row.liquidity_ok ? 'passed' : 'failed'} at minimum volume ${number.format(data.configuration.min_volume_grams)} g and open interest ${number.format(data.configuration.min_oi_grams)} g. Source trade flag ${row.source_tradable ? 'passed' : 'failed'}.`,
  )
  for (const reason of new Set(
    [row.reason, row.liquidity_reason].filter(Boolean),
  ))
    messages.push(
      comparisonReasons[reason] ?? `Additional diagnostic: ${reason}.`,
    )
  if (row.z !== null && Number.isFinite(row.z))
    messages.push(
      `The percentage spread is ${number.format(Math.abs(row.z))} sample standard deviations ${row.z < 0 ? 'below' : row.z > 0 ? 'above' : 'from'} its preceding historical mean. It is not a probability or trading instruction.`,
    )
  else {
    const count = row.calculation?.preceding_finite_count
    const status = row.calculation?.statistics_status
    messages.push(
      status === 'insufficient_history'
        ? `Z-score is unavailable: ${count} preceding finite observations are available; the applied minimum is ${data.configuration.min_periods}.`
        : row.roll_std === 0 || status === 'zero_variance'
          ? 'Z-score is unavailable because the preceding spread history has zero variance.'
          : status === 'missing_current_spread' || row.spread_pct === null
            ? 'Z-score is unavailable because the current percentage spread is missing.'
            : status === 'undefined_variance'
              ? 'Z-score is unavailable because sample standard deviation is undefined.'
              : 'Z-score is unavailable. This saved response does not identify an exact preceding-observation count or statistical cause.',
    )
  }
  messages.push(
    row.percentile === null
      ? 'Percentile is unavailable for this observation.'
      : `The historical percentile is ${number.format(row.percentile)} out of 100, using preceding finite percentage spreads and half credit for ties. It is not a forecast probability.`,
    'Settlements are not executable prices. Lower does not mean undervalued, and the short historical sample does not establish profitability or convergence.',
  )
  return messages
}
