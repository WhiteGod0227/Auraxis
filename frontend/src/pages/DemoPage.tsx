import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { selectExpiry } from '@/lib/relativeValue'
import { backtestConfiguration, researchCandidate } from '@/lib/workspaces'
import { currency, formatDate, number } from '@/lib/format'
import ComparisonExplanation from '@/components/ComparisonExplanation'
import SaveResearch from '@/components/SaveResearch'
import ContractBasisNote from '@/components/ContractBasisNote'
import SourceBadge from '@/components/SourceBadge'
import CrowLoader from '@/components/CrowLoader'
import '@/styles/demo.css'

const pair = 'GOLDTEN-GOLDPETAL'
const loadSpreads = (signal: AbortSignal) =>
  api.spreads({ pair, purity: false }, signal)
const loadBacktest = (signal: AbortSignal) =>
  api.backtest({ pair, purity: false }, signal)
const noCounterpart = async () => ({ data: null, source: 'API' as const })
const steps = ['Compare', 'Explain', 'Test costs', 'Save research']
const money = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? currency.format(value)
    : 'Unavailable'

export function DemoPage() {
  const [params, setParams] = useSearchParams()
  const requestedStep = Number(params.get('step') ?? 1)
  const step =
    Number.isInteger(requestedStep) && requestedStep >= 1 && requestedStep <= 4
      ? requestedStep
      : 1
  const heading = useRef<HTMLHeadingElement>(null)
  const spreads = useResource(loadSpreads)
  const backtest = useResource(loadBacktest)
  const counterpart = useResource(noCounterpart)
  const data = spreads.response?.data
  const simulation = backtest.response?.data
  const expiries =
    data?.series.filter((s) =>
      simulation?.reports.some((r) => r.expiry === s.expiry_a),
    ) ?? []
  const requestedExpiry = params.get('expiry')
  const expiry =
    requestedExpiry ?? selectExpiry(expiries, data?.data_as_of ?? null)
  const series = data?.series.find((s) => s.expiry_a === expiry)
  const latest = series?.latest
  const report = simulation?.reports.find((r) => r.expiry === expiry)
  const coherent =
    !!spreads.response &&
    !!backtest.response &&
    spreads.response.source === backtest.response.source &&
    data?.data_as_of === simulation?.data_as_of &&
    (spreads.response.source !== 'Offline snapshot' ||
      spreads.response.generatedAt === backtest.response.generatedAt)
  const candidate = researchCandidate(
    backtest.response,
    backtest.loading || !coherent || !series || !report,
    simulation && report
      ? backtestConfiguration(simulation, report.expiry)
      : undefined,
  )
  const loading = spreads.loading || backtest.loading
  useEffect(() => {
    heading.current?.focus()
  }, [step])
  function go(next: number) {
    setParams({ step: String(next), ...(expiry ? { expiry } : {}) })
  }
  return (
    <div className="demo-page">
      <div className="demo-intro">
        <p className="eyebrow">GUIDED RESEARCH / ABOUT 3 MINUTES</p>
        <h1>A price gap is a question. Follow the evidence.</h1>
        <p>
          Compare GOLDTEN and GOLDPETAL on the same expiry, inspect the inputs,
          and see what remains after simulated costs.
        </p>
      </div>
      <nav className="demo-steps" aria-label="Research walkthrough">
        {steps.map((label, index) => (
          <button
            key={label}
            onClick={() => go(index + 1)}
            aria-current={step === index + 1 ? 'step' : undefined}
          >
            <span aria-hidden="true">0{index + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <div className="demo-context panel">
        <div>
          <strong>GOLDTEN / GOLDPETAL</strong>
          <p>
            Quote-size normalized to rupees per 10 g. Purity adjustment off.
          </p>
        </div>
        <label>
          Contract expiry
          <select
            value={expiry ?? ''}
            disabled={loading || !expiries.length}
            onChange={(event) =>
              setParams({ step: String(step), expiry: event.target.value })
            }
          >
            {(!expiry || !expiries.some((s) => s.expiry_a === expiry)) && (
              <option value={expiry ?? ''}>
                {expiry
                  ? `${expiry} (unavailable)`
                  : 'No common expiry available'}
              </option>
            )}
            {expiries.map((s) => (
              <option key={s.expiry_a} value={s.expiry_a}>
                {formatDate(s.expiry_a)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading && (
        <CrowLoader label="Loading the comparison and simulation..." />
      )}
      {spreads.error && (
        <div className="error-notice" role="alert">
          <p>Comparison unavailable: {spreads.error}</p>
          <button className="button" onClick={spreads.retry}>
            Retry comparison
          </button>
        </div>
      )}
      {backtest.error && (
        <div className="error-notice" role="alert">
          <p>Simulation unavailable: {backtest.error}</p>
          <button className="button" onClick={backtest.retry}>
            Retry simulation
          </button>
        </div>
      )}
      {!loading &&
        !spreads.error &&
        !backtest.error &&
        (!series || !report) && (
          <p className="notice" role="status">
            No shared result exists for this expiry. Select an available expiry
            or load permitted data. No sample result has been substituted.
          </p>
        )}
      {!loading && series && report && !coherent && (
        <p className="error-notice" role="alert">
          The comparison and simulation have different source versions or data
          dates. Refresh both before drawing a conclusion or saving.{' '}
          <button
            className="button"
            onClick={() => {
              spreads.retry()
              backtest.retry()
            }}
          >
            Refresh results
          </button>
        </p>
      )}
      <section className="panel demo-stage" aria-labelledby="demo-step-heading">
        <p className="eyebrow">STEP {step} OF 4</p>
        <h2 ref={heading} tabIndex={-1} id="demo-step-heading">
          {
            [
              'What is the observed gap?',
              'Where did that number come from?',
              'Do costs change the result?',
              'Keep the research, including its assumptions.',
            ][step - 1]
          }
        </h2>
        {step <= 2 && spreads.response && (
          <div className="demo-provenance">
            <SourceBadge source={spreads.response.source} />
            <span>
              Historical data as of {formatDate(data?.data_as_of ?? null)}
            </span>
            {spreads.response.generatedAt && (
              <span>Snapshot generated {spreads.response.generatedAt}</span>
            )}
          </div>
        )}
        {step === 1 && (
          <>
            <ContractBasisNote />
            <p>
              One contract quotes a different quantity of gold. Convert both
              quotes to the same 10 g unit before comparing them.
            </p>
            {latest && (
              <>
                <p>
                  Observation: {formatDate(latest.trade_date)}. Expiry:{' '}
                  {formatDate(latest.expiry_a)}.
                </p>
                <dl className="demo-metrics">
                  <div>
                    <dt>GOLDTEN / 10 g</dt>
                    <dd>{money(latest.a_p10_999)}</dd>
                  </div>
                  <div>
                    <dt>GOLDPETAL / 10 g</dt>
                    <dd>{money(latest.b_p10_999)}</dd>
                  </div>
                  <div>
                    <dt>GOLDTEN minus GOLDPETAL</dt>
                    <dd>{money(latest.spread_abs)}</dd>
                  </div>
                </dl>
                <p>
                  {latest.spread_pct === null
                    ? 'Percentage gap unavailable.'
                    : `${number.format(latest.spread_pct)}% of GOLDPETAL.`}{' '}
                  A recorded gap alone does not establish executable arbitrage.
                </p>
                <p className="context-note">
                  Liquidity:{' '}
                  {latest.liquidity_ok
                    ? 'passes the comparison configuration checks'
                    : latest.liquidity_reason || 'unavailable'}
                  . Observation quality:{' '}
                  {latest.reason || 'no reported comparison flag'}. Settlement
                  prices are not executable fills.
                </p>
              </>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <p>
              Open the explanation, then inspect the calculation. Check the
              original quote, quote quantity, normalized value, expiry, and
              observation date.
            </p>
            <ComparisonExplanation
              resource={spreads}
              row={latest}
              counterpart={counterpart}
            />
            <p className="context-note">
              Older snapshots may not include calculation traces. Missing
              evidence stays unavailable. Cross-product economic equivalence
              still requires contract-specification verification.
            </p>
          </>
        )}
        {step >= 3 && backtest.response && (
          <div className="demo-provenance">
            <SourceBadge source={backtest.response.source} />
            <span>
              Historical simulation as of{' '}
              {formatDate(simulation?.data_as_of ?? null)}
            </span>
            {backtest.response.generatedAt && (
              <span>Snapshot generated {backtest.response.generatedAt}</span>
            )}
          </div>
        )}
        {step === 3 && (
          <>
            <p>
              The simulation uses the same pair and expiry. Orders follow
              recorded signals; costs are charged on simulated turnover.
            </p>
            {report && (
              <>
                <p>
                  Applied cost: {report.configuration.cost_bps_per_leg_per_side}{' '}
                  bps per leg, per side. Sizing:{' '}
                  {report.configuration.sizing_mode}. Entry threshold:{' '}
                  {report.configuration.z_entry}; exit threshold:{' '}
                  {report.configuration.z_exit}.
                </p>
                <dl className="demo-metrics">
                  <div>
                    <dt>Gross marked P&amp;L</dt>
                    <dd>{money(report.metrics.total_marked_gross_pnl)}</dd>
                  </div>
                  <div>
                    <dt>Incurred costs</dt>
                    <dd>{money(report.metrics.total_incurred_costs)}</dd>
                  </div>
                  <div>
                    <dt>Net marked P&amp;L</dt>
                    <dd>{money(report.metrics.total_marked_net_pnl)}</dd>
                  </div>
                </dl>
                <p>
                  {report.metrics.completed_count} completed trades;{' '}
                  {report.metrics.open_count} open positions;{' '}
                  {report.metrics.unresolved_count} unresolved positions;{' '}
                  {report.metrics.pending_order_count} pending orders.
                </p>
                <p>
                  Realized net P&amp;L: {money(report.metrics.realized_net_pnl)}
                  . Marked results include unfinished positions and can change.
                </p>
                {report.metrics.total_marked_pnl_reason && (
                  <p className="context-note">
                    Valuation: {report.metrics.total_marked_pnl_reason}
                  </p>
                )}
                {report.metrics.warnings.map((warning, index) => (
                  <p className="context-note" key={index}>
                    {warning}
                  </p>
                ))}
                <details>
                  <summary>Applied simulation assumptions</summary>
                  {report.assumptions.map((assumption, index) => (
                    <p key={index}>{assumption}</p>
                  ))}
                </details>
              </>
            )}
            <Link className="demo-text-link" to="/app/backtest">
              Explore costs and sizing in the full Backtest
            </Link>
          </>
        )}
        {step === 4 && (
          <>
            <p>
              Save the applied backtest settings and add a research note.
              Reopening recalculates with available data; it does not freeze
              numerical results.
            </p>
            <p className="context-note">
              Suggested note: What caused the observed gap? Did turnover costs
              outweigh the marked difference? What data or contract evidence is
              still missing?
            </p>
            <SaveResearch
              candidate={candidate}
              selectionLabel={`${pair}; expiry ${expiry ?? 'unavailable'}; purity off`}
            />
            <Link className="demo-text-link" to="/app/research">
              Open My Research
            </Link>
            <p>
              Private saves require a working backend and your own account.
              Public offline snapshots do not save personal research.
            </p>
          </>
        )}
        <div className="demo-actions">
          <button
            className="button"
            disabled={step === 1}
            onClick={() => go(step - 1)}
          >
            Back
          </button>
          {step < 4 ? (
            <button className="landing-cta" onClick={() => go(step + 1)}>
              Next: {steps[step]} <span aria-hidden="true">&#8594;</span>
            </button>
          ) : (
            <button className="button" onClick={() => go(1)}>
              Restart walkthrough
            </button>
          )}
        </div>
      </section>
      <p className="demo-footnote">
        Historical research, not live trading. A short sample cannot establish
        profitability. <Link to="/app/methodology">Read the methodology</Link>.
      </p>
    </div>
  )
}
