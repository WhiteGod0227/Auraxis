import SourceBadge from '@/components/SourceBadge'
import DataContext from '@/components/DataContext'
import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { commonCarryComparison, landingBacktestReport } from '@/lib/landing'
import { currency, formatDate, number } from '@/lib/format'
import DiagnosticLabel from '@/components/DiagnosticLabel'
import LandingCrow from '@/components/LandingCrow'
import CrowLoader from '@/components/CrowLoader'
import LandingHeaderNav from '@/components/LandingHeaderNav'
const ReferencePriceChart = lazy(
  () => import('@/components/ReferencePriceChart'),
)
const pricesLoad = (signal: AbortSignal) => api.prices({}, signal)
const carryOnLoad = (signal: AbortSignal) =>
  api.spreads(
    {
      pair: 'GOLDM-GOLDTEN',
      carry_adjusted: true,
      purity: false,
      window: 10,
      min_periods: 5,
    },
    signal,
  )
const carryOffLoad = (signal: AbortSignal) =>
  api.spreads(
    {
      pair: 'GOLDM-GOLDTEN',
      carry_adjusted: false,
      purity: false,
      window: 10,
      min_periods: 5,
    },
    signal,
  )
const backtestLoad = (signal: AbortSignal) =>
  api.backtest({ pair: 'GOLDTEN-GOLDPETAL' }, signal)
const value = (v: number | null | undefined, money = false) =>
  typeof v === 'number' && Number.isFinite(v)
    ? (money ? currency : number).format(v)
    : 'Unavailable'
