import { selectExpiry } from './relativeValue'
import type { SpreadsResponse } from './types'

export const alertPairs = [
  'GOLDTEN-GOLDPETAL',
  'GOLDTEN-GOLDGUINEA',
  'GOLDGUINEA-GOLDPETAL',
  'GOLDM-GOLDTEN',
  'GOLDM-GOLDGUINEA',
  'GOLDM-GOLDPETAL',
] as const
export const alertsStorageKey = 'auraxis.research-alerts.v1'
export interface AlertRule {
  id: string
  pair: string
  metric: 'abs_z' | 'abs_spread_pct'
  threshold: number
  expiry: string | null
}
export function validAlertRule(value: unknown): value is AlertRule {
  if (!value || typeof value !== 'object') return false
  const rule = value as AlertRule
  return (
    typeof rule.id === 'string' &&
    /^[a-zA-Z0-9-]{1,80}$/.test(rule.id) &&
    alertPairs.includes(rule.pair as (typeof alertPairs)[number]) &&
    ['abs_z', 'abs_spread_pct'].includes(rule.metric) &&
    Number.isFinite(rule.threshold) &&
    rule.threshold > 0 &&
    rule.threshold <= 100 &&
    (rule.expiry === null ||
      (typeof rule.expiry === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(rule.expiry) &&
        !Number.isNaN(Date.parse(rule.expiry)) &&
        new Date(rule.expiry).toISOString().slice(0, 10) === rule.expiry))
  )
}
export function readAlertRules(storage: Pick<Storage, 'getItem'>) {
  try {
    const raw = storage.getItem(alertsStorageKey)
    if (!raw) return { rules: [] as AlertRule[], warning: '' }
    const data: unknown = JSON.parse(raw)
    if (
      !Array.isArray(data) ||
      data.length > 20 ||
      !data.every(validAlertRule) ||
      new Set(data.map((r) => r.id)).size !== data.length
    )
      throw new Error('Invalid rule store')
    return { rules: data as AlertRule[], warning: '' }
  } catch {
    return {
      rules: [] as AlertRule[],
      warning:
        'Saved alert rules could not be read. New rules only replace them when you explicitly add a rule.',
    }
  }
}
export function writeAlertRules(
  storage: Pick<Storage, 'setItem'>,
  rules: AlertRule[],
) {
  if (
    rules.length > 20 ||
    !rules.every(validAlertRule) ||
    new Set(rules.map((r) => r.id)).size !== rules.length
  )
    throw new Error('Use up to 20 valid, distinct rules.')
  storage.setItem(alertsStorageKey, JSON.stringify(rules))
}
export function evaluateAlert(
  rule: AlertRule,
  data: SpreadsResponse | undefined,
) {
  const unavailable = (reason: string) => ({
    status: 'unavailable' as const,
    reason,
    value: null,
    expiry: rule.expiry,
    date: null,
  })
  if (!validAlertRule(rule)) return unavailable('Invalid rule.')
  if (!data || !data.data_available)
    return unavailable('No historical comparison is available.')
  if (
    data.configuration.pair !== rule.pair ||
    data.configuration.use_purity_adjustment
  )
    return unavailable(
      'The result does not match this rule and its purity-off basis.',
    )
  const expiry = rule.expiry ?? selectExpiry(data.series, data.data_as_of)
  const row = data.series.find((s) => s.expiry_a === expiry)?.latest
  if (!row)
    return unavailable(
      'No observation for this expiry. Explicit expiries are never substituted.',
    )
  if (!data.data_as_of || row.trade_date !== data.data_as_of)
    return unavailable(
      'The contract observation is older than the dataset date.',
    )
  if (!row.source_tradable || !row.liquidity_ok || row.reason)
    return unavailable(
      row.liquidity_reason ||
        row.reason ||
        'Observation quality checks did not pass.',
    )
  const value = rule.metric === 'abs_z' ? row.z : row.spread_pct
  if (value === null || !Number.isFinite(value))
    return unavailable('Insufficient statistics or missing values.')
  return {
    status:
      Math.abs(value) >= rule.threshold
        ? ('triggered' as const)
        : ('below' as const),
    value,
    expiry: row.expiry_a,
    date: row.trade_date,
    reason: row.analytics_only
      ? 'Analytics-only maturity comparison; not an executable contract.'
      : 'Historical observation; not a trading recommendation.',
  }
}
