import { lazy, Suspense, useCallback, useState } from 'react'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import SaveResearch from '@/components/SaveResearch'
import { useWorkspace } from '@/lib/workspaceContext'
import {
  backtestConfiguration,
  researchCandidate,
  restoredExpiry,
  selection,
} from '@/lib/workspaces'
import {
  backtestPairs,
  completedMetrics,
  costToleranceSentence,
  defaultDraft,
  draftParameters,
  hasDraftChanges,
  savedDefaults,
  selectBacktestExpiry,
  validateDraft,
} from '@/lib/backtest'
import type { BacktestDraft } from '@/lib/backtest'
import { formatDate } from '@/lib/format'
import {
  HowItWorks,
  InfoTip,
  PageHeader,
  Skeleton,
  Stat,
} from '@/components/ui'
import { inr, longDate, num, pairLabel, signedInr } from '@/lib/insight'
import { Donut } from '@/components/LuxCharts'
import { DOWN, PALETTE, UP } from '@/lib/chartTheme'
import Crow from '@/components/Crow'
import '@/styles/backtest.css'
import { HistoryGate } from '@/components/HistoryGate'
import { useBuildingHistory } from '@/lib/history'

/** A backtest needs a full ranking window plus room to trade. */
const BACKTEST_SESSIONS = 20
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
const TradeBars = lazy(() =>
  import('@/components/BacktestCharts').then((m) => ({
    default: m.TradeBars,
  })),
)
const numericControls = [
  { key: 'z_entry', label: 'Enter beyond (σ)', min: 0.5, max: 3, step: 0.25 },
  { key: 'z_exit', label: 'Exit inside (σ)', min: 0, max: 1, step: 0.05 },
  {
    key: 'cost_bps_per_leg_per_side',
    label: 'Cost (bps per leg per side)',
    min: 0,
    max: 50,
    step: 1,
  },
  {
    key: 'min_volume_grams',
    label: 'Minimum volume (g)',
    min: 0,
    max: 10000,
    step: 500,
  },
  {
    key: 'max_hold_sessions',
    label: 'Max holding (sessions)',
    min: 1,
    max: 10,
    step: 1,
  },
] as const
const PRESETS = [
  { label: 'Cautious', z_entry: 2, z_exit: 0.5 },
  { label: 'Balanced', z_entry: 1.5, z_exit: 0.25 },
  { label: 'Active', z_entry: 1, z_exit: 0.25 },
] as const
const toneOf = (value: number | null | undefined) =>
  typeof value === 'number' && value !== 0
    ? value > 0
      ? ('up' as const)
      : ('down' as const)
    : undefined
/** One-line verdict: did the rule make money once costs are paid? */
function Verdict({
  completed,
  gross,
  net,
}: {
  completed: number
  gross: number | null
  net: number | null
}) {
  if (!completed)
    return (
      <p className="bt-verdict tone-neutral">
        <i aria-hidden="true" />
        No completed trades yet — the rule found nothing to trade.
      </p>
    )
  const won = (net ?? 0) > 0
  const costsAteIt = !won && (gross ?? 0) > 0
  return (
    <p className={`bt-verdict tone-${won ? 'up' : 'down'}`}>
      <i aria-hidden="true" />
      {won
        ? 'Profitable after costs'
        : costsAteIt
          ? 'Made money before costs — costs turned it into a loss'
          : 'Lost money, even before costs'}
    </p>
  )
}

/** Before costs → costs → after costs, on one scale. */
function MoneyFlow({
  gross,
  costs,
  net,
}: {
  gross: number | null
  costs: number | null
  net: number | null
}) {
  const rows = [
    { label: 'Before costs', value: gross ?? 0, kind: 'gross' },
    { label: 'Trading costs', value: -(costs ?? 0), kind: 'cost' },
    { label: 'After costs', value: net ?? 0, kind: 'net' },
  ]
  const scale = Math.max(1, ...rows.map((row) => Math.abs(row.value)))
  return (
    <div className="bt-flow" aria-label="Where the money went">
      <p className="bt-flow-title">Where the money went</p>
      {rows.map((row) => (
        <div className={`bt-flow-row is-${row.kind}`} key={row.kind}>
          <span className="bt-flow-label">{row.label}</span>
          <span className="bt-flow-track">
            <span
              className={`bt-flow-bar ${row.value >= 0 ? 'pos' : 'neg'}`}
              style={{ width: `${(Math.abs(row.value) / scale) * 100}%` }}
            />
          </span>
          <strong className={row.value >= 0 ? 'tone-up' : 'tone-down'}>
            {signedInr(row.value)}
          </strong>
        </div>
      ))}
    </div>
  )
}

