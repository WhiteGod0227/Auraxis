import { lazy, Suspense, useCallback, useState } from 'react'
import CrowLoader from '@/components/CrowLoader'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import {
  backtestPairs,
  completedMetrics,
  costToleranceMessage,
  defaultDraft,
  draftParameters,
  hasDraftChanges,
  savedDefaults,
  selectBacktestExpiry,
  validateDraft,
} from '@/lib/backtest'
import type { BacktestDraft } from '@/lib/backtest'
import { currency, formatDate, number } from '@/lib/format'
const BacktestEquityChart = lazy(() =>
  import('@/components/BacktestCharts').then((m) => ({
    default: m.BacktestEquityChart,
  })),
)
const BacktestCostChart = lazy(() =>
  import('@/components/BacktestCharts').then((m) => ({
    default: m.BacktestCostChart,
  })),
)
const BacktestTables = lazy(() => import('@/components/BacktestTables'))
const numericControls = [
  { key: 'z_entry', label: 'Entry z threshold', min: 0.5, max: 3, step: 0.25 },
  { key: 'z_exit', label: 'Exit z threshold', min: 0, max: 1, step: 0.05 },
  {
    key: 'cost_bps_per_leg_per_side',
    label: 'Cost bps per leg per side',
    min: 0,
    max: 50,
    step: 1,
  },
  {
    key: 'min_volume_grams',
    label: 'Minimum volume (grams)',
    min: 0,
    max: 10000,
    step: 500,
  },
  {
    key: 'max_hold_sessions',
    label: 'Maximum holding sessions',
    min: 1,
    max: 10,
    step: 1,
  },
] as const
const reading = (v: number | null | undefined, money = false) =>
  typeof v === 'number' && Number.isFinite(v)
    ? (money ? currency : number).format(v)
    : 'Unavailable'
