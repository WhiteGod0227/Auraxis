import { lazy, Suspense, useCallback, useState } from 'react'
import { api } from '@/lib/api'
import DiagnosticLabel from '@/components/DiagnosticLabel'
import { useResource } from '@/lib/useResource'
import SaveResearch from '@/components/SaveResearch'
import { useWorkspace } from '@/lib/workspaceContext'
import {
  termConfiguration,
  researchCandidate,
  restoredExpiry,
  selection,
} from '@/lib/workspaces'
import {
  availableCurveDates,
  curveChartRows,
  expiryDiagnostics,
  latestRolldown,
  reconciliation,
  selectContractExpiry,
} from '@/lib/termStructure'
import { formatDate } from '@/lib/format'
import { HowItWorks, Skeleton, Stat } from '@/components/ui'
import {
  grams,
  inr,
  longDate,
  shortDate,
  signedInr,
  signedPct,
} from '@/lib/insight'
const ExpiryCurveChart = lazy(() =>
  import('@/components/TermStructureCharts').then((m) => ({
    default: m.ExpiryCurveChart,
  })),
)
const RolldownChart = lazy(() =>
  import('@/components/TermStructureCharts').then((m) => ({
    default: m.RolldownChart,
  })),
)
const products = ['GOLDM', 'GOLDTEN', 'GOLDGUINEA', 'GOLDPETAL']
export function TermStructurePage() {
  const workspace = useWorkspace()
  const saved =
    workspace?.configuration.kind === 'term_structure'
      ? workspace.configuration
      : undefined
  const [product, setProduct] = useState(saved?.curve.product ?? 'GOLDTEN')
  const [purity, setPurity] = useState(saved?.curve.purity ?? false)
  const [date, setDate] = useState(saved?.curve.date ?? '')
  const [preferredPoint, setPreferredPoint] = useState<string | undefined>(
    saved?.curve_expiry.mode === 'explicit'
      ? saved.curve_expiry.value
      : undefined,
  )
  const [preferredRoll, setPreferredRoll] = useState<string | undefined>(
    saved?.roll_expiry.mode === 'explicit'
      ? saved.roll_expiry.value
      : undefined,
  )
  const loadCurve = useCallback(
    (signal: AbortSignal) =>
      api.curve({ product, purity, date: date || null }, signal),
    [product, purity, date],
  )
  const loadRoll = useCallback(
    (signal: AbortSignal) =>
      api.rolldown({ ...saved?.roll, product, purity }, signal),
    [saved, product, purity],
  )
  const curve = useResource(loadCurve)
  const roll = useResource(loadRoll)
  const c = curve.response?.data
  const r = roll.response?.data
  const dates = availableCurveDates(c, r)
  const points = c ? curveChartRows(c.points) : []
  const pointExpiry = restoredExpiry(
    points.map((p) => p.expiry_date),
    saved
      ? preferredPoint
        ? selection(preferredPoint)
        : saved.curve_expiry
      : undefined,
    () =>
      selectContractExpiry(
        points.map((p) => p.expiry_date),
        c?.selected_date ?? null,
        preferredPoint,
      ),
  )
  const point = points.find((p) => p.expiry_date === pointExpiry)
  const rollExpiry = restoredExpiry(
    r?.series.map((s) => s.expiry_date) ?? [],
    saved
      ? preferredRoll
        ? selection(preferredRoll)
        : saved.roll_expiry
      : undefined,
    () =>
      selectContractExpiry(
        r?.series.map((s) => s.expiry_date) ?? [],
        r?.data_as_of ?? null,
        preferredRoll,
      ),
  )
  const series = r?.series.find((s) => s.expiry_date === rollExpiry)
  const latest = series ? latestRolldown(series) : undefined
  const counts = series ? expiryDiagnostics(series) : undefined
  const check = latest ? reconciliation(latest) : null
  const retainExpiries = () => {
    setPreferredPoint(pointExpiry ?? preferredPoint)
    setPreferredRoll(rollExpiry ?? preferredRoll)
  }
  const historicalUnavailable = Boolean(
    date && curve.errorKind === 'offline-unavailable',
  )
  const traded = points.filter(
    (p) =>
      p.has_trade &&
      typeof p.close_p10_999 === 'number' &&
      Number.isFinite(p.close_p10_999),
  )
  const near = traded[0]
  const far = traded.at(-1)
  const slope =
    near && far && far !== near
      ? (far.close_p10_999! - near.close_p10_999!) /
        Math.max(1, far.days_to_expiry - near.days_to_expiry)
      : null
  const spreadAbs =
    near && far && far !== near
      ? far.close_p10_999! - near.close_p10_999!
      : null
  const spreadPct =
    spreadAbs !== null && near ? (spreadAbs / near.close_p10_999!) * 100 : null
  return (
    <div className="cmp-page term-structure-page">
      <section className="cmp-toolbar" aria-label="Term structure controls">
        <div className="ui-controls">
          <label className="ui-field">
            Product
            <select
              aria-label="Product"
              value={product}
              onChange={(e) => {
                retainExpiries()
                setProduct(e.target.value)
                setDate('')
              }}
            >
              {products.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            Curve as of
            <select
              aria-label="Curve date"
              value={date}
              onChange={(e) => {
                setPreferredPoint(pointExpiry ?? preferredPoint)
                setDate(e.target.value)
              }}
            >
              <option value="">
                Latest
                {!date && c?.selected_date
                  ? ` (${formatDate(c.selected_date)})`
                  : ''}
              </option>
              {dates.map((d) => (
                <option value={d} key={d}>
                  {formatDate(d)}
                </option>
              ))}
              {date && !dates.includes(date) && (
                <option value={date}>{formatDate(date)} (requested)</option>
              )}
            </select>
          </label>
          <details className="cmp-more">
            <summary>More options</summary>
            <div className="cmp-more-panel">
              <label className="ui-toggle">
                <input
                  type="checkbox"
                  checked={purity}
                  onChange={(e) => {
                    retainExpiries()
                    setPurity(e.target.checked)
                  }}
                />
                Purity adjustment (experimental)
              </label>
            </div>
          </details>
        </div>
        <SaveResearch
          selectionLabel={
            c
              ? `${c.configuration.product} · curve expiry ${formatDate(pointExpiry ?? null)} · roll-down ${formatDate(rollExpiry ?? null)}`
              : undefined
          }
          currentContext={
            curve.response
              ? {
                  data_as_of: curve.response.data.data_as_of,
                  source: curve.response.source,
                }
              : undefined
          }
          candidate={researchCandidate(
            curve.response,
            curve.loading || roll.loading,
            c &&
              r &&
              point &&
              series &&
              curve.response?.source === roll.response?.source &&
              c.data_as_of === r.data_as_of
              ? termConfiguration(
                  c,
                  r,
                  preferredPoint ? pointExpiry : undefined,
                  preferredRoll ? rollExpiry : undefined,
                )
              : undefined,
          )}
        />
      </section>

      {saved && c && r && (!point || !series) && (
        <p className="error-notice" role="alert">
          The saved date or contract is no longer available. Choose a new
          selection to continue.
        </p>
      )}
      {curve.error && (
        <div className="error-notice" role="alert">
          <span>
            {historicalUnavailable
              ? 'This historical curve is unavailable offline.'
              : curve.error}
          </span>
          <span className="ui-page-actions">
            {historicalUnavailable && (
              <button className="button" onClick={() => setDate('')}>
                Show latest curve
              </button>
            )}
            <button className="button" onClick={curve.retry}>
              Retry
            </button>
          </span>
        </div>
      )}

      {curve.loading && !c ? (
        <div className="ui-stack">
          <Skeleton height={200} />
          <Skeleton height={320} />
        </div>
      ) : c && points.length ? (
        <section className="ui-card cmp-summary" aria-label="Expiry curve">
          <div className="cmp-summary-head">
            <div>
              <h2>{c.configuration.product} price by expiry</h2>
              <p className="ui-muted-note">
                {points.length} contracts · as of {longDate(c.selected_date)}
              </p>
            </div>
            {spreadAbs !== null && (
              <span
                className={`ui-chip ${spreadAbs >= 0 ? 'tone-normal' : 'tone-high'}`}
              >
                <span className="ui-chip-dot" aria-hidden="true" />
                {spreadAbs >= 0 ? 'Upward curve' : 'Inverted curve'}
              </span>
            )}
          </div>
          {near && far && spreadAbs !== null && (
            <p className="ui-summary-line">
              The {shortDate(far.expiry_date)} contract is{' '}
              <strong>{inr(Math.abs(spreadAbs))}</strong>{' '}
              {spreadAbs >= 0 ? 'above' : 'below'} the{' '}
              {shortDate(near.expiry_date)} contract
              {spreadAbs >= 0
                ? ' — later delivery costs more, as is usual (cost of carry).'
                : ' — later delivery is cheaper, which is unusual for gold.'}
            </p>
          )}
          <div className="ui-grid-4">
            <Stat
              label={`Nearest · ${shortDate(near?.expiry_date)}`}
              value={inr(near?.close_p10_999)}
              hint="per 10 g"
            />
            <Stat
              label={`Farthest traded · ${shortDate(far?.expiry_date)}`}
              value={inr(far?.close_p10_999)}
              hint="per 10 g"
            />
            <Stat
              label="Difference"
              value={signedInr(spreadAbs)}
              hint={`${signedPct(spreadPct)} across the curve`}
            />
            <Stat
              label="Per month"
              value={slope === null ? '—' : signedInr(slope * 30)}
              hint="average step per 30 days"
              info="Average price difference per 30 days between the nearest and farthest traded contracts."
            />
          </div>
          <Suspense fallback={<Skeleton height={300} />}>
            <ExpiryCurveChart points={points} unit={c.units.prices} />
          </Suspense>
          <div className="ui-table-scroll">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Expiry</th>
                  <th className="num">Days left</th>
                  <th className="num">Price per 10 g</th>
                  <th className="num">Volume</th>
                  <th className="num">Open interest</th>
                  <th>Activity</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr
                    key={p.expiry_date}
                    className={`clickable ${p.expiry_date === pointExpiry ? 'selected' : ''}`}
                    tabIndex={0}
                    aria-selected={p.expiry_date === pointExpiry}
                    onClick={() => setPreferredPoint(p.expiry_date)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        setPreferredPoint(p.expiry_date)
                    }}
                  >
                    <td>{longDate(p.expiry_date)}</td>
                    <td className="num">{p.days_to_expiry}</td>
                    <td className="num">{inr(p.close_p10_999)}</td>
                    <td className="num">{grams(p.volume_grams)}</td>
                    <td className="num">{grams(p.open_interest_grams)}</td>
                    <td>
                      {p.has_trade ? (
                        <span className="ui-muted-note">Traded</span>
                      ) : (
                        <span className="cmp-flag">No trades</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : c ? (
        <div className="ui-card empty-state">
          {c.message ?? 'No contracts for this product and date.'}
        </div>
      ) : null}

      <section className="ui-card" aria-label="Roll-down decomposition">
        <div className="ui-card-head">
          <div>
            <h2>What moved the price</h2>
            <p>
              A contract's daily change, split into the expected drift toward
              the nearer contract (roll-down) and everything else.
            </p>
          </div>
          <label className="ui-field">
            Contract
            <select
              aria-label="Roll-down contract"
              value={rollExpiry ?? ''}
              disabled={!r?.series.length}
              onChange={(e) => setPreferredRoll(e.target.value)}
            >
              {!rollExpiry && <option value="">—</option>}
              {r?.series.map((s) => (
                <option key={s.expiry_date} value={s.expiry_date}>
                  {formatDate(s.expiry_date)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {roll.error && (
          <div className="error-notice" role="alert">
            <span>{roll.error}</span>
            <button className="button" onClick={roll.retry}>
              Retry
            </button>
          </div>
        )}
        {roll.loading && !r ? (
          <Skeleton height={300} />
        ) : r && series && latest ? (
          <div className="ui-stack">
            <div className="ui-grid-3">
              <Stat
                label={`Change on ${shortDate(latest.trade_date)}`}
                value={signedInr(latest.raw_change)}
                hint="per 10 g"
              />
              <Stat
                label="From roll-down"
                value={
                  latest.decomposition_valid
                    ? signedInr(latest.estimated_roll_down)
                    : '—'
                }
                hint="expected drift"
                info="Estimated from the previous day's curve slope multiplied by the days elapsed. A model estimate, not a realized return."
              />
              <Stat
                label="Everything else"
                value={
                  latest.decomposition_valid
                    ? signedInr(latest.residual_change)
                    : '—'
                }
                hint="market moves"
              />
            </div>
            {!latest.decomposition_valid && (
              <p className="ui-muted-note">
                The latest split isn't available
                {latest.reason ? (
                  <>
                    {' '}
                    (<DiagnosticLabel code={latest.reason} />)
                  </>
                ) : null}
                .
              </p>
            )}
            <Suspense fallback={<Skeleton height={300} />}>
              <RolldownChart series={series} unit={r.units.changes} />
            </Suspense>
            {counts && counts.invalid > 0 && (
              <p className="ui-muted-note">
                {counts.invalid} of {counts.total} days couldn't be split
                (usually a missing trade on one of the contracts).
              </p>
            )}
          </div>
        ) : r ? (
          <p className="empty-state">
            {r.message ?? 'No history for this contract yet.'}
          </p>
        ) : null}
      </section>

      <HowItWorks title="How is roll-down estimated?">
        <ol>
          <li>
            At the previous session, measure the slope between this contract and
            the next expiry.
          </li>
          <li>Multiply that slope by the calendar days elapsed (negated).</li>
          <li>
            Everything else is the contract's actual change minus that estimate.
          </li>
        </ol>
        {check && latest && (
          <p>
            Check for {shortDate(latest.trade_date)}:{' '}
            {signedInr(latest.raw_change)} ={' '}
            {signedInr(latest.estimated_roll_down)} +{' '}
            {signedInr(latest.residual_change)} —{' '}
            {check.reconciles ? 'reconciles' : 'mismatch'}.
          </p>
        )}
        {r && <p>{r.explanation}</p>}
        <h3>Assumptions</h3>
        <ul>
          {[
            ...new Set([...(c?.assumptions ?? []), ...(r?.assumptions ?? [])]),
          ].map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        {series && (
          <details className="cmp-quality">
            <summary>Daily breakdown ({series.rows.length} days)</summary>
            <div className="ui-table-scroll">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="num">Change</th>
                    <th className="num">Roll-down</th>
                    <th className="num">Everything else</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {[...series.rows].reverse().map((row) => (
                    <tr key={row.trade_date}>
                      <td>{longDate(row.trade_date)}</td>
                      <td className="num">{signedInr(row.raw_change)}</td>
                      <td className="num">
                        {row.decomposition_valid
                          ? signedInr(row.estimated_roll_down)
                          : '—'}
                      </td>
                      <td className="num">
                        {row.decomposition_valid
                          ? signedInr(row.residual_change)
                          : '—'}
                      </td>
                      <td className="cmp-notes">
                        {row.reason ? (
                          <DiagnosticLabel code={row.reason} />
                        ) : (
                          ''
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </HowItWorks>
    </div>
  )
}
