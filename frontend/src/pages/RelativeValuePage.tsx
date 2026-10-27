import DataContext from '@/components/DataContext'
import { lazy, Suspense, useCallback, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { selectExpiry, maturityMatchingChange } from '@/lib/relativeValue'
import { currency, formatDate, number } from '@/lib/format'
import DiagnosticLabel from '@/components/DiagnosticLabel'
import CrowLoader from '@/components/CrowLoader'
import ComparisonExplanation from '@/components/ComparisonExplanation'
import SaveResearch from '@/components/SaveResearch'
import { useWorkspace } from '@/lib/workspaceContext'
import {
  relativeConfiguration,
  researchCandidate,
  restoredExpiry,
  selection,
} from '@/lib/workspaces'
import type { DashboardContext } from '@/layouts/AppLayout'
const SpreadCharts = lazy(() => import('@/components/SpreadCharts'))
const pairs = [
  'GOLDTEN-GOLDPETAL',
  'GOLDTEN-GOLDGUINEA',
  'GOLDGUINEA-GOLDPETAL',
  'GOLDM-GOLDTEN',
  'GOLDM-GOLDGUINEA',
  'GOLDM-GOLDPETAL',
]
const reading = (value: number | null | undefined, money = false) =>
  typeof value === 'number' && Number.isFinite(value)
    ? (money ? currency : number).format(value)
    : 'Unavailable'
export function RelativeValuePage() {
  const workspace = useWorkspace()
  const saved =
    workspace?.configuration.kind === 'relative_value'
      ? workspace.configuration
      : undefined
  const { meta, relativeValue, setRelativeValue } =
    useOutletContext<DashboardContext>()
  const [restored, setRestored] = useState(() =>
    saved
      ? {
          pair: saved.query.pair,
          window: saved.query.window!,
          purity: saved.query.purity!,
          carry: saved.query.carry_adjusted!,
          preferred:
            saved.expiry.mode === 'explicit' ? saved.expiry.value : undefined,
        }
      : undefined,
  )
  const { pair, window, purity, carry, preferred } = restored ?? relativeValue
  const remember = (values: Partial<typeof relativeValue>) =>
    saved
      ? setRestored((previous) => ({ ...previous!, ...values }))
      : setRelativeValue((previous) => ({ ...previous, ...values }))
  const goldm = pair.startsWith('GOLDM-')
  const actualCarry = goldm || saved ? carry : true
  const load = useCallback(
    (signal: AbortSignal) =>
      api.spreads(
        { ...saved?.query, pair, window, purity, carry_adjusted: actualCarry },
        signal,
      ),
    [saved, pair, window, purity, actualCarry],
  )
  const resource = useResource(load)
  const comparison = useResource(
    useCallback(
      async (signal: AbortSignal) => {
        if (!goldm) return { data: null, source: 'API' as const }
        return api.spreads(
          {
            ...saved?.query,
            pair,
            window,
            purity,
            carry_adjusted: !actualCarry,
          },
          signal,
        )
      },
      [saved, goldm, pair, window, purity, actualCarry],
    ),
  )
  const response = resource.response
  const data = response?.data
  const selected = data
    ? restoredExpiry(
        data.series.map((s) => s.expiry_a),
        saved ? (preferred ? selection(preferred) : saved.expiry) : undefined,
        () => selectExpiry(data.series, data.data_as_of, preferred),
      )
    : undefined
  const series = data?.series.find((s) => s.expiry_a === selected)
  const latest = series?.latest
  const other = comparison.response?.data?.series
    .find((s) => s.expiry_a === selected)
    ?.rows.find((r) => r.trade_date === latest?.trade_date)
  const compatibleSource =
    response &&
    comparison.response &&
    response.source === comparison.response.source &&
    data?.data_as_of === comparison.response.data?.data_as_of &&
    (response.source !== 'Offline snapshot' ||
      response.generatedAt === comparison.response.generatedAt)
  const change =
    latest && compatibleSource
      ? maturityMatchingChange(latest, other, actualCarry)
      : null
  const config = data?.configuration
  const offlineUnavailable = resource.errorKind === 'offline-unavailable'
  const [a, b] = pair.split('-')
  return (
    <div className="overview-page relative-value-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">FIXED-EXPIRY DIAGNOSTICS</p>
          <h1>Relative Value</h1>
          <p className="page-description">
            Compare gold futures on a common quote-size basis.
          </p>
        </div>
      </div>
      {response && (
        <DataContext
          date={data?.data_as_of}
          source={response.source}
          experimental={config?.use_purity_adjustment}
        />
      )}
      <SaveResearch
        selectionLabel={
          data && selected
            ? `${data.configuration.pair} · ${formatDate(selected)}`
            : undefined
        }
        currentContext={
          response
            ? { data_as_of: response.data.data_as_of, source: response.source }
            : undefined
        }
        candidate={researchCandidate(
          response,
          resource.loading,
          data && series
            ? relativeConfiguration(data, preferred ? selected : undefined)
            : undefined,
        )}
      />
      {saved && data && !series && (
        <p className="error-notice" role="alert">
          Saved expiry is unavailable for these settings. No other expiry has
          been substituted. Select another expiry explicitly to continue.
        </p>
      )}
      {latest && response && (
        <section
          className="panel rv-result-summary"
          aria-label="Comparison result summary"
        >
          <h2>
            {data?.configuration.pair} · {formatDate(latest.expiry_a)}
          </h2>
          <p>
            <strong>Price gap: {reading(latest.spread_abs, true)}</strong> per
            10 g (
            {typeof latest.spread_pct === 'number' &&
            Number.isFinite(latest.spread_pct)
              ? `${reading(latest.spread_pct)}% of B`
              : 'Unavailable'}
            ).
          </p>
          {goldm && (
            <p>
              Maturity matching {actualCarry ? 'on' : 'off'}. Change from
              matching:{' '}
              {comparison.loading
                ? 'Loading comparison…'
                : change === null
                  ? 'Unavailable for this exact observation'
                  : `${reading(change, true)} per 10 g (on minus off)`}
              .
              {comparison.response?.source === 'Offline snapshot' && (
                <> Comparison source: {comparison.response.source}.</>
              )}
              {comparison.error && (
                <>
                  {' '}
                  {comparison.error}{' '}
                  <button className="button" onClick={comparison.retry}>
                    Retry comparison
                  </button>
                </>
              )}
            </p>
          )}
          {(latest.reason || latest.liquidity_reason) && (
            <p>
              <DiagnosticLabel
                code={latest.reason || latest.liquidity_reason}
              />
            </p>
          )}
        </section>
      )}
      <section className="panel rv-controls" aria-label="Comparison controls">
        <label>
          Pair
          <select
            aria-label="Pair"
            value={pair}
            onChange={(e) => {
              remember({
                preferred: selected ?? preferred,
                pair: e.target.value,
              })
            }}
          >
            {pairs.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Fixed expiry (A)
          <select
            aria-label="Fixed expiry"
            value={selected ?? ''}
            disabled={!data?.series.length}
            onChange={(e) => remember({ preferred: e.target.value })}
          >
            {!selected && <option value="">Unavailable</option>}
            {data?.series.map((s) => (
              <option key={s.expiry_a} value={s.expiry_a}>
                {formatDate(s.expiry_a)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Window (observations)
          <select
            aria-label="Window"
            value={window}
            onChange={(e) => {
              remember({
                preferred: selected ?? preferred,
                window: Number(e.target.value),
              })
            }}
          >
            {Array.from({ length: 26 }, (_, i) => i + 5).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="rv-toggle">
          <input
            type="checkbox"
            checked={purity}
            onChange={(e) => {
              remember({
                preferred: selected ?? preferred,
                purity: e.target.checked,
              })
            }}
          />
          Purity adjustment (experimental)
        </label>
        {goldm && (
          <label className="rv-toggle">
            <input
              type="checkbox"
              checked={carry}
              onChange={(e) => {
                remember({
                  preferred: selected ?? preferred,
                  carry: e.target.checked,
                })
              }}
            />
            Maturity matching
          </label>
        )}
        <details className="applied-settings">
          <summary>Applied settings</summary>
          <dl className="settings-list">
            <dt>Minimum observations</dt>
            <dd>{config?.min_periods ?? saved?.query.min_periods ?? 5}</dd>
            <dt>Minimum volume</dt>
            <dd>
              {config?.min_volume_grams ??
                saved?.query.min_volume_grams ??
                2000}{' '}
              g
            </dd>
            <dt>Minimum open interest</dt>
            <dd>{config?.min_oi_grams ?? saved?.query.min_oi_grams ?? 0} g</dd>
            <dt>Expiry filter</dt>
            <dd>{config?.expiry ?? saved?.query.expiry ?? 'All expiries'}</dd>
          </dl>
          <p>
            The initial selection is the earliest expiry at least three calendar
            days after the historical data date, otherwise the latest available.
          </p>
        </details>
      </section>
      {resource.loading && (
        <div className="panel">
          <CrowLoader label="Loading comparison…" />
        </div>
      )}
      {resource.error && (
        <div className="error-notice" role="alert">
          <p>
            {offlineUnavailable
              ? 'This configuration is unavailable offline'
              : resource.error}
          </p>
          {offlineUnavailable && (
            <button className="button" onClick={() => remember({ window: 10 })}>
              Restore default window (10)
            </button>
          )}
          <button className="button" onClick={resource.retry}>
            Retry
          </button>
        </div>
      )}
      <ComparisonExplanation
        resource={resource}
        row={latest}
        counterpart={comparison}
        counterpartRow={other}
      />
      {response && data && (
        <>
          <details className="calculation-details">
            <summary>Calculation basis and data window</summary>
            <p>
              {data.normalization.unit};{' '}
              {config?.use_purity_adjustment
                ? data.normalization.basis
                : 'quote-size conversion; purity adjustment off'}
              . Purity assumptions remain unverified.
            </p>
            <p>
              {formatDate(data.data_window.first_trade_date)} to{' '}
              {formatDate(data.data_window.last_trade_date)} ·{' '}
              {meta.response?.data.trading_session_count ?? 'Unavailable'}{' '}
              sessions.
            </p>
            <p>
              Requested dates: {config?.start ?? 'Start of data'} to{' '}
              {config?.end ?? 'End of data'}.
            </p>
          </details>
          {!series && (
            <div className="panel empty-state">
              {data.message ??
                'No expiry observations available for this configuration.'}
            </div>
          )}
          {series && latest && (
            <>
              <section className="panel">
                <div className="section-heading">
                  <h2>Latest reading</h2>
                  <span className="badge">
                    Expiry A: {formatDate(series.expiry_a)}
                  </span>
                </div>
                <p className="section-description">
                  Observation: {formatDate(latest.trade_date)}.
                </p>
                {goldm && (
                  <p className="quality-notice">
                    Analytics only · synthetic maturity matching, not executable
                    prices.
                  </p>
                )}
                <details>
                  <summary>Eligibility details</summary>
                  <p>
                    Source trade flag:{' '}
                    {latest.source_tradable ? 'Passed' : 'Failed'}.
                  </p>
                  <p>
                    executable_pair={String(latest.executable_pair)};
                    comparison_type={latest.comparison_type}
                  </p>
                </details>
                <div className="rv-readings">
                  {[
                    [
                      `${a} normalized A`,
                      latest.a_p10_999,
                      data.units.prices,
                      true,
                    ],
                    [
                      `${b} normalized B`,
                      latest.b_p10_999,
                      data.units.prices,
                      true,
                    ],
                    [
                      'Spread A minus B',
                      latest.spread_abs,
                      data.units.spread_abs,
                      true,
                    ],
                    [
                      'Spread percentage',
                      latest.spread_pct,
                      data.units.spread_pct,
                      false,
                    ],
                    [
                      'Rolling mean',
                      latest.roll_mean,
                      data.units.roll_mean,
                      false,
                    ],
                    [
                      'Rolling standard deviation',
                      latest.roll_std,
                      data.units.roll_std,
                      false,
                    ],
                    ['Z-score', latest.z, data.units.z, false],
                    [
                      'Percentile',
                      latest.percentile,
                      data.units.percentile,
                      false,
                    ],
                  ].map(([label, value, unit, money]) => (
                    <div className="rv-reading" key={String(label)}>
                      <span>{String(label)}</span>
                      <strong>
                        {reading(value as number | null, Boolean(money))}
                      </strong>
                      <small>{String(unit)}</small>
                    </div>
                  ))}
                </div>
                <details>
                  <summary>Source eligibility details</summary>
                  <p>
                    Source trade flag:{' '}
                    {latest.source_tradable ? 'Passed' : 'Failed'}.
                  </p>
                </details>
                <details>
                  <summary>Maturity calculation details</summary>
                  <p>{data.maturity_definition}</p>
                </details>
              </section>
              <Suspense
                fallback={
                  <div className="panel" role="status">
                    Loading charts...
                  </div>
                }
              >
                <SpreadCharts series={series} />
              </Suspense>
              <section className="panel">
                <h2>Observation quality</h2>
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Observation quality and historical chart values"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Liquidity check</th>
                        <th>Source trade flag</th>
                        <th>Reasons</th>
                        <th>Chart values</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.rows.map((row) => (
                        <tr key={row.trade_date}>
                          <td>{formatDate(row.trade_date)}</td>
                          <td>{row.liquidity_ok ? 'Passed' : 'Failed'}</td>
                          <td>{row.source_tradable ? 'Passed' : 'Failed'}</td>
                          <td className="rv-reasons">
                            {[row.reason, row.liquidity_reason]
                              .filter(Boolean)
                              .join(' | ') || 'No reason provided'}
                          </td>
                          <td>
                            <details>
                              <summary>View chart values</summary>
                              <dl>
                                {[
                                  [
                                    'Spread (Rs per 10 g)',
                                    reading(row.spread_abs, true),
                                  ],
                                  ['Spread (% of B)', reading(row.spread_pct)],
                                  [
                                    'Rolling mean (% of B)',
                                    reading(row.roll_mean),
                                  ],
                                  [
                                    'Rolling standard deviation (percentage points)',
                                    reading(row.roll_std),
                                  ],
                                  ['Z-score', reading(row.z)],
                                ].map(([label, value]) => (
                                  <div key={label}>
                                    <dt>{label}</dt>
                                    <dd>{value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          <details className="panel">
            <summary>Technical assumptions</summary>
            <ul>
              {data.assumptions.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  )
}
