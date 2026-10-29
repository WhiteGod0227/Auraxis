import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import {
  alertPairs,
  evaluateAlert,
  readAlertRules,
  validAlertRule,
  writeAlertRules,
} from '@/lib/alerts'
import type { AlertRule } from '@/lib/alerts'
import type { SourcedResponse, SpreadsResponse } from '@/lib/types'
import { formatDate, number } from '@/lib/format'
import SourceBadge from '@/components/SourceBadge'
import AccountAlerts from '@/components/AccountAlerts'
import '@/styles/alerts.css'

type PairResult = {
  pair: string
  response?: SourcedResponse<SpreadsResponse>
  error?: string
}
function initialRules() {
  if (typeof window === 'undefined')
    return { rules: [] as AlertRule[], warning: '' }
  try {
    return readAlertRules(window.localStorage)
  } catch {
    return {
      rules: [] as AlertRule[],
      warning:
        'Browser storage is unavailable. Rules last only for this page session.',
    }
  }
}
export function AlertsPage() {
  const [stored, setStored] = useState(initialRules)
  const [pair, setPair] = useState<string>(alertPairs[0])
  const [metric, setMetric] = useState<AlertRule['metric']>('abs_z')
  const [threshold, setThreshold] = useState('1.5')
  const [expiry, setExpiry] = useState('')
  const [message, setMessage] = useState('')
  const pairsKey = [...new Set(stored.rules.map((rule) => rule.pair))]
    .sort()
    .join(',')
  const resource = useResource(
    useCallback(
      async (signal: AbortSignal) => {
        const results: PairResult[] = await Promise.all(
          (pairsKey ? pairsKey.split(',') : []).map(async (pair) => {
            try {
              return {
                pair,
                response: await api.spreads({ pair, purity: false }, signal),
              }
            } catch (error) {
              return {
                pair,
                error:
                  error instanceof Error
                    ? error.message
                    : 'Comparison unavailable.',
              }
            }
          }),
        )
        return { data: results, source: 'API' as const }
      },
      [pairsKey],
    ),
  )
  function update(rules: AlertRule[], success: string) {
    let warning = ''
    try {
      writeAlertRules(window.localStorage, rules)
    } catch {
      warning =
        'Rules are active for this page session, but could not be saved in this browser.'
    }
    setStored({ rules, warning })
    setMessage(success)
  }
  return (
    <div className="alerts-page">
      <div className="page-heading">
        <p className="eyebrow">RESEARCH WORKSPACE</p>
        <h1>Alerts</h1>
        <p className="section-description">
          Watch historical comparisons against your own thresholds.
        </p>
      </div>
      <p className="context-note">
        Evaluated when this page opens or you refresh results. Historical data,
        not live prices or background notifications. Rules are saved in this
        browser, shared by its users, and are separate from your account.
      </p>
      {stored.warning && (
        <p className="notice" role="status">
          {stored.warning}
        </p>
      )}
      <AccountAlerts browserRules={stored.rules} apply={update} />
      <form
        className="panel alert-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (stored.rules.length >= 20) {
            setMessage('Remove a rule before adding another (maximum 20).')
            return
          }
          const rule: AlertRule = {
            id: crypto.randomUUID(),
            pair,
            metric,
            threshold: Number(threshold),
            expiry: expiry || null,
          }
          if (!validAlertRule(rule)) {
            setMessage(
              'Choose a valid pair, date and threshold greater than 0 and at most 100.',
            )
            return
          }
          if (
            stored.rules.some(
              (r) =>
                r.pair === pair &&
                r.metric === metric &&
                r.threshold === rule.threshold &&
                r.expiry === rule.expiry,
            )
          ) {
            setMessage('That rule already exists.')
            return
          }
          update([...stored.rules, rule], 'Rule added.')
        }}
      >
        <h2>Create a research alert</h2>
        <div className="alert-controls">
          <label>
            Pair
            <select value={pair} onChange={(e) => setPair(e.target.value)}>
              {alertPairs.map((pair) => (
                <option key={pair}>{pair}</option>
              ))}
            </select>
          </label>
          <label>
            Measure
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as AlertRule['metric'])}
            >
              <option value="abs_z">Absolute z-score</option>
              <option value="abs_spread_pct">Absolute spread (% of B)</option>
            </select>
          </label>
          <label>
            At least
            <input
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              required
            />
          </label>
          <label>
            Expiry (optional)
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
            <small>Blank uses the latest eligible contract.</small>
          </label>
        </div>
        <p className="context-note">
          Purity off; 10-session statistics, minimum 5 observations, 2,000 g
          volume filter. GOLDM uses analytical maturity matching. Thresholds use
          magnitude, including negative observations.
        </p>
        <button
          className="landing-cta"
          type="submit"
          disabled={stored.rules.length >= 20}
        >
          Add alert
        </button>
        <p role="status" aria-live="polite">
          {message}
        </p>
      </form>
      <div className="section-heading">
        <h2>Your rules ({stored.rules.length}/20)</h2>
        <button
          className="button"
          onClick={resource.retry}
          disabled={resource.loading || !stored.rules.length}
        >
          {resource.loading ? 'Checking...' : 'Refresh results'}
        </button>
      </div>
      {!stored.rules.length && (
        <section className="panel alert-empty">
          <h2>No alerts yet</h2>
          <p>
            Add a threshold above to evaluate a historical comparison. No
            browser notification permission is needed.
          </p>
        </section>
      )}
      <div className="alert-list">
        {stored.rules.map((rule) => {
          const result = resource.response?.data.find(
            (r) => r.pair === rule.pair,
          )
          const evaluation = evaluateAlert(rule, result?.response?.data)
          const label =
            rule.metric === 'abs_z'
              ? 'absolute z-score'
              : 'absolute spread (% of B)'
          return (
            <article className="panel alert-card" key={rule.id}>
              <div className="section-heading">
                <h3>{rule.pair}</h3>
                <span
                  className={`alert-status ${resource.loading || result?.error ? 'unavailable' : evaluation.status}`}
                >
                  {resource.loading
                    ? 'Checking'
                    : result?.error
                      ? 'Unavailable'
                      : evaluation.status === 'triggered'
                        ? 'Threshold met'
                        : evaluation.status === 'below'
                          ? 'Below threshold'
                          : 'Unavailable'}
                </span>
              </div>
              <p>
                {label} &ge; {number.format(rule.threshold)}
                {rule.metric === 'abs_spread_pct' ? '%' : ''} ·{' '}
                {rule.expiry
                  ? formatDate(rule.expiry)
                  : 'Latest eligible expiry'}
              </p>
              {!resource.loading && result?.response && (
                <div className="alert-source">
                  <SourceBadge source={result.response.source} />
                  <span>
                    Data as of {formatDate(result.response.data.data_as_of)}
                  </span>
                  {result.response.generatedAt && (
                    <span>
                      Snapshot generated {result.response.generatedAt}
                    </span>
                  )}
                </div>
              )}
              {!resource.loading && (
                <>
                  {evaluation.value !== null && !result?.error && (
                    <p className="alert-reading">
                      {number.format(evaluation.value)}
                      {rule.metric === 'abs_spread_pct' ? '%' : ''}
                      <small>
                        Signed observation · {formatDate(evaluation.date)} ·
                        expiry {formatDate(evaluation.expiry)}
                      </small>
                    </p>
                  )}
                  <p
                    className="context-note"
                    role={result?.error ? 'alert' : undefined}
                  >
                    {result?.error ?? evaluation.reason}
                  </p>
                </>
              )}
              <div className="alert-actions">
                <Link to="/app/relative-value">Explore comparisons</Link>
                <button
                  className="button"
                  onClick={() =>
                    update(
                      stored.rules.filter((r) => r.id !== rule.id),
                      'Rule removed.',
                    )
                  }
                >
                  Remove rule
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
