import { lazy, Suspense, useCallback, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { selectExpiry, maturityMatchingChange } from '@/lib/relativeValue'
import { currency, formatDate, number } from '@/lib/format'
import DiagnosticLabel from '@/components/DiagnosticLabel'
import CrowLoader from '@/components/CrowLoader'
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
  const { meta } = useOutletContext<DashboardContext>()
  const [pair, setPair] = useState(pairs[0])
  const [window, setWindow] = useState(10)
  const [purity, setPurity] = useState(false)
  const [carry, setCarry] = useState(true)
  const [preferred, setPreferred] = useState<string>()
  const goldm = pair.startsWith('GOLDM-')
  const actualCarry = goldm ? carry : true
  const load = useCallback(
    (signal: AbortSignal) =>
      api.spreads(
        { pair, window, purity, carry_adjusted: actualCarry },
        signal,
      ),
    [pair, window, purity, actualCarry],
  )
  const resource = useResource(load)
  const comparison = useResource(
    useCallback(
      async (signal: AbortSignal) => {
        if (!goldm) return { data: null, source: 'API' as const }
        return api.spreads(
          { pair, window, purity, carry_adjusted: !actualCarry },
          signal,
        )
      },
      [goldm, pair, window, purity, actualCarry],
    ),
  )
  const response = resource.response
  const data = response?.data
  const selected = data
    ? selectExpiry(data.series, data.data_as_of, preferred)
    : undefined
  const series = data?.series.find((s) => s.expiry_a === selected)
  const latest = series?.latest
  const other = comparison.response?.data?.series
    .find((s) => s.expiry_a === selected)
    ?.rows.find((r) => r.trade_date === latest?.trade_date)
  const change = latest
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
            Compare normalized settlements within one expiry history. Historical
            observations, not executable prices or trading signals.
          </p>
        </div>
      </div>
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
          <p>
            {formatDate(latest.trade_date)} · {response.source} · Liquidity
            check: {latest.liquidity_ok ? 'Passed' : 'Failed'} ·{' '}
            {latest.analytics_only
              ? 'Analytics only'
              : 'Same expiry; fills not guaranteed'}
            .
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
              {comparison.response && (
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
          <p>
            {latest.reason || latest.liquidity_reason ? (
              <DiagnosticLabel
                code={latest.reason || latest.liquidity_reason}
              />
            ) : (
              'No reason provided'
            )}{' '}
            · Purity adjustment {purity ? 'enabled (experimental)' : 'off'}.
          </p>
        </section>
      )}
      <section className="panel rv-controls" aria-label="Comparison controls">
        <label>
          Pair
          <select
            aria-label="Pair"
            value={pair}
            onChange={(e) => {
              setPreferred(selected ?? preferred)
              setPair(e.target.value)
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
            onChange={(e) => setPreferred(e.target.value)}
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
              setPreferred(selected ?? preferred)
              setWindow(Number(e.target.value))
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
              setPreferred(selected ?? preferred)
              setPurity(e.target.checked)
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
                setPreferred(selected ?? preferred)
                setCarry(e.target.checked)
              }}
            />
            Maturity matching
          </label>
        )}
        <p className="rv-control-note">
          Minimum periods: 5. Default liquidity thresholds: volume 2,000 g; open
          interest 0 g. All expiries fetched; selection is local. Initial expiry
          is the earliest at least 3 calendar days after historical data_as_of,
          otherwise the latest available.
        </p>
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
            <button className="button" onClick={() => setWindow(10)}>
              Restore default window (10)
            </button>
          )}
          <button className="button" onClick={resource.retry}>
            Retry
          </button>
        </div>
      )}
      {response && data && (
        <>
          <section className="basis-note">
            <div>
              <span
                className={`source-badge ${response.source === 'Offline snapshot' ? 'offline' : ''}`}
              >
                {response.source}
              </span>
              <p>
                Historical data as of {formatDate(data.data_as_of)}. Prototype
                window:{' '}
                {meta.response?.data.trading_session_count ?? 'Unavailable'}{' '}
                sessions. Data window:{' '}
                {formatDate(data.data_window.first_trade_date)} to{' '}
                {formatDate(data.data_window.last_trade_date)}.
              </p>
              <details>
                <summary>Applied configuration details</summary>
                <p>
                  Applied: {config?.pair}; window {config?.window}; min_periods{' '}
                  {config?.min_periods}; purity{' '}
                  {String(config?.use_purity_adjustment)}; carry_adjusted{' '}
                  {String(config?.carry_adjusted)}; minimum volume{' '}
                  {config?.min_volume_grams} g; minimum open interest{' '}
                  {config?.min_oi_grams} g. Expiry/start/end filters:{' '}
                  {config?.expiry ?? 'all'} / {config?.start ?? 'all'} /{' '}
                  {config?.end ?? 'all'}.
                </p>
              </details>
              <p>
                {config?.use_purity_adjustment
                  ? 'Purity adjustment enabled'
                  : 'Purity adjustment disabled'}
              </p>
              <p>
                Normalization: {data.normalization.unit};{' '}
                {config?.use_purity_adjustment
                  ? data.normalization.basis
                  : 'quote-size conversion only; purity adjustment off'}
                . Purity verification:{' '}
                {data.normalization.purity_verification_status}. Purities are
                problem-statement assumptions, not verified MCX specifications.
              </p>
            </div>
          </section>
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
                  Observation: {formatDate(latest.trade_date)}.{' '}
                  {series.description}
                </p>
                {goldm && (
                  <p className="rv-analytics">
                    <strong>Analytics only</strong>. Liquidity passing does not
                    override this status. Interpolated prices are synthetic
                    comparison values, not executable fills.
                  </p>
                )}
                {!goldm && (
                  <p className="section-description">
                    {latest.executable_pair
                      ? 'Same-expiry structural eligibility'
                      : 'Analytics only'}
                    ; same-expiry structural eligibility is not a fill
                    guarantee.
                  </p>
                )}
                <DiagnosticLabel code={latest.comparison_type} />
                <details>
                  <summary>Technical eligibility</summary>
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
                <p>
                  Positive spread means A's normalized price exceeds B. Positive
                  z means the spread is above its own historical mean. Neither
                  implies guaranteed profit.
                </p>
                <p>
                  <strong>
                    Liquidity check: {latest.liquidity_ok ? 'Passed' : 'Failed'}
                  </strong>
                  . {latest.liquidity_reason || 'No reason provided'}{' '}
                  {latest.reason}
                </p>
                <details>
                  <summary>Source eligibility details</summary>
                  <p>
                    Source trade flag:{' '}
                    {latest.source_tradable ? 'Passed' : 'Failed'}.
                  </p>
                </details>
                <p>
                  B{' '}
                  {latest.expiry_b_used.length > 1
                    ? 'interpolation bracket'
                    : 'actual expiry'}
                  :{' '}
                  {latest.expiry_b_used.length
                    ? latest.expiry_b_used
                        .map(
                          (date, i) =>
                            `${formatDate(date)} (${latest.days_mismatch[i] >= 0 ? '+' : ''}${latest.days_mismatch[i]} days)`,
                        )
                        .join(' / ')
                    : 'Unavailable'}
                  . Comparison:{' '}
                  <DiagnosticLabel code={latest.comparison_type} />
                </p>
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
                <p className="section-description">
                  Every returned observation for expiry{' '}
                  {formatDate(series.expiry_a)}. Liquidity status is not trade
                  availability. Settlement/close is not an executable price.
                </p>
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
