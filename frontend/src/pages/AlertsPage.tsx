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
import { PageHeader } from '@/components/ui'
import { pairLabel } from '@/lib/insight'
import { MIN_SESSIONS, useBuildingHistory } from '@/lib/history'

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
  const { building } = useBuildingHistory()
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
      <PageHeader
        title="Alerts"
        subtitle="Set a level for any pair. Each time you open this page, Auraxis checks the latest data and flags the pairs that crossed it."
      />
      {stored.warning && (
        <p className="notice" role="status">
          {stored.warning}
        </p>
      )}
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
        <h2>New alert</h2>
        <div className="alert-controls">
          <label>
            Pair
            <select value={pair} onChange={(e) => setPair(e.target.value)}>
              {alertPairs.map((pair) => (
                <option key={pair} value={pair}>
                  {pairLabel(pair)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Watch
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as AlertRule['metric'])}
            >
              <option value="abs_z">How unusual the gap is (σ)</option>
              <option value="abs_spread_pct">Gap size (% of price)</option>
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
            Contract (optional)
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
            <small>Leave blank for the nearest contract.</small>
          </label>
        </div>
        <p className="ui-muted-note">
          Works in both directions: a gap of −2σ meets a 2σ level.
          {building && metric === 'abs_z'
            ? ` “How unusual” needs ${MIN_SESSIONS} trading days of data; gap size works now.`
            : ''}
        </p>
        <button
          className="ui-button primary"
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
        <h2>Your alerts ({stored.rules.length}/20)</h2>
        <button
          className="button"
          onClick={resource.retry}
          disabled={resource.loading || !stored.rules.length}
        >
          {resource.loading ? 'Checking…' : 'Check now'}
        </button>
      </div>
      {!stored.rules.length && (
        <section className="panel alert-empty">
          <h2>No alerts yet</h2>
          <p>
            Pick a pair and a level above. Alerts are checked in the app — no
            emails or browser notifications.
          </p>
        </section>
      )}
      <div className="alert-list">
        {stored.rules.map((rule) => {
          const result = resource.response?.data.find(
            (r) => r.pair === rule.pair,
          )
          const evaluation = evaluateAlert(rule, result?.response?.data)
          const label = rule.metric === 'abs_z' ? 'How unusual' : 'Gap size'
          return (
            <article className="panel alert-card" key={rule.id}>
              <div className="section-heading">
                <h3>{pairLabel(rule.pair)}</h3>
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
                {rule.metric === 'abs_spread_pct' ? '%' : 'σ'} ·{' '}
                {rule.expiry ? formatDate(rule.expiry) : 'Nearest contract'}
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
                        Latest reading · {formatDate(evaluation.date)} · expiry{' '}
                        {formatDate(evaluation.expiry)}
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
                <Link to="/app/relative-value">Open in Compare</Link>
                <button
                  className="button"
                  onClick={() =>
                    update(
                      stored.rules.filter((r) => r.id !== rule.id),
                      'Rule removed.',
                    )
                  }
                >
                  Remove
                </button>
              </div>
            </article>
          )
        })}
      </div>
      <details className="ui-how">
        <summary>Use these alerts on another device</summary>
        <div className="ui-how-body">
          <AccountAlerts browserRules={stored.rules} apply={update} />
        </div>
      </details>
    </div>
  )
}