const features = [
  [
    'relative-value',
    'Relative Value',
    'Compare one fixed-expiry spread with its preceding history and inspect quality diagnostics.',
  ],
  [
    'term-structure',
    'Term Structure',
    'Inspect actual expiry curves and the modelled roll-down of a fixed contract.',
  ],
  [
    'backtest',
    'Backtest',
    'Explore settlement-based simulations, transaction costs and outstanding positions.',
  ],
  [
    'data-health',
    'Data Health',
    'See retained ingestion statuses, observation flags and unavailable checks.',
  ],
  [
    'methodology',
    'Methodology',
    'Read implemented formulas, assumptions and limitations.',
  ],
] as const
export function LandingPage() {
  const [carry, setCarry] = useState(true)
  const meta = useResource(api.meta)
  const prices = useResource(pricesLoad)
  const on = useResource(carryOnLoad)
  const off = useResource(carryOffLoad)
  const backtest = useResource(backtestLoad)
  const comparison = commonCarryComparison(
    on.response?.data,
    off.response?.data,
    meta.response?.data.data_as_of,
  )
  const selected = comparison
    ? carry
      ? comparison.on
      : comparison.off
    : undefined
  const carryResource = carry ? on : off
  const report = landingBacktestReport(backtest.response?.data)
  return (
    <div className="landing">
      <a className="skip-link" href="#landing-main">
        Skip to content
      </a>
      <header className="landing-nav">
        <Link className="landing-brand" to="/" aria-label="Auraxis home">
          <span className="landing-monogram" aria-hidden="true">
            A
          </span>
          AURAXIS
          <span className="landing-brand-note">GOLD FUTURES RESEARCH</span>
        </Link>
        <LandingHeaderNav />
      </header>
      <main id="landing-main" tabIndex={-1}>
        <section className="landing-hero landing-section">
          <div className="landing-hero-copy">
            <LandingCrow />
            <p className="eyebrow">MCX GOLD FUTURES / HISTORICAL RESEARCH</p>
            <h1>
              Same gold.
              <br />
              Different contracts.
              <br />
              <span>Is the gap real?</span>
            </h1>
            <p className="landing-intro">
              Compare gold contracts on a common basis, inspect maturity and
              liquidity differences, and test how costs affect simulated
              results.
            </p>
            <div className="landing-actions">
              <Link className="landing-cta" to="/app">
                Open Dashboard <span aria-hidden="true">&rarr;</span>
              </Link>
              <Link className="landing-secondary" to="/app/methodology">
                See Methodology
              </Link>
            </div>

            {meta.error && (
              <>
                <p>Metadata unavailable: {meta.error}</p>
                <button className="button" onClick={meta.retry}>
                  Retry metadata
                </button>
              </>
            )}
          </div>
          <div className="panel landing-preview">
            <div className="section-heading">
              <h2>One basis. Separate histories.</h2>
              {prices.response && (
                <DataContext
                  date={prices.response.data.data_as_of}
                  source={prices.response.source}
                  experimental={prices.response.data.purity_adjustment}
                />
              )}
            </div>
            {prices.loading && (
              <div className="landing-chart-placeholder" role="status">
                <CrowLoader label="Loading historical prices…" />
              </div>
            )}
            {prices.error && (
              <div className="error-notice" role="alert">
                <p>Chart unavailable: {prices.error}</p>
                <button className="button" onClick={prices.retry}>
                  Retry price preview
                </button>
              </div>
            )}
            {prices.response && (
              <>
                <p className="chart-caption">
                  {prices.response.data.normalization.unit} · historical
                  settlements, not executable prices.
                </p>
                {prices.response.data.series.some((s) => s.history.length) ? (
                  <Suspense
                    fallback={
                      <div className="landing-chart-placeholder" role="status">
                        Loading chart...
                      </div>
                    }
                  >
                    <ReferencePriceChart response={prices.response.data} />
                  </Suspense>
                ) : (
                  <div className="landing-chart-placeholder">
                    No historical prices available.
                  </div>
                )}
                <details>
                  <summary>Fixed-expiry observations and quality</summary>
                  <p>
                    Data date: {formatDate(prices.response.data.data_as_of)}.
                    Sample:{' '}
                    {meta.response?.data.trading_session_count ?? 'Unavailable'}{' '}
                    sessions.
                  </p>
                  <div
                    className="table-scroll landing-table"
                    tabIndex={0}
                    role="region"
                    aria-label="Historical price preview values"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Expiry</th>
                          <th>Date</th>
                          <th>Normalized price</th>
                          <th>has_trade</th>
                          <th>Quality</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prices.response.data.series.map((s) =>
                          s.history.map((row) => (
                            <tr
                              key={`${s.product}-${row.expiry_date}-${row.trade_date}`}
                            >
                              <td>{s.product}</td>
                              <td>{formatDate(row.expiry_date)}</td>
                              <td>{formatDate(row.trade_date)}</td>
                              <td>{value(row.close_p10_999, true)}</td>
                              <td>{row.has_trade ? 'Passed' : 'Failed'}</td>
                              <td>
                                {row.quality_reason || 'No reason provided'}
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </div>
        </section>
        <section id="problem" className="landing-section" tabIndex={-1}>
          <p className="eyebrow">THE PROBLEM</p>
          <h2>A price gap has more than one explanation.</h2>
          <div className="landing-grid">
            {[
              [
                '01',
                'Different units and assumed purity',
                'Quotes use different weight bases. Compare normalized prices and keep unverified purity assumptions explicit.',
              ],
              [
                '02',
                'Different maturities',
                'A contract expiring next week is not the same maturity as one expiring next month. Synthetic matching remains a diagnostic.',
              ],
              [
                '03',
                'Liquidity and transaction costs',
                'A settlement is not an executable fill. Thin trading, next-session execution and costs can change simulated outcomes.',
              ],
            ].map(([n, title, text]) => (
              <article className="panel" key={n}>
                <span className="landing-step-number">{n}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="how-it-works" className="landing-section" tabIndex={-1}>
          <p className="eyebrow">HOW IT WORKS</p>
          <h2>From historical observations to inspectable results.</h2>
          <ol className="landing-steps">
            {[
              [
                'Ingest historical data',
                'Load manually downloaded Bhavcopy CSVs and retain ingestion statuses and observation flags.',
              ],
              [
                'Normalize and match maturities',
                'Convert quote units and assumed purity, then compare fixed expiries or same-date maturity brackets.',
              ],
              [
                'Measure spreads against their own history',
                'Use preceding finite observations to describe a spread, without claiming that a deviation must converge.',
              ],
              [
                'Simulate execution and costs',
                'Inspect idealized next-session settlements, fixed sizing, costs and positions that remain outstanding.',
              ],
            ].map(([title, text], i) => (
              <li key={title}>
                <span className="landing-step-number">0{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="landing-section" id="maturity-comparison">
          <p className="eyebrow">REAL MATURITY COMPARISON</p>
          <div className="landing-section-heading">
            <h2>The same contract. Two comparisons.</h2>
          </div>
          <p>See how matching contract dates changes the price gap.</p>
          <div className="panel landing-carry">
            <div
              className="landing-carry-controls"
              role="group"
              aria-label="Maturity matching comparison"
            >
              {[true, false].map((setting) => (
                <button
                  className={`button ${carry === setting ? 'selected' : ''}`}
                  aria-pressed={carry === setting}
                  key={String(setting)}
                  onClick={() => setCarry(setting)}
                >
                  {setting ? 'Matching on' : 'Matching off'}
                </button>
              ))}
            </div>
            <p>GOLDM-GOLDTEN · Synthetic comparison, not executable prices.</p>
            <details>
              <summary>Comparison settings</summary>
              <p>
                window=10; min_periods=5; purity=false; minimum volume=2000 g;
                minimum OI=0 g. Uses all-expiry responses.
              </p>
            </details>
            {[on, off].map((r, i) => (
              <div className="landing-carry-source" key={i}>
                {r.response && <SourceBadge source={r.response.source} />}
                {r.error && (
                  <>
                    <p>{r.error}</p>
                    <button className="button" onClick={r.retry}>
                      Retry carry {i === 0 ? 'on' : 'off'}
                    </button>
                  </>
                )}
              </div>
            ))}
            {on.loading || off.loading ? (
              <div className="landing-comparison-placeholder" role="status">
                <CrowLoader label="Loading maturity comparison…" />
              </div>
            ) : selected && comparison ? (
              <div className="landing-carry-values">
                <p>
                  Expiry <strong>{formatDate(comparison.expiry)}</strong> ·{' '}
                  {formatDate(comparison.date)}.{' '}
                  {carryResource.response?.source === 'Offline snapshot' &&
                    'Offline snapshot.'}
                </p>
                <div className="rv-readings">
                  {[
                    ['Normalized GOLDM A', selected.a_p10_999, true],
                    ['Normalized GOLDTEN B', selected.b_p10_999, true],
                    ['Spread A minus B', selected.spread_abs, true],
                    ['Spread (% of B)', selected.spread_pct, false],
                  ].map(([label, v, money]) => (
                    <div className="rv-reading" key={String(label)}>
                      <span>{String(label)}</span>
                      <strong>
                        {value(v as number | null, Boolean(money))}
                      </strong>
                      <small>{money ? 'Rs per 10 g' : 'percent of B'}</small>
                    </div>
                  ))}
                </div>
                <details>
                  <summary>Contract and eligibility details</summary>
                  <p>
                    B {carry ? 'interpolation bracket' : 'actual expiry'}:{' '}
                    {selected.expiry_b_used
                      .map(
                        (date, i) =>
                          `${formatDate(date)} (${selected.days_mismatch[i] >= 0 ? '+' : ''}${selected.days_mismatch[i]} days)`,
                      )
                      .join(' / ')}
                    . Differences are signed B expiry minus A expiry.
                  </p>
                  <p>
                    <strong>Analytics only</strong>. Liquidity:{' '}
                    {selected.liquidity_ok ? 'Pass' : 'Fail'};{' '}
                    {selected.liquidity_reason || 'No reason provided'}.
                    Liquidity passing does not make this executable.
                  </p>
                  <DiagnosticLabel code={selected.comparison_type} />
                  <p>
                    Dataset through {formatDate(comparison.datasetThrough)}.
                  </p>
                </details>
                <details>
                  <summary>Technical eligibility</summary>
                  <p>
                    executable_pair={String(selected.executable_pair)};
                    comparison_type={selected.comparison_type}
                  </p>
                </details>
              </div>
            ) : (
              <div className="landing-comparison-placeholder">
                Maturity comparison unavailable: no common finite expiry/date
                with a valid carry-on bracket in matching configurations.
              </div>
            )}
            <details className="section-description">
              <summary>How this comparison is selected</summary>
              <p>
                Selection uses the latest common finite observation date with a
                valid carry-on bracket first, then the nearest eligible
                unexpired A expiry on that date. An earlier observation is used
                only if the latest dataset date has no eligible comparison.
                Interpolated values are synthetic, not fills. Adjustment may
                widen, shrink or reverse the gap.
              </p>
            </details>
          </div>
        </section>
        <section className="landing-section">
          <p className="eyebrow" id="explore-dashboard">
            THE DASHBOARD
          </p>
          <h2>Inspect the assumptions behind every number.</h2>
          <div className="landing-feature-grid">
            {features.map(([route, title, text]) => (
              <Link
                className="panel landing-feature"
                key={route}
                to={`/app/${route}`}
              >
                <h3>
                  {title} <span aria-hidden="true">&rarr;</span>
                </h3>
                <p>{text}</p>
              </Link>
            ))}
          </div>
        </section>
        <section className="landing-section landing-honest">
          <p className="eyebrow" id="honest-results">
            HONEST RESULTS
          </p>
          <h2>A simulation can expose limits, too.</h2>
          {backtest.loading && (
            <div className="panel landing-comparison-placeholder" role="status">
              <CrowLoader label="Loading simulation…" />
            </div>
          )}
          {backtest.error && (
            <div className="error-notice" role="alert">
              <p>Simulation report unavailable: {backtest.error}</p>
              <button className="button" onClick={backtest.retry}>
                Retry default report
              </button>
            </div>
          )}
          {report && backtest.response ? (
            <div className="panel landing-report">
              <DataContext
                date={backtest.response.data.data_as_of}
                source={backtest.response.source}
                experimental={report.configuration.use_purity_adjustment}
              />
              <h3>
                {report.configuration.pair} - expiry {formatDate(report.expiry)}
              </h3>
              <details>
                <summary>Simulation settings and selection</summary>
                <p>
                  Applied: entry z {report.configuration.z_entry}; exit z{' '}
                  {report.configuration.z_exit}; cost{' '}
                  {report.configuration.cost_bps_per_leg_per_side} bps per leg
                  per side; max hold {report.configuration.max_hold_sessions};
                  minimum volume {report.configuration.min_volume_grams} g;
                  purity {String(report.configuration.use_purity_adjustment)}.
                </p>
                <p>
                  window {report.configuration.window}; min_periods{' '}
                  {report.configuration.min_periods}; expiry buffer{' '}
                  {report.configuration.expiry_buffer_calendar_days} days;
                  notional per leg {report.configuration.notional_per_leg} Rs;
                  min OI {report.configuration.min_oi_grams} g. Selected by the
                  dashboard's historical three-calendar-day expiry rule, not by
                  performance.
                </p>
              </details>
              <div className="rv-readings">
                {[
                  ['Completed', report.metrics.completed_count, false],
                  ['Open', report.metrics.open_count, false],
                  ['Unresolved', report.metrics.unresolved_count, false],
                  ['Realized net P&L', report.metrics.realized_net_pnl, true],
                  [
                    'Total marked net P&L',
                    report.metrics.total_marked_net_pnl,
                    true,
                  ],
                ].map(([label, v, money]) => (
                  <div className="rv-reading" key={String(label)}>
                    <span>{String(label)}</span>
                    <strong>{value(v as number | null, Boolean(money))}</strong>
                  </div>
                ))}
              </div>
              <details>
                <summary>Result interpretation and warnings</summary>
                <p className="landing-api-verdict">{report.verdict}</p>
                {report.metrics.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </details>
              <p className="section-description">
                Settlement simulation · short sample, not proof of
                profitability.
              </p>
            </div>
          ) : (
            !backtest.loading &&
            !backtest.error && (
              <div className="panel">No default expiry report available.</div>
            )
          )}
          <Link className="landing-secondary" to="/app/backtest">
            Inspect Backtest
          </Link>
        </section>
        <section
          className="landing-section landing-limitations"
          id="limitations"
          tabIndex={-1}
        >
          <p className="eyebrow">LIMITATIONS</p>
          <h2>Research first. Assumptions visible.</h2>
          <ul>
            <li>Short historical prototype window.</li>
            <li>Unverified purity assumptions.</li>
            <li>
              Provisional comparison basis: delivery purity alone does not
              establish a price multiplier; quotation locations differ.
            </li>
            <li>
              Settlement-based idealized simulation with fractional quantities.
            </li>
            <li>Synthetic maturity comparisons are not executable fills.</li>
            <li>
              Outstanding and unresolved positions may prevent final
              conclusions.
            </li>
          </ul>
          <Link className="landing-secondary" to="/app/methodology">
            Read the full methodology
          </Link>
        </section>
      </main>
      <footer className="landing-footer">
        <Link to="/">AURAXIS</Link>
        <span>
          Educational and research purposes only. Not investment advice.
        </span>
        <Link to="/app">Open Dashboard</Link>
      </footer>
    </div>
  )
}