export function BacktestPage() {
  const [draft, setDraft] = useState<BacktestDraft>({ ...defaultDraft })
  const [applied, setApplied] = useState<BacktestDraft>({ ...defaultDraft })
  const [preferred, setPreferred] = useState<string>()
  const [validation, setValidation] = useState<string>()
  const load = useCallback(
    (signal: AbortSignal) => api.backtest(draftParameters(applied), signal),
    [applied],
  )
  const resource = useResource(load)
  const response = resource.response
  const data = response?.data
  const expiry = data
    ? selectBacktestExpiry(data.reports, data.data_as_of, preferred)
    : undefined
  const report = data?.reports.find((r) => r.expiry === expiry)
  const metric = report?.metrics
  const complete = report ? completedMetrics(report) : undefined
  const changed = hasDraftChanges(draft, applied)
  const cfg = data?.configuration
  const restore = () => {
    const defaults = savedDefaults(applied)
    setPreferred(expiry ?? preferred)
    setDraft(defaults)
    setApplied({ ...defaults })
    setValidation(undefined)
  }
  const edit = <K extends keyof BacktestDraft>(
    key: K,
    value: BacktestDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setValidation(undefined)
  }
  return (
    <div className="overview-page backtest-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">INDEPENDENT FIXED-EXPIRY SIMULATIONS</p>
          <h1>Backtest</h1>
          <p className="page-description">
            Explore a settlement-based simulation of fixed-expiry relative
            value, including transaction costs and outstanding positions.
          </p>
        </div>
      </div>
      {report && metric && (
        <>
          <section className="panel bt-verdict">
            <p>
              <strong>{report.configuration.pair}</strong> · Expiry{' '}
              {formatDate(report.expiry)} ·{' '}
              {report.configuration.sizing_mode === 'integer_lots'
                ? 'Integer lots (rounded down)'
                : 'Idealized fractional sizing'}{' '}
              · Costs {report.configuration.cost_bps_per_leg_per_side} bps per
              leg per side.
            </p>
            {changed && (
              <p className="ts-warning" role="status">
                Previous run—apply changes to update
              </p>
            )}
            <h2>API-generated verdict and sample limitations</h2>
            <p className="bt-api-verdict">{report.verdict}</p>
            <p>
              Selected sample: {metric.session_count} sessions,{' '}
              {metric.completed_count} completed trades;{' '}
              {formatDate(metric.first_simulation_date)} to{' '}
              {formatDate(metric.last_simulation_date)}.
            </p>
            {metric.warnings.map((warning) => (
              <p className="ts-warning" key={warning}>
                {warning}
              </p>
            ))}
          </section>
        </>
      )}
      <form
        className="panel bt-draft"
        onSubmit={(event) => {
          event.preventDefault()
          const error = validateDraft(draft)
          setValidation(error)
          if (!error) {
            setPreferred(expiry ?? preferred)
            setApplied({ ...draft })
          }
        }}
      >
        <div className="section-heading">
          <h2>Draft settings</h2>
          <span className="badge">
            {changed ? 'Edited - not applied' : 'Matches submitted settings'}
          </span>
        </div>
        <div className="rv-controls bt-controls">
          <label>
            Sizing mode
            <select
              aria-label="Sizing mode"
              value={draft.sizing_mode}
              onChange={(e) =>
                edit(
                  'sizing_mode',
                  e.target.value as 'fractional' | 'integer_lots',
                )
              }
            >
              <option value="fractional">Idealized fractional sizing</option>
              <option value="integer_lots">Integer lots (round down)</option>
            </select>
          </label>
          <label>
            Pair
            <select
              aria-label="Backtest pair"
              value={draft.pair}
              onChange={(e) => edit('pair', e.target.value)}
            >
              {backtestPairs.map((pair) => (
                <option key={pair}>{pair}</option>
              ))}
            </select>
          </label>
          <label className="rv-toggle">
            <input
              type="checkbox"
              checked={draft.purity}
              onChange={(e) => edit('purity', e.target.checked)}
            />
            Purity adjustment (experimental)
          </label>
        </div>
        <div className="bt-input-grid">
          {numericControls.map((control) => (
            <div className="bt-input" key={control.key}>
              <label htmlFor={`bt-${control.key}`}>{control.label}</label>
              <input
                id={`bt-${control.key}`}
                aria-label={control.label}
                type="number"
                min={control.min}
                max={control.max}
                step={control.step}
                required
                value={
                  Number.isNaN(draft[control.key]) ? '' : draft[control.key]
                }
                aria-describedby={validation ? 'bt-validation' : undefined}
                aria-invalid={Boolean(validation?.includes(control.key))}
                onChange={(e) =>
                  edit(
                    control.key,
                    e.target.value === '' ? NaN : Number(e.target.value),
                  )
                }
              />
              <input
                aria-label={`${control.label} slider`}
                aria-describedby={validation ? 'bt-validation' : undefined}
                aria-invalid={Boolean(validation?.includes(control.key))}
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={
                  Number.isFinite(draft[control.key])
                    ? draft[control.key]
                    : control.min
                }
                onChange={(e) => edit(control.key, Number(e.target.value))}
              />
              <small>
                {control.min}-{control.max}; step {control.step}
              </small>
            </div>
          ))}
        </div>
        <details>
          <summary>Technical simulation defaults</summary>
          <p className="section-description">
            Fixed defaults: window=10; min_periods=5;
            expiry_buffer_calendar_days=3; notional_per_leg=1000000;
            min_oi_grams=0. Purity assumptions remain unverified.
          </p>
        </details>
        <p>
          Exploring settings on this short historical dataset is not validation.
          Parameters are never automatically tuned.
        </p>
        {validation && (
          <p className="error-notice" role="alert" id="bt-validation">
            {numericControls.reduce(
              (message, control) =>
                message.replaceAll(control.key, control.label),
              validation,
            )}
          </p>
        )}
        <div className="bt-actions">
          <button className="button" type="submit">
            Run simulation
          </button>
          <button
            className="button"
            type="button"
            onClick={() => {
              setDraft({ ...defaultDraft })
              setValidation(undefined)
            }}
          >
            Reset to defaults
          </button>
        </div>
        <p className="section-description">
          Editing controls does not request a simulation. Displayed results keep
          their applied settings until a new submission completes.
        </p>
      </form>
      {resource.loading && (
        <div className="panel">
          <CrowLoader label={`Loading ${applied.pair} simulation…`} />
        </div>
      )}
      {resource.error && (
        <div className="error-notice" role="alert">
          <p>
            {resource.errorKind === 'offline-unavailable'
              ? 'This configuration is unavailable offline.'
              : resource.error}
          </p>
          {resource.errorKind === 'offline-unavailable' && (
            <button className="button" onClick={restore}>
              Load saved defaults
            </button>
          )}
          <button className="button" onClick={resource.retry}>
            Retry simulation
          </button>
        </div>
      )}
      {response && data && (
        <>
          <section className="panel bt-applied">
            <div className="section-heading">
              <h2>Selected simulation</h2>
              <span
                className={`source-badge ${response.source === 'Offline snapshot' ? 'offline' : ''}`}
              >
                {response.source}
              </span>
            </div>
            <p>
              Historical data as of {formatDate(data.data_as_of)}. Data window:{' '}
              {formatDate(data.data_window.first_trade_date)} to{' '}
              {formatDate(data.data_window.last_trade_date)}. {data.aggregation}
              .
            </p>
            <p>
              {cfg?.use_purity_adjustment
                ? 'Purity adjustment enabled'
                : 'Purity adjustment disabled'}
            </p>
            <details>
              <summary>Applied simulation settings</summary>
              <p>
                Pair {cfg?.pair}; sizing {cfg?.sizing_mode}; purity{' '}
                {String(cfg?.use_purity_adjustment)}; z_entry {cfg?.z_entry};
                z_exit {cfg?.z_exit}; cost_bps_per_leg_per_side{' '}
                {cfg?.cost_bps_per_leg_per_side}; min_volume_grams{' '}
                {cfg?.min_volume_grams}; max_hold_sessions{' '}
                {cfg?.max_hold_sessions}.
              </p>
              <p>
                window {cfg?.window}; min_periods {cfg?.min_periods}; expiry
                buffer {cfg?.expiry_buffer_calendar_days} calendar days;
                notional per leg {reading(cfg?.notional_per_leg, true)}; minimum
                OI {cfg?.min_oi_grams} g. All expiry reports requested; no date
                filters.
              </p>
            </details>
            <p>
              Signal normalization: {data.normalization.unit},{' '}
              {cfg?.use_purity_adjustment
                ? data.normalization.basis
                : 'raw quote-size normalization; purity off'}
              . Purity verification:{' '}
              {data.normalization.purity_verification_status}. Held-contract
              P&amp;L uses raw normalized prices.
            </p>
            <label className="ts-expiry-control">
              Selected report expiry
              <select
                aria-label="Backtest expiry"
                value={expiry ?? ''}
                disabled={!data.reports.length}
                onChange={(e) => setPreferred(e.target.value)}
              >
                {!expiry && <option value="">Unavailable</option>}
                {data.reports.map((r) => (
                  <option key={r.expiry} value={r.expiry}>
                    {formatDate(r.expiry)}
                  </option>
                ))}
              </select>
            </label>
            <p className="section-description">
              Expiry selection is local. Initial selection: earliest expiry at
              least three calendar days after historical data_as_of, otherwise
              latest available. No portfolio aggregation.
            </p>
          </section>
          {!report && (
            <div className="panel empty-state">
              {data.message ??
                'No expiry reports available for this configuration.'}
            </div>
          )}
          {report && metric && complete && (
            <>
              <section className="panel bt-summary">
                <h2>Selected expiry summary - {formatDate(report.expiry)}</h2>
                <p>
                  Applied: {report.configuration.pair} ·{' '}
                  {formatDate(report.expiry)} ·{' '}
                  {report.configuration.sizing_mode === 'integer_lots'
                    ? 'Integer lots (rounded down)'
                    : 'Idealized fractional sizing'}{' '}
                  · Costs {report.configuration.cost_bps_per_leg_per_side} bps
                  per leg per side.
                </p>
                {changed && (
                  <p className="ts-warning">
                    Previous run—apply changes to update
                  </p>
                )}
                <div className="rv-readings bt-kpis">
                  {[
                    [
                      'Realized net P&L',
                      metric.realized_net_pnl,
                      'Rs',
                      true,
                      'Returned closed-trade gross less closed-trade costs.',
                    ],
                    [
                      'Total marked net P&L',
                      metric.total_marked_net_pnl,
                      'Rs',
                      true,
                      metric.total_marked_pnl_reason ||
                        'Includes marked outstanding positions; not final P&L.',
                    ],
                    [
                      'Total incurred costs',
                      metric.total_incurred_costs,
                      'Rs',
                      true,
                      'Closed trade costs plus incurred open/unresolved entry costs.',
                    ],
                    [
                      'Maximum drawdown',
                      metric.maximum_drawdown_rupees,
                      'Rs',
                      true,
                      metric.maximum_drawdown_reason ||
                        'Backend full-window valuation-dependent drawdown; initial zero-P&L baseline.',
                    ],
                    [
                      'Completed trades',
                      metric.completed_count,
                      'trades',
                      false,
                      'Open and unresolved positions excluded.',
                    ],
                    [
                      'Closed-trade net win rate',
                      complete.winRate,
                      data.units.win_rate,
                      false,
                      complete.winRate === null
                        ? complete.reason
                        : 'Strictly positive net completed trades; fraction 0 to 1.',
                    ],
                    [
                      'Average completed holding',
                      complete.averageHolding,
                      data.units.holding,
                      false,
                      complete.averageHolding === null
                        ? complete.reason
                        : 'Available session intervals; entry day is zero.',
                    ],
                  ].map(([label, v, unit, money, reason]) => (
                    <div className="rv-reading" key={String(label)}>
                      <span>{String(label)}</span>
                      <strong>
                        {reading(v as number | null, Boolean(money))}
                      </strong>
                      <small>{String(unit)}</small>
                      <small>
                        {v === null ? 'Unavailable in API report: ' : ''}
                        {String(reason)}
                      </small>
                    </div>
                  ))}
                </div>
                <p>
                  Valuation quality: <strong>{metric.valuation_quality}</strong>
                  ; stale sessions: {metric.stale_session_count}; unavailable
                  sessions: {metric.unavailable_session_count}. Drawdown based
                  on stale marks: {String(metric.drawdown_based_on_stale_marks)}
                  .
                </p>
                <div className="bt-breakdown">
                  <h3>Separate accounting categories</h3>
                  <div
                    className="table-scroll bt-table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="P&L breakdown"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Gross P&amp;L (Rs)</th>
                          <th>Incurred costs (Rs)</th>
                          <th>Net P&amp;L (Rs)</th>
                          <th>Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          [
                            'Completed',
                            metric.realized_gross_pnl,
                            metric.completed_trade_costs,
                            metric.realized_net_pnl,
                            metric.completed_count,
                          ],
                          [
                            'Open marked',
                            metric.open_marked_gross_pnl,
                            metric.open_entry_costs,
                            metric.open_marked_net_pnl,
                            metric.open_count,
                          ],
                          [
                            'Unresolved-expiry marked',
                            metric.unresolved_marked_gross_pnl,
                            metric.unresolved_entry_costs,
                            metric.unresolved_marked_net_pnl,
                            metric.unresolved_count,
                          ],
                        ].map(([label, gross, cost, net, count]) => (
                          <tr key={String(label)}>
                            <td>{String(label)}</td>
                            <td>{reading(gross as number | null, true)}</td>
                            <td>{reading(cost as number | null, true)}</td>
                            <td>{reading(net as number | null, true)}</td>
                            <td>{count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p>
                    Pending orders: {metric.pending_order_count}. Categories are
                    returned separately and are not summed again. Gross-notional
                    reference capital: {reading(report.reference_capital, true)}
                    , both leg notionals; not margin capital or actual invested
                    cash.
                  </p>
                </div>
              </section>
              <section className="panel bt-equity">
                <h2>Cumulative simulated P&amp;L</h2>
                <p className="section-description">
                  Returned cumulative gross and net P&amp;L in rupees. Not
                  actual account equity. Missing valuations remain gaps; no
                  additional forward filling.
                </p>
                {metric.stale_session_count > 0 && (
                  <p className="ts-warning">
                    Stale valuation warning: {metric.stale_session_count}{' '}
                    sessions include stale marks; marked P&amp;L and drawdown
                    inherit this caveat.
                  </p>
                )}
                {metric.unavailable_session_count > 0 && (
                  <p className="ts-warning">
                    Valuation unavailable in {metric.unavailable_session_count}{' '}
                    sessions. {metric.total_marked_pnl_reason}{' '}
                    {metric.maximum_drawdown_reason}
                  </p>
                )}
                {report.equity_curve.length ? (
                  <Suspense
                    fallback={<p role="status">Loading P&amp;L chart...</p>}
                  >
                    <BacktestEquityChart report={report} />
                  </Suspense>
                ) : (
                  <p className="empty-state">
                    No valuation observations returned.
                  </p>
                )}
                <details>
                  <summary>
                    Valuation observations ({report.equity_curve.length})
                  </summary>
                  <div
                    className="table-scroll bt-table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="Valuation observations"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Gross P&amp;L</th>
                          <th>Incurred costs</th>
                          <th>Net P&amp;L</th>
                          <th>Valuation quality</th>
                          <th>Valuation reason</th>
                          <th>Drawdown reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.equity_curve.map((row) => (
                          <tr key={row.trade_date}>
                            <td>{formatDate(row.trade_date)}</td>
                            <td>{reading(row.cumulative_gross_pnl, true)}</td>
                            <td>
                              {reading(row.cumulative_incurred_costs, true)}
                            </td>
                            <td>{reading(row.cumulative_net_pnl, true)}</td>
                            <td>{row.valuation_quality}</td>
                            <td>
                              {row.valuation_reason || 'No reason provided'}
                            </td>
                            <td>
                              {row.drawdown_reason || 'No reason provided'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>
              <section className="panel bt-cost">
                <h2>Closed-trade cost sensitivity</h2>
                <p>
                  Trade dates and quantities are fixed. Outstanding positions
                  are excluded.
                </p>
                <p>
                  Excluded: {report.cost_tolerance.excluded_open_count} open and{' '}
                  {report.cost_tolerance.excluded_unresolved_count} unresolved
                  positions. This chart reprices completed trades; changing the
                  simulation cost control requires a new submission.
                </p>
                <div className="bt-tolerance">
                  <h3>Closed-trade cost tolerance</h3>
                  <p>{costToleranceMessage(report.cost_tolerance)}</p>
                  <p className="section-description">
                    Not whole-strategy break-even.
                  </p>
                </div>
                {report.cost_sensitivity.length ? (
                  <Suspense
                    fallback={<p role="status">Loading cost chart...</p>}
                  >
                    <BacktestCostChart report={report} />
                  </Suspense>
                ) : (
                  <p className="empty-state">
                    No cost sensitivity values returned.
                  </p>
                )}
                <details>
                  <summary>Returned cost sensitivity values</summary>
                  <div
                    className="table-scroll bt-table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="Cost sensitivity values"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>bps per leg per side</th>
                          <th>Completed gross P&amp;L</th>
                          <th>Costs</th>
                          <th>Completed net P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.cost_sensitivity.map((row) => (
                          <tr key={row.cost_bps_per_leg_per_side}>
                            <td>{row.cost_bps_per_leg_per_side}</td>
                            <td>{reading(row.gross_pnl, true)}</td>
                            <td>{reading(row.costs, true)}</td>
                            <td>{reading(row.net_pnl, true)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>
              <Suspense
                fallback={
                  <div className="panel" role="status">
                    Loading trade and position tables...
                  </div>
                }
              >
                <BacktestTables report={report} />
              </Suspense>
              <section className="panel bt-assumptions">
                <h2>Simulation limits</h2>
                <p>
                  Next-session execution uses idealized settlements. Liquidity
                  screening is not market depth or fill assurance. Outstanding
                  and unresolved positions limit final conclusions.
                </p>
                <details>
                  <summary>Detailed assumptions</summary>
                  <ul>
                    {[
                      ...new Set([...data.assumptions, ...report.assumptions]),
                    ].map((assumption) => (
                      <li key={assumption}>{assumption}</li>
                    ))}
                  </ul>
                </details>
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
