import { lazy, Suspense, useCallback, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { selectExpiry } from '@/lib/relativeValue'
import { selectBacktestExpiry } from '@/lib/backtest'
import {
  gapLevel,
  inr,
  longDate,
  pairLabel,
  pairParts,
  signedInr,
  signedPct,
} from '@/lib/insight'
import { pairInsights } from '@/lib/insights'
import { useSessionCount } from '@/lib/history'
import InsightList from '@/components/InsightList'
import { GapChip, Skeleton, Stat } from '@/components/ui'
import Crow from '@/components/Crow'
import '@/styles/report.css'

const SpreadCharts = lazy(() => import('@/components/SpreadCharts'))
const WINDOW = 10
const BACKTEST_SESSIONS = 20
const DEFAULT_PAIR = 'GOLDTEN-GOLDPETAL'

/** A printable, shareable research note for one pair. */
export function ReportPage() {
  const [params] = useSearchParams()
  const pair = params.get('pair') || DEFAULT_PAIR
  const preferred = params.get('expiry') || undefined
  const sessions = useSessionCount()
  const [copied, setCopied] = useState(false)
  const [preparing, setPreparing] = useState(false)

  /** Lay the sheet out at A4 width so charts redraw to fit, then print. */
  const downloadPdf = () => {
    setPreparing(true)
    document.documentElement.classList.add('report-printing')
    const done = () => {
      document.documentElement.classList.remove('report-printing')
      setPreparing(false)
      window.removeEventListener('afterprint', done)
    }
    window.addEventListener('afterprint', done)
    // Charts re-measure on resize and redraw; give them time to settle.
    window.setTimeout(() => {
      window.print()
      // Some browsers never fire afterprint; tidy up regardless.
      window.setTimeout(done, 500)
    }, 1400)
  }

  const spreads = useResource(
    useCallback(
      (signal: AbortSignal) =>
        api.spreads(
          { pair, window: WINDOW, carry_adjusted: true, purity: false },
          signal,
        ),
      [pair],
    ),
  )
  const canBacktest = sessions !== null && sessions >= BACKTEST_SESSIONS
  const backtest = useResource(
    useCallback(
      async (signal: AbortSignal) =>
        canBacktest
          ? api.backtest({ pair, z_entry: 1.5, z_exit: 0.25 }, signal)
          : { data: null, source: 'API' as const },
      [pair, canBacktest],
    ),
  )

  const data = spreads.response?.data
  const expiry = data
    ? selectExpiry(data.series, data.data_as_of, preferred)
    : undefined
  const series = data?.series.find((s) => s.expiry_a === expiry)
  const latest = series?.latest
  const span = Math.max(1, Math.min(WINDOW, (sessions ?? WINDOW + 1) - 1))
  const [a, b] = pairParts(pair)
  const level = gapLevel(latest?.z)
  const insights =
    latest && series
      ? pairInsights({ pair, latest, rows: series.rows, span, sessions })
      : []
  const btData = backtest.response?.data
  const btExpiry = btData
    ? selectBacktestExpiry(btData.reports, btData.data_as_of, expiry)
    : undefined
  const btReport = btData?.reports.find((r) => r.expiry === btExpiry)
  const generated = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const share = async () => {
    const url = window.location.href
    const title = `Auraxis research note: ${pairLabel(pair)}`
    if (navigator.share) {
      try {
        await navigator.share({ title, url })
        return
      } catch {
        /* cancelled — fall back to copying */
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="report-page">
      <div className="report-actions" role="toolbar" aria-label="Report">
        <Link className="ui-button" to="/app/relative-value">
          ← Back to Compare
        </Link>
        <span className="report-actions-spacer" />
        <button type="button" className="ui-button" onClick={share}>
          {copied ? 'Link copied' : 'Copy link'}
        </button>
        <button
          type="button"
          className="ui-button primary"
          onClick={downloadPdf}
          disabled={!latest || preparing}
        >
          {preparing ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>

      <article className="report-sheet ui-card">
        <header className="report-head">
          <div>
            <p className="kicker">Auraxis research note</p>
            <h1>{pairLabel(pair)}</h1>
            <p className="report-meta">
              {expiry ? `Contracts expiring ${longDate(expiry)} · ` : ''}
              {data?.data_as_of
                ? `data to ${longDate(data.data_as_of)} · `
                : ''}
              generated {generated}
            </p>
          </div>
          <Crow
            size={92}
            mood="inspecting"
            animated={false}
            className="report-crow"
          />
        </header>

        {spreads.loading && !data ? (
          <Skeleton height={320} />
        ) : spreads.error && !data ? (
          <p className="error-notice" role="alert">
            {spreads.error}
          </p>
        ) : !latest || !series ? (
          <p className="ui-muted-note">
            No data for this pair yet. Import MCX files first.
          </p>
        ) : (
          <>
            <section className="report-summary">
              <p className="report-lede">
                {a} is <strong>{inr(Math.abs(latest.spread_abs ?? 0))}</strong>{' '}
                {(latest.spread_abs ?? 0) >= 0 ? 'more expensive' : 'cheaper'}{' '}
                than {b} per 10 g{level.phrase ? ` — ${level.phrase}.` : '.'}
              </p>
              {typeof latest.z === 'number' && <GapChip z={latest.z} />}
            </section>

            <section className="report-figures">
              <Stat label={a} value={inr(latest.a_p10_999)} hint="per 10 g" />
              <Stat label={b} value={inr(latest.b_p10_999)} hint="per 10 g" />
              <Stat
                label="Gap"
                value={signedInr(latest.spread_abs)}
                hint={`${signedPct(latest.spread_pct)} of price`}
              />
              <Stat
                label="vs usual"
                value={
                  typeof latest.z === 'number'
                    ? `${latest.z > 0 ? '+' : '−'}${Math.abs(latest.z).toFixed(2)}σ`
                    : '—'
                }
                hint={
                  typeof latest.z === 'number'
                    ? `vs last ${span} sessions`
                    : 'needs 6 trading days'
                }
              />
            </section>

            <section className="report-block">
              <h2>What the numbers say</h2>
              <InsightList items={insights} />
            </section>

            <section className="report-block report-chart">
              <Suspense fallback={<Skeleton height={300} />}>
                <SpreadCharts series={series} />
              </Suspense>
            </section>

            <section className="report-block">
              <h2>Would trading it have worked?</h2>
              {!canBacktest ? (
                <p className="ui-muted-note">
                  A backtest needs about {BACKTEST_SESSIONS} trading days
                  {sessions !== null ? `; ${sessions} are loaded so far` : ''}.
                  It will appear here automatically once enough history is
                  imported.
                </p>
              ) : backtest.loading && !btReport ? (
                <Skeleton height={90} />
              ) : btReport ? (
                <div className="report-figures">
                  <Stat
                    label="Completed trades"
                    value={String(btReport.metrics.completed_count)}
                    hint="Balanced rule: enter beyond ±1.5σ"
                  />
                  <Stat
                    label="Profit after costs"
                    value={signedInr(btReport.metrics.realized_net_pnl)}
                    tone={
                      (btReport.metrics.realized_net_pnl ?? 0) >= 0
                        ? 'up'
                        : 'down'
                    }
                    hint="closed trades"
                  />
                  <Stat
                    label="Costs paid"
                    value={inr(btReport.metrics.completed_trade_costs)}
                    hint="5 bps per leg per side"
                  />
                  <Stat
                    label="Win rate"
                    value={
                      typeof btReport.metrics.win_rate === 'number' &&
                      btReport.metrics.completed_count > 0
                        ? `${Math.round(btReport.metrics.win_rate * 100)}%`
                        : '—'
                    }
                    hint="of completed trades"
                  />
                </div>
              ) : (
                <p className="ui-muted-note">
                  No backtest result for this contract.
                </p>
              )}
            </section>

            <section className="report-block report-notes">
              <h2>How to read this</h2>
              <ul>
                <li>
                  Prices are MCX end-of-day settlement prices, converted to ₹
                  per 10 g of 999 gold so different contract sizes can be
                  compared.
                </li>
                <li>
                  “vs usual” compares today’s gap with the previous {span}{' '}
                  sessions of the same contracts, in standard deviations (σ).
                  Beyond ±2σ is unusual.
                </li>
                <li>
                  GOLDPETAL is quoted ex-Mumbai and the others ex-Ahmedabad;
                  conversion does not remove location or delivery differences.
                </li>
                <li>
                  Settlement prices are not prices you could necessarily trade
                  at. A gap alone is not an arbitrage.
                </li>
              </ul>
            </section>
          </>
        )}

        <footer className="report-foot">
          <span>Auraxis · source: MCX Bhavcopy</span>
          <span>Historical research, not investment advice.</span>
        </footer>
      </article>
    </div>
  )
}
