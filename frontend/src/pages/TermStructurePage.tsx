import DataContext from '@/components/DataContext'
import { lazy, Suspense, useCallback, useState } from 'react'
import { api } from '@/lib/api'
import DiagnosticLabel from '@/components/DiagnosticLabel'
import CrowLoader from '@/components/CrowLoader'
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
import { currency, formatDate, number } from '@/lib/format'
import type {
  CurveResponse,
  RolldownResponse,
  SourcedResponse,
} from '@/lib/types'
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
const value = (v: number | null | undefined, money = false) =>
  typeof v === 'number' && Number.isFinite(v)
    ? (money ? currency : number).format(v)
    : 'Unavailable'
function ResourceCaption({
  response,
  kind,
}: {
  response: SourcedResponse<CurveResponse | RolldownResponse>
  kind: 'Curve' | 'Roll-down'
}) {
  const d = response.data
  return (
    <div className="ts-resource-caption">
      <DataContext
        date={
          kind === 'Curve' && 'selected_date' in d
            ? d.selected_date
            : d.data_as_of
        }
        source={response.source}
        experimental={d.configuration.use_purity_adjustment}
      />
      <details>
        <summary>Applied settings</summary>
        <p>
          Product: {d.configuration.product}. Purity adjustment:{' '}
          {d.configuration.use_purity_adjustment ? 'Experimental' : 'Off'}.
        </p>
        <p>
          {kind === 'Curve' && 'date' in d.configuration
            ? `Curve date: ${d.configuration.date ?? 'Latest available'}.`
            : `History: ${formatDate(d.data_window.first_trade_date)} to ${formatDate(d.data_window.last_trade_date)}.`}
        </p>
        <p>Dataset through {formatDate(d.data_as_of)}.</p>
        {'expiry' in d.configuration && (
          <p>
            Expiry filter: {d.configuration.expiry ?? 'All expiries'}; dates:{' '}
            {d.configuration.start ?? 'Start of data'} to{' '}
            {d.configuration.end ?? 'End of data'}.
          </p>
        )}
        <p>
          {kind === 'Curve'
            ? 'Changing the curve date does not change the roll-down history.'
            : 'Each expiry is analysed separately.'}
        </p>
      </details>
    </div>
  )
}
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
  return (
    <div className="overview-page term-structure-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">EXPIRY CURVES & FIXED-CONTRACT CHANGES</p>
          <h1>Term Structure</h1>
        </div>
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
      {saved && c && r && (!point || !series) && (
        <p className="error-notice" role="alert">
          Saved date or expiry is unavailable. No other contract has been
          substituted. Choose a new selection explicitly.
        </p>
      )}
      <section
        className="panel rv-controls ts-controls"
        aria-label="Term structure controls"
      >
        <label>
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
        <label>
          Curve date
          <select
            aria-label="Curve date"
            value={date}
            onChange={(e) => {
              setPreferredPoint(pointExpiry ?? preferredPoint)
              setDate(e.target.value)
            }}
          >
            <option value="">
              Latest available
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
        <label className="rv-toggle">
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
      </section>
      <section className="panel ts-curve-section" aria-label="Expiry curve">
        <div className="section-heading">
          <h2>Expiry-price curve</h2>
        </div>
        {curve.loading && (
          <div>
            <CrowLoader label="Loading curve…" />
          </div>
        )}
        {curve.error && (
          <div className="error-notice" role="alert">
            <p>
              {historicalUnavailable
                ? 'This historical curve is unavailable offline.'
                : curve.error}
            </p>
            {historicalUnavailable && (
              <button className="button" onClick={() => setDate('')}>
                Show latest saved curve.
              </button>
            )}
            <button className="button" onClick={curve.retry}>
              Retry curve
            </button>
          </div>
        )}
        {curve.response && c && (
          <>
            <ResourceCaption response={curve.response} kind="Curve" />
            {points.length ? (
              <>
                <details className="chart-details">
                  <summary>Chart details</summary>
                  <p>
                    Expiries use their actual calendar-day spacing. Hollow
                    markers show untraded settlements; missing/untraded
                    observations break the traded line.
                  </p>
                </details>
                <Suspense
                  fallback={<div role="status">Loading curve chart...</div>}
                >
                  <ExpiryCurveChart points={points} unit={c.units.prices} />
                </Suspense>
                <div className="ts-contract-heading">
                  <h3>Selected contract</h3>
                  <label>
                    Curve contract
                    <select
                      aria-label="Curve contract"
                      value={pointExpiry ?? ''}
                      onChange={(e) => setPreferredPoint(e.target.value)}
                    >
                      {!pointExpiry && <option value="">Unavailable</option>}
                      {points.map((p) => (
                        <option key={p.expiry_date} value={p.expiry_date}>
                          {formatDate(p.expiry_date)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {point && (
                  <div className="ts-selected-contract">
                    <p>
                      <strong>
                        {point.product} - {formatDate(point.expiry_date)}
                      </strong>
                      . Curve observation {formatDate(point.trade_date)};{' '}
                      {point.days_to_expiry} calendar days to expiry.
                    </p>
                    <div className="rv-readings">
                      {[
                        [
                          'Raw normalized price',
                          point.close_p10_raw,
                          c.units.prices,
                          true,
                        ],
                        [
                          'Applied normalized price',
                          point.close_p10_999,
                          c.units.prices,
                          true,
                        ],
                        [
                          'Volume',
                          point.volume_grams,
                          c.units.liquidity,
                          false,
                        ],
                        [
                          'Open interest',
                          point.open_interest_grams,
                          c.units.liquidity,
                          false,
                        ],
                      ].map(([label, v, unit, money]) => (
                        <div className="rv-reading" key={String(label)}>
                          <span>{String(label)}</span>
                          <strong>
                            {value(v as number | null, Boolean(money))}
                          </strong>
                          <small>{String(unit)}</small>
                        </div>
                      ))}
                    </div>
                    {(!point.has_trade || point.quality_reason) && (
                      <p className="quality-notice">
                        {!point.has_trade && 'No recorded trade. '}
                        {point.quality_reason && (
                          <DiagnosticLabel code={point.quality_reason} />
                        )}
                      </p>
                    )}
                  </div>
                )}
                <details className="ts-curve-table" open>
                  <summary>All curve contracts ({points.length})</summary>
                  <p className="mobile-scroll-hint">
                    Scroll horizontally for prices, liquidity and quality
                    reasons.
                  </p>
                  <div
                    className="table-scroll ts-table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="All curve contracts"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>Observation</th>
                          <th>Expiry</th>
                          <th>Days</th>
                          <th>Raw normalized</th>
                          <th>Applied normalized</th>
                          <th>Volume (g)</th>
                          <th>Open interest (g)</th>
                          <th>Trade activity</th>
                          <th>Quality reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {points.map((p) => (
                          <tr key={p.expiry_date}>
                            <td>{formatDate(p.trade_date)}</td>
                            <td>{formatDate(p.expiry_date)}</td>
                            <td>{p.days_to_expiry}</td>
                            <td>{value(p.close_p10_raw, true)}</td>
                            <td>{value(p.close_p10_999, true)}</td>
                            <td>{value(p.volume_grams)}</td>
                            <td>{value(p.open_interest_grams)}</td>
                            <td>{p.has_trade ? 'Passed' : 'Failed'}</td>
                            <td className="rv-reasons">
                              {p.quality_reason ? (
                                <DiagnosticLabel code={p.quality_reason} />
                              ) : (
                                'No reason provided'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            ) : (
              <div className="empty-state">
                {c.message ??
                  'No curve contracts available for this product and date.'}
              </div>
            )}
          </>
        )}
      </section>
      <section
        className="panel ts-roll-section"
        aria-label="Roll-down decomposition"
      >
        <div className="section-heading">
          <h2>Roll-down decomposition</h2>
        </div>
        <p className="section-description">
          Rs per 10 g · approximate model, not a realized return.
        </p>
        <label className="ts-expiry-control">
          Roll-down contract
          <select
            aria-label="Roll-down contract"
            value={rollExpiry ?? ''}
            disabled={!r?.series.length}
            onChange={(e) => setPreferredRoll(e.target.value)}
          >
            {!rollExpiry && <option value="">Unavailable</option>}
            {r?.series.map((s) => (
              <option key={s.expiry_date} value={s.expiry_date}>
                {formatDate(s.expiry_date)}
              </option>
            ))}
          </select>
        </label>
        {roll.loading && (
          <div>
            <CrowLoader label="Loading roll-down history…" />
          </div>
        )}
        {roll.error && (
          <div className="error-notice" role="alert">
            <p>{roll.error}</p>
            <button className="button" onClick={roll.retry}>
              Retry roll-down
            </button>
          </div>
        )}
        {roll.response && r && (
          <>
            <ResourceCaption response={roll.response} kind="Roll-down" />
            {series && latest ? (
              <>
                <Suspense
                  fallback={
                    <div role="status">Loading decomposition chart...</div>
                  }
                >
                  <RolldownChart series={series} unit={r.units.changes} />
                </Suspense>
                <div className="ts-latest">
                  <h3>
                    Latest returned observation -{' '}
                    {formatDate(latest.trade_date)}
                  </h3>
                  {!latest.decomposition_valid && (
                    <p className="ts-warning">
                      <strong>
                        Decomposition unavailable:{' '}
                        {latest.reason ? (
                          <DiagnosticLabel code={latest.reason} />
                        ) : (
                          'No reason provided'
                        )}
                      </strong>
                      . This is the latest row; an older valid result has not
                      been substituted.
                    </p>
                  )}
                  <div className="rv-readings ts-change-readings">
                    {[
                      ['Raw change', latest.raw_change],
                      [
                        'Estimated roll-down',
                        latest.decomposition_valid
                          ? latest.estimated_roll_down
                          : null,
                      ],
                      [
                        'Residual change',
                        latest.decomposition_valid
                          ? latest.residual_change
                          : null,
                      ],
                    ].map(([label, v]) => (
                      <div className="rv-reading" key={String(label)}>
                        <span>{String(label)}</span>
                        <strong>{value(v as number | null, true)}</strong>
                        <small>{r.units.changes}</small>
                      </div>
                    ))}
                  </div>
                  {check && (
                    <details>
                      <summary>Reconciliation details</summary>
                      <p>
                        Raw change = estimated roll-down + residual change:{' '}
                        {value(latest.raw_change, true)} ={' '}
                        {value(latest.estimated_roll_down, true)} +{' '}
                        {value(latest.residual_change, true)}. Full-precision
                        reconciliation:{' '}
                        <strong>
                          {check.reconciles ? 'Pass' : 'Mismatch'}
                        </strong>{' '}
                        (display values rounded).
                      </p>
                    </details>
                  )}
                </div>
                {counts && (
                  <details className="ts-diagnostics">
                    <summary>
                      Quality diagnostics · {counts.invalid} invalid
                      observations
                    </summary>

                    <p>
                      Selected expiry {formatDate(series.expiry_date)}:{' '}
                      <strong>
                        {counts.total} observations; {counts.valid} valid;{' '}
                        {counts.invalid} invalid.
                      </strong>
                    </p>
                    <p>
                      Returned reasons:{' '}
                      {Object.entries(counts.reasons)
                        .map(([reason, count]) => `${reason}: ${count}`)
                        .join(' | ') || 'No reason provided'}
                    </p>
                    <p className="section-description">
                      API-wide across all expiries: {r.valid_count} valid;{' '}
                      {r.invalid_count} invalid. These are separate from the
                      selected-expiry counts.
                    </p>
                  </details>
                )}
                {counts && counts.invalid > 0 && (
                  <p className="quality-notice">
                    {counts.invalid} observations have an unavailable
                    decomposition. See quality diagnostics for reasons.
                  </p>
                )}
                <p className="mobile-scroll-hint">
                  Scroll horizontally for decomposition values, validity and
                  diagnostic reasons.
                </p>
                <div
                  className="table-scroll ts-table-scroll ts-roll-table"
                  tabIndex={0}
                  role="region"
                  aria-label="Selected-expiry decomposition details"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Observation</th>
                        <th>Previous date</th>
                        <th>Expiry</th>
                        <th>Next expiry</th>
                        <th>Elapsed days</th>
                        <th>Raw change</th>
                        <th>Estimated roll-down</th>
                        <th>Residual change</th>
                        <th>Decomposition check</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.rows.map((row) => (
                        <tr key={row.trade_date}>
                          <td>{formatDate(row.trade_date)}</td>
                          <td>{formatDate(row.previous_trade_date)}</td>
                          <td>{formatDate(row.expiry_date)}</td>
                          <td>{formatDate(row.next_expiry_used)}</td>
                          <td>{row.elapsed_days}</td>
                          <td>{value(row.raw_change, true)}</td>
                          <td>
                            {value(
                              row.decomposition_valid
                                ? row.estimated_roll_down
                                : null,
                              true,
                            )}
                          </td>
                          <td>
                            {value(
                              row.decomposition_valid
                                ? row.residual_change
                                : null,
                              true,
                            )}
                          </td>
                          <td>
                            {row.decomposition_valid ? 'Passed' : 'Failed'}
                          </td>
                          <td className="rv-reasons">
                            {row.reason ? (
                              <DiagnosticLabel code={row.reason} />
                            ) : (
                              'No reason provided'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="empty-state">
                {r.message ??
                  'No roll-down observations available for this product or expiry.'}
              </div>
            )}
          </>
        )}
      </section>
      <section className="panel ts-method">
        <details>
          <summary>How roll-down is estimated</summary>
          <ol>
            <li>
              At the previous observation, estimate slope using this contract
              and the immediate next expiry.
            </li>
            <li>
              Multiply that slope by elapsed calendar days, with a negative
              sign.
            </li>
            <li>
              Subtract estimated roll-down from the same contract's actual
              change.
            </li>
          </ol>
          <details>
            <summary>Technical calculation details</summary>
            <p>
              <code>
                estimated_roll_down = -previous_slope_per_day &times;
                elapsed_calendar_days
              </code>
              <br />
              <code>residual_change = raw_change - estimated_roll_down</code>
            </p>
          </details>
          <p>
            This uses previous-curve inputs only: a local linear, constant-shape
            approximation in time-to-expiry. Weekend gaps use calendar days.
            Missing or untraded required observations invalidate the
            decomposition. Contract prices and interpolated chart lines do not
            establish fills. Purity assumptions remain unverified.
          </p>
          <p>
            Roll-down expiry defaults to the nearest expiry at least three
            calendar days after the historical data date, otherwise the latest
            available. A selected expiry is preserved when available after
            product or purity changes.
          </p>
          <details>
            <summary>Technical assumptions</summary>
            <p>
              Trade activity: <code>has_trade</code>. Decomposition check:{' '}
              <code>decomposition_valid</code> (true = Passed; false = Failed).
            </p>
            {r && <p>{r.explanation}</p>}
            <ul>
              {[
                ...new Set([
                  ...(c?.assumptions ?? []),
                  ...(r?.assumptions ?? []),
                ]),
              ].map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        </details>
      </section>
    </div>
  )
}