export function BacktestPage() {
  const { sessions, building } = useBuildingHistory(BACKTEST_SESSIONS)
  const workspace = useWorkspace()
  const saved =
    workspace?.configuration.kind === 'backtest'
      ? workspace.configuration
      : undefined
  const initial = saved
    ? (Object.fromEntries(
        Object.keys(defaultDraft).map((key) => [
          key,
          saved.query[key as keyof typeof saved.query],
        ]),
      ) as BacktestDraft)
    : { ...defaultDraft }
  const [draft, setDraft] = useState<BacktestDraft>(initial)
  const [applied, setApplied] = useState<BacktestDraft>(initial)
  const [requestBase, setRequestBase] = useState(saved?.query)
  const [preferred, setPreferred] = useState<string | undefined>(
    saved?.expiry.mode === 'explicit' ? saved.expiry.value : undefined,
  )
  const [validation, setValidation] = useState<string>()
  const load = useCallback(
    (signal: AbortSignal) =>
      api.backtest({ ...requestBase, ...draftParameters(applied) }, signal),
    [requestBase, applied],
  )
  const resource = useResource(load)
  const response = resource.response
  const data = response?.data
  const expiry = data
    ? restoredExpiry(
        data.reports.map((r) => r.expiry),
        saved ? (preferred ? selection(preferred) : saved.expiry) : undefined,
        () => selectBacktestExpiry(data.reports, data.data_as_of, preferred),
      )
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
    setRequestBase(undefined)
    setValidation(undefined)
  }
  const edit = <K extends keyof BacktestDraft>(
    key: K,
    value: BacktestDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setValidation(undefined)
  }
  const preset = PRESETS.find(
    (p) => p.z_entry === draft.z_entry && p.z_exit === draft.z_exit,
  )
  const winRate =
    complete?.winRate === null || complete?.winRate === undefined
      ? null
      : complete.winRate * 100
  const wins =
    report?.completed_trades.filter((t) => (t.net_pnl ?? 0) > 0).length ?? 0
  const losses = (report?.completed_trades.length ?? 0) - wins
  const runSimulation = () => {
    const error = validateDraft(draft)
    setValidation(error)
    if (!error) {
      setPreferred(expiry ?? preferred)
      setApplied({ ...draft })
    }
  }
  return (
    <div className="cmp-page backtest-page">
      <PageHeader
        title="Backtest"
        subtitle="Test a simple rule — bet that an unusual gap returns to normal — including trading costs."
        actions={
          <div className="cmp-toolbar">
            <SaveResearch
              selectionLabel={
                report
                  ? `${report.configuration.pair} · ${formatDate(report.expiry)}`
                  : undefined
              }
              currentContext={
                response
                  ? {
                      data_as_of: response.data.data_as_of,
                      source: response.source,
                    }
                  : undefined
              }
              draftChanged={changed}
              candidate={researchCandidate(
                response,
                resource.loading,
                data && report
                  ? backtestConfiguration(data, preferred ? expiry : undefined)
                  : undefined,
              )}
            />
          </div>
        }
      />

      <form
        className="ui-card bt-settings"
        onSubmit={(event) => {
          event.preventDefault()
          runSimulation()
        }}
      >
        <div className="bt-settings-row">
          <label className="ui-field">
            Pair
            <select
              aria-label="Backtest pair"
              value={draft.pair}
              onChange={(e) => edit('pair', e.target.value)}
            >
              {backtestPairs.map((pair) => (
                <option key={pair} value={pair}>
                  {pairLabel(pair)}
                </option>
              ))}
            </select>
          </label>
          <div className="ui-field">
            <span>
              Strategy{' '}
              <InfoTip>
                Enter when the gap is unusual (beyond the entry level in
                standard deviations), exit when it returns near normal. Cautious
                trades less often; Active trades more.
              </InfoTip>
            </span>
            <div className="ui-segmented" role="group" aria-label="Strategy">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  aria-pressed={preset === p}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      z_entry: p.z_entry,
                      z_exit: p.z_exit,
                    }))
                  }
                >
                  {p.label}
                </button>
              ))}
              {!preset && (
                <button type="button" aria-pressed>
                  Custom
                </button>
              )}
            </div>
          </div>
          <div className="bt-run">
            {changed && (
              <span className="ui-muted-note" role="status">
                Settings changed
              </span>
            )}
            <button className="ui-button primary" type="submit">
              {resource.loading ? 'Running…' : 'Run backtest'}
            </button>
          </div>
        </div>
        <p className="ui-muted-note">
          Enters when the gap is beyond ±{num(draft.z_entry)}σ, exits inside ±
          {num(draft.z_exit)}σ or after {draft.max_hold_sessions} sessions ·
          costs {draft.cost_bps_per_leg_per_side} bps per leg per side.
        </p>
        <details className="bt-advanced">
          <summary>Advanced settings</summary>
          <div className="bt-advanced-grid">
            {numericControls.map((control) => (
              <label className="ui-field" key={control.key}>
                {control.label}
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
              </label>
            ))}
            <label className="ui-field">
              Position sizing
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
                <option value="fractional">Fractional (idealized)</option>
                <option value="integer_lots">Whole lots only</option>
              </select>
            </label>
            <label className="ui-toggle">
              <input
                type="checkbox"
                checked={draft.purity}
                onChange={(e) => edit('purity', e.target.checked)}
              />
              Purity adjustment (experimental)
            </label>
          </div>
          <div className="bt-advanced-foot">
            <span className="ui-muted-note">
              Fixed: {cfg?.window ?? 10}-session history · ₹
              {num(cfg?.notional_per_leg)} per leg ·{' '}
              {cfg?.expiry_buffer_calendar_days ?? 3}-day expiry buffer
            </span>
            <button
              className="ui-button ghost"
              type="button"
              onClick={() => {
                setDraft({ ...defaultDraft, pair: draft.pair })
                setValidation(undefined)
              }}
            >
              Reset to defaults
            </button>
          </div>
        </details>
        {validation && (
          <p className="error-notice" role="alert" id="bt-validation">
            {numericControls.reduce(
              (message, control) =>
                message.replaceAll(control.key, control.label),
              validation,
            )}
          </p>
        )}
      </form>

      {saved && data && !report && (
        <p className="error-notice" role="alert">
          The saved expiry is no longer available. Pick another contract to
          continue.
        </p>
      )}
      {resource.error && (
        <div className="error-notice" role="alert">
          <span>
            {resource.errorKind === 'offline-unavailable'
              ? 'This configuration is unavailable offline.'
              : resource.error}
          </span>
          <span className="ui-page-actions">
            {resource.errorKind === 'offline-unavailable' && (
              <button className="button" onClick={restore}>
                Load defaults
              </button>
            )}
            <button className="button" onClick={resource.retry}>
              Retry
            </button>
          </span>
        </div>
      )}

      {building && sessions !== null ? (
        <HistoryGate
          sessions={sessions}
          need={BACKTEST_SESSIONS}
          title="Backtests need a few weeks of history"
        >
          A backtest replays the rule day by day: it needs about{' '}
          {BACKTEST_SESSIONS} trading days so the gap has a usual level and room
          to open and close trades. Import more daily Bhavcopy files to run one
          on real prices.
        </HistoryGate>
      ) : resource.loading && !report ? (
        <div className="ui-stack">
          <Skeleton height={200} />
          <Skeleton height={320} />
        </div>
      ) : data && !report ? (
        <div className="ui-card empty-state lux-empty">
          <Crow size={110} mood="thinking" />
          <p>{data.message ?? 'No results for this configuration.'}</p>
        </div>
      ) : report && metric && complete && data ? (
        <>
          <section
            className={`ui-card cmp-summary ${changed ? 'is-stale' : ''}`}
            aria-label="Backtest result"
          >
            <div className="cmp-summary-head">
              <div>
                <h2>{pairLabel(report.configuration.pair)}</h2>
                <p className="ui-muted-note">
                  Contracts expiring {longDate(report.expiry)} · data to{' '}
                  {longDate(data.data_as_of)}
                </p>
              </div>
              <label className="ui-field bt-expiry">
                Contract
                <select
                  aria-label="Backtest expiry"
                  value={expiry ?? ''}
                  disabled={!data.reports.length}
                  onChange={(e) => setPreferred(e.target.value)}
                >
                  {!expiry && <option value="">—</option>}
                  {data.reports.map((r) => (
                    <option key={r.expiry} value={r.expiry}>
                      {formatDate(r.expiry)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Verdict
              completed={metric.completed_count}
              gross={metric.realized_gross_pnl}
              net={metric.realized_net_pnl}
            />
            <p className="ui-summary-line">
              {metric.completed_count === 0 ? (
                <>No trades completed in this period.</>
              ) : (
                <>
                  {metric.completed_count} completed{' '}
                  {metric.completed_count === 1 ? 'trade' : 'trades'}{' '}
                  {(metric.realized_net_pnl ?? 0) >= 0 ? 'made' : 'lost'}{' '}
                  <strong>{inr(Math.abs(metric.realized_net_pnl ?? 0))}</strong>{' '}
                  after {inr(metric.completed_trade_costs)} in costs.
                </>
              )}
              {metric.open_count > 0 && (
                <>
                  {' '}
                  {metric.open_count} still open, currently{' '}
                  {signedInr(metric.open_marked_net_pnl)}.
                </>
              )}
            </p>
            <div className="cmp-summary-body">
              <div className="ui-grid-2 bt-stat-grid">
                <Stat
                  label="Realized profit"
                  value={signedInr(metric.realized_net_pnl)}
                  tone={toneOf(metric.realized_net_pnl)}
                  hint="closed trades, after costs"
                />
                <Stat
                  label="Including open trades"
                  value={signedInr(metric.total_marked_net_pnl)}
                  tone={toneOf(metric.total_marked_net_pnl)}
                  hint="open trades valued at last price"
                />
                <Stat
                  label="Costs paid"
                  value={inr(metric.completed_trade_costs)}
                  hint={`${metric.completed_count} completed · ${metric.open_count} open`}
                />
                <Stat
                  label="Worst drawdown"
                  value={
                    typeof metric.maximum_drawdown_rupees === 'number'
                      ? inr(metric.maximum_drawdown_rupees)
                      : '—'
                  }
                  hint="largest fall from a peak"
                  info="The biggest drop in cumulative profit from its previous high during the test."
                />
              </div>
              <Donut
                size={168}
                stroke={22}
                data={[
                  {
                    label: 'Profitable',
                    value: wins,
                    color: UP,
                    display: String(wins),
                  },
                  {
                    label: 'Losing',
                    value: losses,
                    color: DOWN,
                    display: String(losses),
                  },
                  {
                    label: 'Still open',
                    value: metric.open_count,
                    color: PALETTE.slate,
                    display: String(metric.open_count),
                  },
                ]}
                center={
                  <span>
                    <strong>
                      {winRate === null ? '—' : `${Math.round(winRate)}%`}
                    </strong>
                    <small>win rate</small>
                  </span>
                }
              />
            </div>
            {(metric.stale_session_count > 0 ||
              metric.unavailable_session_count > 0) && (
              <p className="ui-muted-note">
                {metric.stale_session_count > 0 &&
                  `${metric.stale_session_count} sessions used an older price for valuation. `}
                {metric.unavailable_session_count > 0 &&
                  `${metric.unavailable_session_count} sessions couldn't be valued.`}
              </p>
            )}
            {metric.completed_count > 0 && (
              <MoneyFlow
                gross={metric.realized_gross_pnl}
                costs={metric.completed_trade_costs}
                net={metric.realized_net_pnl}
              />
            )}
          </section>

          <section className="ui-card" aria-labelledby="bt-equity-title">
            <div className="ui-card-head">
              <h2 id="bt-equity-title">Profit over time</h2>
              <p>Cumulative, before and after costs</p>
            </div>
            {report.equity_curve.length ? (
              <Suspense fallback={<Skeleton height={320} />}>
                <BacktestEquityChart report={report} />
              </Suspense>
            ) : (
              <p className="empty-state">No valuations yet.</p>
            )}
          </section>

          <div className="ui-grid-2 bt-pair">
            <section className="ui-card" aria-labelledby="bt-trades-chart">
              <div className="ui-card-head">
                <h2 id="bt-trades-chart">Each completed trade</h2>
                <p>Net profit after costs</p>
              </div>
              {report.completed_trades.length ? (
                <Suspense fallback={<Skeleton height={280} />}>
                  <TradeBars trades={report.completed_trades} />
                </Suspense>
              ) : (
                <p className="empty-state">No completed trades yet.</p>
              )}
            </section>
            <section className="ui-card" aria-labelledby="bt-cost-title">
              <div className="ui-card-head">
                <h2 id="bt-cost-title">
                  Cost sensitivity{' '}
                  <InfoTip>
                    Re-prices the completed trades at different cost levels.
                    Trade dates and sizes stay the same.
                  </InfoTip>
                </h2>
              </div>
              <p className="ui-muted-note bt-tolerance-line">
                {costToleranceSentence(
                  report.cost_tolerance,
                  report.configuration.cost_bps_per_leg_per_side,
                )}
              </p>
              {report.cost_sensitivity.length ? (
                <Suspense fallback={<Skeleton height={260} />}>
                  <BacktestCostChart report={report} />
                </Suspense>
              ) : (
                <p className="empty-state">
                  Needs at least one completed trade.
                </p>
              )}
            </section>
          </div>

          <Suspense fallback={<Skeleton height={220} />}>
            <BacktestTables report={report} />
          </Suspense>

          <HowItWorks title="How is this simulated?">
            <p>
              Trades are entered and exited at the next session's settlement
              price — an idealized assumption, not a real fill. Each contract
              expiry is tested separately, not as a portfolio.
            </p>
            <p className="bt-api-verdict">{report.verdict}</p>
            {metric.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            <h3>Profit by category</h3>
            <div className="ui-table-scroll">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Gross</th>
                    <th className="num">Costs</th>
                    <th className="num">Net</th>
                    <th className="num">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      [
                        'Completed',
                        metric.realized_gross_pnl,
                        metric.completed_trade_costs,
                        metric.realized_net_pnl,
                        metric.completed_count,
                      ],
                      [
                        'Open (marked)',
                        metric.open_marked_gross_pnl,
                        metric.open_entry_costs,
                        metric.open_marked_net_pnl,
                        metric.open_count,
                      ],
                      [
                        'Expired unresolved',
                        metric.unresolved_marked_gross_pnl,
                        metric.unresolved_entry_costs,
                        metric.unresolved_marked_net_pnl,
                        metric.unresolved_count,
                      ],
                    ] as const
                  ).map(([label, gross, cost, net, count]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td className="num">{signedInr(gross)}</td>
                      <td className="num">{inr(cost)}</td>
                      <td className="num">{signedInr(net)}</td>
                      <td className="num">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Reference capital {inr(report.reference_capital)} (both legs'
              notional, not margin). Pending orders:{' '}
              {metric.pending_order_count}.
            </p>
            <h3>Assumptions</h3>
            <ul>
              {[...new Set([...data.assumptions, ...report.assumptions])].map(
                (assumption) => (
                  <li key={assumption}>{assumption}</li>
                ),
              )}
            </ul>
          </HowItWorks>
        </>
      ) : null}
    </div>
  )
}
