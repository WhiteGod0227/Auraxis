import { lazy, Suspense, useCallback, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { selectExpiry, maturityMatchingChange } from '@/lib/relativeValue'
import { formatDate } from '@/lib/format'
import DiagnosticLabel from '@/components/DiagnosticLabel'
import { GapChip, HowItWorks, Skeleton, Stat } from '@/components/ui'
import { Ring, ZGauge } from '@/components/LuxCharts'
import { HistoryGate } from '@/components/HistoryGate'
import { MIN_SESSIONS, useBuildingHistory } from '@/lib/history'
import {
  gapLevel,
  inr,
  longDate,
  num,
  pairLabel,
  pairParts,
  shortDate,
  signedInr,
  signedPct,
} from '@/lib/insight'
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
function rankText(percentile: number | null, window: number) {
  if (typeof percentile !== 'number' || !Number.isFinite(percentile))
    return 'Not enough history yet'
  if (percentile >= 99.5) return `Highest of the last ${window} sessions`
  if (percentile <= 0.5) return `Lowest of the last ${window} sessions`
  return percentile >= 50
    ? `Higher than ${Math.round(percentile)}% of the last ${window} sessions`
    : `Lower than ${Math.round(100 - percentile)}% of the last ${window} sessions`
}
export function RelativeValuePage() {
  const { sessions, building } = useBuildingHistory()
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
  // A link such as ?pair=GOLDGUINEA-GOLDPETAL&expiry=2026-11-30 opens that pair.
  const [search, setSearch] = useSearchParams()
  const linkedPair = saved ? null : search.get('pair')
  const linked = linkedPair
    ? {
        ...relativeValue,
        pair: linkedPair,
        preferred: search.get('expiry') ?? undefined,
      }
    : relativeValue
  const { pair, window, purity, carry, preferred } = restored ?? linked
  const remember = (values: Partial<typeof relativeValue>) => {
    if (saved) {
      setRestored((previous) => ({ ...previous!, ...values }))
      return
    }
    setRelativeValue((previous) => ({
      ...previous,
      ...(linkedPair ? linked : {}),
      ...values,
    }))
    if (linkedPair) setSearch({}, { replace: true })
  }
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
  const [a, b] = pairParts(pair)
  const gap = latest?.spread_abs
  const level = gapLevel(latest?.z)
  return (
    <div className="cmp-page">
      <section className="cmp-toolbar" aria-label="Comparison controls">
        <div className="ui-controls">
          <label className="ui-field">
            Pair
            <select
              aria-label="Pair"
              value={pair}
              onChange={(e) =>
                remember({
                  preferred: selected ?? preferred,
                  pair: e.target.value,
                })
              }
            >
              {pairs.map((p) => (
                <option key={p} value={p}>
                  {pairLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            Contract expiry
            <select
              aria-label="Fixed expiry"
              value={selected ?? ''}
              disabled={!data?.series.length}
              onChange={(e) => remember({ preferred: e.target.value })}
            >
              {!selected && <option value="">—</option>}
              {data?.series.map((s) => (
                <option key={s.expiry_a} value={s.expiry_a}>
                  {formatDate(s.expiry_a)}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            Compare with last
            <select
              aria-label="Window"
              value={window}
              onChange={(e) =>
                remember({
                  preferred: selected ?? preferred,
                  window: Number(e.target.value),
                })
              }
            >
              {Array.from({ length: 26 }, (_, i) => i + 5).map((n) => (
                <option key={n} value={n}>
                  {n} sessions
                </option>
              ))}
            </select>
          </label>
          <details className="cmp-more">
            <summary>More options</summary>
            <div className="cmp-more-panel">
              <label className="ui-toggle">
                <input
                  type="checkbox"
                  checked={purity}
                  onChange={(e) =>
                    remember({
                      preferred: selected ?? preferred,
                      purity: e.target.checked,
                    })
                  }
                />
                Purity adjustment (experimental)
              </label>
              {goldm && (
                <label className="ui-toggle">
                  <input
                    type="checkbox"
                    checked={carry}
                    onChange={(e) =>
                      remember({
                        preferred: selected ?? preferred,
                        carry: e.target.checked,
                      })
                    }
                  />
                  Match maturities
                </label>
              )}
            </div>
          </details>
        </div>
        <SaveResearch
          selectionLabel={
            data && selected
              ? `${data.configuration.pair} · ${formatDate(selected)}`
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
          candidate={researchCandidate(
            response,
            resource.loading,
            data && series
              ? relativeConfiguration(data, preferred ? selected : undefined)
              : undefined,
          )}
        />
        {series && (
          <Link
            className="ui-button cmp-share"
            to={`/app/report?pair=${encodeURIComponent(pair)}&expiry=${series.expiry_a}`}
          >
            Share report
          </Link>
        )}
      </section>

      {saved && data && !series && (
        <p className="error-notice" role="alert">
          The saved expiry is no longer available. Pick another expiry to
          continue.
        </p>
      )}
      {resource.error && (
        <div className="error-notice" role="alert">
          <span>
            {offlineUnavailable
              ? 'This configuration is unavailable offline.'
              : resource.error}
          </span>
          <span className="ui-page-actions">
            {offlineUnavailable && (
              <button
                className="button"
                onClick={() => remember({ window: 10 })}
              >
                Use 10 sessions
              </button>
            )}
            <button className="button" onClick={resource.retry}>
              Retry
            </button>
          </span>
        </div>
      )}

      {resource.loading && !latest ? (
        <div className="ui-stack">
          <Skeleton height={210} />
          <Skeleton height={340} />
        </div>
      ) : latest && series && data ? (
        <>
          <section
            className="ui-card cmp-summary"
            aria-label="Comparison result summary"
          >
            <div className="cmp-summary-head">
              <div>
                <h2>{pairLabel(pair)}</h2>
                <p className="ui-muted-note">
                  Contracts expiring {longDate(series.expiry_a)} · as of{' '}
                  {longDate(latest.trade_date)}
                </p>
              </div>
              {!building && <GapChip z={latest.z} />}
            </div>
            {typeof gap === 'number' && Number.isFinite(gap) && (
              <p className="ui-summary-line">
                {a} is <strong>{inr(Math.abs(gap))}</strong>{' '}
                {gap >= 0 ? 'more expensive' : 'cheaper'} than {b} per 10 g
                {level.phrase ? ` — ${level.phrase}.` : '.'}
              </p>
            )}
            <div className="cmp-summary-body">
              <div className="ui-grid-3">
                <Stat label={a} value={inr(latest.a_p10_999)} hint="per 10 g" />
                <Stat label={b} value={inr(latest.b_p10_999)} hint="per 10 g" />
                <Stat
                  label="Gap"
                  value={signedInr(latest.spread_abs)}
                  hint={`${signedPct(latest.spread_pct)} of price`}
                />
              </div>
              {building ? (
                <div className="ov-hero-unlock">
                  <Ring
                    value={(sessions ?? 0) / MIN_SESSIONS}
                    size={130}
                    stroke={11}
                    color="#5E97D0"
                    center={
                      <span className="history-gate-count">
                        <strong>{sessions ?? 0}</strong>
                        <small>/ {MIN_SESSIONS}</small>
                      </span>
                    }
                  />
                  <p>
                    <strong>Is it unusual?</strong>
                    <span>Unlocks at {MIN_SESSIONS} sessions.</span>
                  </p>
                </div>
              ) : (
                <ZGauge
                  z={latest.z}
                  size={260}
                  caption={rankText(
                    latest.percentile,
                    Math.max(1, Math.min(window, (sessions ?? window + 1) - 1)),
                  )}
                />
              )}
            </div>
            {goldm && (
              <p className="ui-muted-note">
                GOLDM expires on different dates, so the other product is{' '}
                {actualCarry
                  ? 'interpolated to the same maturity'
                  : 'compared without maturity matching'}
                {!comparison.loading && change !== null
                  ? ` (matching changes the gap by ${signedInr(change)})`
                  : ''}
                . For analysis only — not a tradable pair.
              </p>
            )}
            {(latest.reason || latest.liquidity_reason) && (
              <p className="ui-muted-note">
                Note:{' '}
                <DiagnosticLabel
                  code={latest.reason || latest.liquidity_reason}
                />
              </p>
            )}
          </section>
          {building && sessions !== null ? (
            <HistoryGate sessions={sessions} title="Gap over time">
              The chart of this gap against its usual range needs at least{' '}
              {MIN_SESSIONS} trading days. Meanwhile, “Across expiries” works
              with a single day.
            </HistoryGate>
          ) : (
            <Suspense fallback={<Skeleton height={340} />}>
              <SpreadCharts series={series} />
            </Suspense>
          )}
        </>
      ) : data && !series ? (
        <div className="ui-card empty-state">
          {data.message ?? 'No data for this pair and expiry yet.'}
        </div>
      ) : null}

      <HowItWorks>
        <p>
          Each product is converted to ₹ per 10 g from its quoted size
          {config?.use_purity_adjustment
            ? ', then adjusted for purity (experimental)'
            : ''}
          . The gap is {a} minus {b}. “vs usual” compares today with the
          previous {window} sessions of the same contracts. Prices are
          historical settlements, not executable quotes.
          {data && (
            <>
              {' '}
              Data window: {shortDate(data.data_window.first_trade_date)} –{' '}
              {longDate(data.data_window.last_trade_date)}
              {meta.response?.data.trading_session_count
                ? ` (${meta.response.data.trading_session_count} sessions)`
                : ''}
              .
            </>
          )}
        </p>
        <ComparisonExplanation
          resource={resource}
          row={latest}
          counterpart={comparison}
          counterpartRow={other}
        />
        {data && (
          <>
            <h3>Assumptions</h3>
            <ul>
              {data.assumptions.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            {goldm && <p>{data.maturity_definition}</p>}
          </>
        )}
        {series && (
          <details className="cmp-quality">
            <summary>
              Daily data quality ({series.rows.length} sessions)
            </summary>
            <div className="ui-table-scroll">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="num">Gap</th>
                    <th className="num">vs usual</th>
                    <th>Liquidity</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {[...series.rows].reverse().map((row) => (
                    <tr key={row.trade_date}>
                      <td>{longDate(row.trade_date)}</td>
                      <td className="num">{signedInr(row.spread_abs)}</td>
                      <td className="num">{num(row.z)}</td>
                      <td>{row.liquidity_ok ? 'OK' : 'Thin'}</td>
                      <td className="cmp-notes">
                        {[row.reason, row.liquidity_reason]
                          .filter(Boolean)
                          .join(' · ')
                          .replaceAll('_', ' ')}
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
