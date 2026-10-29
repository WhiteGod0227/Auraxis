import { env } from './env'
import { session } from './auth'
import { validAlertRule } from './alerts'
import type { AlertRule } from './alerts'

export interface AccountAlerts {
  revision: number
  rules: AlertRule[]
  updated_at: string | null
}
export function parseAccountAlerts(value: unknown): AccountAlerts {
  const data = value as AccountAlerts
  if (
    !data ||
    !Number.isInteger(data.revision) ||
    data.revision < 0 ||
    !Array.isArray(data.rules) ||
    data.rules.length > 20 ||
    !data.rules.every(validAlertRule) ||
    new Set(data.rules.map((r) => r.id)).size !== data.rules.length ||
    (data.updated_at !== null &&
      (typeof data.updated_at !== 'string' ||
        Number.isNaN(Date.parse(data.updated_at))))
  )
    throw new Error('Invalid account alert response.')
  return data
}
export function createAccountAlertsClient(
  base: string,
  fetcher: typeof fetch = fetch,
) {
  async function request(body?: { revision: number; rules: AlertRule[] }) {
    const epoch = session.getSnapshot().epoch
    let response: Response
    try {
      response = await fetcher(`${base.replace(/\/$/, '')}/api/alerts/rules`, {
        method: body ? 'PUT' : 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch {
      throw new Error(
        'Account alerts require the backend. Browser rules remain available.',
      )
    }
    if (session.getSnapshot().epoch !== epoch)
      throw new Error('Account changed. Reload alerts.')
    if (response.status === 401) session.set(null)
    const value = await response.json().catch(() => null)
    if (session.getSnapshot().epoch !== epoch)
      throw new Error('Account changed. Reload alerts.')
    if (!response.ok)
      throw new Error(
        typeof value?.detail === 'string'
          ? value.detail
          : 'Account alerts unavailable. Reload before retrying.',
      )
    return parseAccountAlerts(value)
  }
  return {
    get: () => request(),
    replace: (revision: number, rules: AlertRule[]) =>
      request({ revision, rules }),
  }
}
export const accountAlerts = createAccountAlertsClient(env.apiBaseUrl)
export function mergeAlertRules(first: AlertRule[], second: AlertRule[]) {
  const rules = [...first]
  for (const rule of second) {
    if (
      rules.some(
        (r) =>
          r.pair === rule.pair &&
          r.metric === rule.metric &&
          r.threshold === rule.threshold &&
          r.expiry === rule.expiry,
      )
    )
      continue
    rules.push({
      ...rule,
      id: rules.some((r) => r.id === rule.id) ? crypto.randomUUID() : rule.id,
    })
  }
  if (rules.length > 20)
    throw new Error(
      'The merged set exceeds 20 rules. Remove rules before merging.',
    )
  return rules
}
