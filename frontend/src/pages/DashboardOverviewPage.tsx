import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Link,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from 'react-router-dom'
import type { DashboardContext } from '@/layouts/AppLayout'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { useDataSource } from '@/lib/useDataSource'
import { useAccount } from '@/lib/useAccount'
import {
  grams,
  longDate,
  pairLabel,
  shortDate,
  signedInr,
  signedPct,
} from '@/lib/insight'
import { GapChip, Skeleton, Sparkline } from '@/components/ui'
import Crow from '@/components/Crow'
import { CountUp } from '@/components/Motion'
import { productColor } from '@/lib/chartTheme'
import { HistoryGate } from '@/components/HistoryGate'
import { FULL_SESSIONS, MIN_SESSIONS, useBuildingHistory } from '@/lib/history'
import type { PairSummary, Reference } from '@/lib/types'
import InsightList from '@/components/InsightList'
import { overviewInsights } from '@/lib/insights'
import { ago, istTime, useLive, useNow } from '@/lib/live'
import type { LiveSnapshot } from '@/lib/live'
import {
  isLiveActive,
  liveMoves,
  livePairs,
  liveReferences,
  withLivePrices,
} from '@/lib/liveView'
import { GapTrend, PairCheck, Seg, Switch } from '@/components/OverviewWidgets'
import type { ChartMetric, ChartRange } from '@/components/ProductChart'
import '@/styles/overview.css'
import '@/styles/welcome.css'
import '@/styles/live.css'
import '@/styles/dashboard.css'

const ProductChart = lazy(() => import('@/components/ProductChart'))
const WINDOW = 10
const PRODUCTS = ['GOLDM', 'GOLDTEN', 'GOLDGUINEA', 'GOLDPETAL']
const RANGES: ChartRange[] = ['1M', '3M', '6M', '1Y', 'All']
const loadOverview = (signal: AbortSignal) => api.overview({}, signal)
const loadPrices = (signal: AbortSignal) => api.prices({}, signal)
const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

async function loadPairs(signal: AbortSignal) {
  const response = await api.spreadsSummary(signal)
  return {
    ...response,
    data: response.data.pairs.filter(
      (item) => typeof item.spread_abs === 'number',
    ),
  }
}

const toneOf = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value !== 0
    ? value > 0
      ? 'up'
      : 'down'
    : 'neutral'

/** "Fri 20 Nov" */
const weekday = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      })
    : ''

function greeting() {
  const hour = new Date().getHours()
  return hour < 12
    ? 'Good morning'
    : hour < 17
      ? 'Good afternoon'
      : 'Good evening'
}

/** "● LIVE · updated 12 s ago" — what the numbers on the page are. */
function SourceBadge({
  snapshot,
  live,
  dataAsOf,
}: {
  snapshot: LiveSnapshot | null
  live: boolean
  dataAsOf?: string | null
}) {
  const now = useNow()
  if (live && snapshot) {
    const trading = snapshot.state === 'live'
    const time = istTime(snapshot.updated_at, false)
    return (
      <span className={`ov-source ${trading ? 'is-live' : 'is-closed'}`}>
        <i aria-hidden="true" />
        <b>{trading ? 'Live' : 'Closed'}</b>
        <span>
          {trading
            ? `${weekday(snapshot.trade_date)} · updated ${ago(snapshot.updated_at, now) ?? 'just now'}`
            : `${weekday(snapshot.trade_date)}${time ? ` · last trade ${time} IST` : ''} · settlement pending`}
        </span>
      </span>
    )
  }
  if (!dataAsOf) return null
  return (
    <span className="ov-source is-settled">
      <i aria-hidden="true" />
      <b>Settled</b>
      <span>
        {longDate(dataAsOf)}
        {snapshot?.state === 'closed' && snapshot.market_open
          ? ' · waiting for the first trades'
          : ''}
      </span>
    </span>
  )
}

/** Product picker: the reference's asset dropdown. */
function ProductPicker({
  references,
  value,
  onChange,
}: {
  references: Reference[]
  value: string
  onChange: (product: string) => void
}) {
  const menu = useRef<HTMLDetailsElement>(null)
  const current = references.find((item) => item.product === value)
  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      const element = menu.current
      if (!element?.open) return
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') element.open = false
        return
      }
      if (!element.contains(event.target as Node)) element.open = false
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])
  return (
    <details className="pp" ref={menu}>
      <summary aria-label={`Product: ${value}. Change product`}>
        <span
          className="pp-mark"
          style={{ '--accent': productColor(value) } as React.CSSProperties}
          aria-hidden="true"
        >
          {value.replace(/^GOLD/, '').slice(0, 2) || 'G'}
        </span>
        <span className="pp-name">
          <strong>{value}</strong>
          <small>
            {current?.expiry_date
              ? `Exp ${shortDate(current.expiry_date)}`
              : 'MCX gold'}
          </small>
        </span>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path
            d="m2.5 4.5 3.5 3.5 3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </summary>
      <div className="pp-panel" role="listbox" aria-label="Products">
        {PRODUCTS.map((product) => {
          const item = references.find((r) => r.product === product)
          return (
            <button
              key={product}
              type="button"
              role="option"
              aria-selected={product === value}
              onClick={() => {
                onChange(product)
                if (menu.current) menu.current.open = false
              }}
            >
              <i style={{ background: productColor(product) }} />
              <span>{product}</span>
              <b>
                {typeof item?.close_p10_999 === 'number'
                  ? rupees.format(item.close_p10_999)
                  : '—'}
              </b>
              <small className={`tone-${toneOf(item?.day_change_pct)}`}>
                {signedPct(item?.day_change_pct)}
              </small>
            </button>
          )
        })}
      </div>
    </details>
  )
}

const WELCOME_KEY = 'auraxis.welcome.dismissed'

function GuestWelcome() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) === '1'
    } catch {
      return false
    }
  })
  if (hidden) return null
  return (
    <aside className="db-welcome" aria-label="Welcome">
      <Crow size={30} bar={false} mood="perched" animated={false} />
      <p>
        <b>You're exploring as a guest.</b> Sign up free to save research, set
        alerts and practise with demo money.
      </p>
      <Link
        className="ui-button primary db-welcome-cta"
        to="/login?mode=signup&returnTo=%2Fapp"
      >
        Sign up free
      </Link>
      <button
        type="button"
        className="db-welcome-close"
        aria-label="Dismiss welcome message"
        onClick={() => {
          setHidden(true)
          try {
            localStorage.setItem(WELCOME_KEY, '1')
          } catch {
            /* private mode: hide for this visit only */
          }
        }}
      >
        ×
      </button>
    </aside>
  )
}

function Onboarding({ offline }: { offline: boolean }) {
  return (
    <section className="ov-onboarding ui-card">
      <div className="ov-onboarding-art">
        <Crow size={170} mood="thinking" />
      </div>
      <div className="ov-onboarding-body">
        <p className="kicker">
          {offline ? 'Connection needed' : 'Welcome to Auraxis'}
        </p>
        <h2>
          {offline
            ? 'Start the data server'
            : 'Load market data to begin your research'}
        </h2>
        <p>
          {offline
            ? "The dashboard can't reach the backend. Start it on port 8010, then reload this page."
            : 'Once data is loaded, Auraxis ranks every gold contract pair against its own history and highlights what is unusual.'}
        </p>
        {!offline && (
          <ol className="ov-steps">
            <li>
              <span className="ov-step-num">1</span>
              <div>
                <strong>Import market data</strong>
                <p>Daily MCX Bhavcopy CSVs — no broker account needed.</p>
              </div>
              <Link className="ui-button primary" to="/app/import">
                Import data
              </Link>
            </li>
            <li>
              <span className="ov-step-num">2</span>
              <div>
                <strong>Find the biggest gap</strong>
                <p>Every pair is ranked against its usual level.</p>
              </div>
            </li>
            <li>
              <span className="ov-step-num">3</span>
              <div>
                <strong>Test and save</strong>
                <p>Backtest an idea with costs, then save it.</p>
              </div>
            </li>
          </ol>
        )}
      </div>
    </section>
  )
}

export function DashboardOverviewPage() {
  const { setRelativeValue } = useOutletContext<DashboardContext>()
  const { sessions, building } = useBuildingHistory()
  // Earlier sessions each ranking can use: grows to the full window.
  const span = Math.max(1, Math.min(WINDOW, (sessions ?? WINDOW + 1) - 1))
  const shortHistory =
    !building && sessions !== null && sessions < FULL_SESSIONS
  const navigate = useNavigate()
  const dataSource = useDataSource()
  const { user, checked } = useAccount()
  // Phones: a slim sticky price bar once the stats strip scrolls away.
  const [statsEl, setStatsEl] = useState<HTMLDListElement | null>(null)
  const [statsGone, setStatsGone] = useState(false)
  useEffect(() => {
    const element = statsEl
    if (!element || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([entry]) =>
        setStatsGone(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { rootMargin: '-64px 0px 0px 0px' },
    )
    io.observe(element)
    return () => io.disconnect()
  }, [statsEl])
  const overview = useResource(loadOverview)
  const prices = useResource(loadPrices)
  const pairs = useResource(loadPairs)
  const { snapshot } = useLive()
  const [params, setParams] = useSearchParams()
  const [metric, setMetric] = useState<ChartMetric>('price')
  const [range, setRange] = useState<ChartRange>('6M')
  const [showVolume, setShowVolume] = useState(true)
  const [compare, setCompare] = useState(false)
  const [pairChoice, setPairChoice] = useState<string | null>(null)
  const [trendSpan, setTrendSpan] = useState<'10' | '30'>('30')

  const overviewData = overview.response?.data
  const dataAsOf = overviewData?.data_as_of ?? null

  // Today's live prices lead until that session's settlement is stored.
  const live = isLiveActive(snapshot, dataAsOf)
  const settledPairs = pairs.response?.data ?? []
  const references = live
    ? liveReferences(snapshot)
    : (overviewData?.references ?? [])
  const summaries = live ? livePairs(snapshot, settledPairs) : settledPairs
  const moves: Record<string, number | null> = live
    ? liveMoves(snapshot)
    : Object.fromEntries(
        settledPairs.map((item) => {
          const values = item.history
            .map((point) => point.spread_abs)
            .filter((value): value is number => typeof value === 'number')
          return [
            item.pair,
            values.length >= 2 ? values.at(-1)! - values.at(-2)! : null,
          ]
        }),
      )
  const asOf = live ? snapshot.trade_date : dataAsOf
  const lastTrades: Record<string, string | null> = Object.fromEntries(
    (live ? snapshot.references : []).map((item) => [
      item.product,
      istTime(item.last_trade_at, false),
    ]),
  )

  const requested = params.get('product')
  const product =
    requested && PRODUCTS.includes(requested) ? requested : 'GOLDTEN'
  const setProduct = (value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.set('product', value)
        return next
      },
      { replace: true },
    )
  const reference = references.find((item) => item.product === product)

  const hasData = references.some((r) => r.reference_available)
  const hasRanks = summaries.some((r) => typeof r.z === 'number')
  const ranked = [...summaries].sort((x, y) =>
    hasRanks
      ? Math.abs(y.z ?? 0) - Math.abs(x.z ?? 0)
      : Math.abs(y.spread_abs ?? 0) - Math.abs(x.spread_abs ?? 0),
  )
  const selectedPair =
    summaries.find((row) => row.pair === pairChoice) ?? ranked[0]
  const insights = overviewInsights({
    references,
    pairs: summaries,
    sessions,
    span,
    asOf,
  })
  const unusualCount = summaries.filter((r) => Math.abs(r.z ?? 0) >= 2).length
  const priceData = prices.response?.data
  const chartData =
    priceData && live ? withLivePrices(priceData, snapshot) : priceData
  const volumes = references
    .map((r) => ({ product: r.product, value: r.volume_grams ?? 0 }))
    .filter((item) => item.value > 0)
  const totalVolume = volumes.reduce((sum, item) => sum + item.value, 0)
  const share =
    totalVolume && reference?.volume_grams
      ? (reference.volume_grams / totalVolume) * 100
      : null
  const explore = (row: PairSummary) => {
    setRelativeValue((previous) => ({
      ...previous,
      pair: row.pair,
      preferred: row.expiry,
    }))
    navigate('/app/relative-value')
  }

  const loading = overview.loading && !overviewData && !live
  const empty =
    !loading &&
    !hasData &&
    (dataSource.state === 'empty' ||
      dataSource.state === 'offline' ||
      Boolean(overviewData))
  const when = live ? 'today' : `on ${shortDate(asOf)}`
  const first = user?.name?.trim().split(/\s+/)[0]

  return (
    <div className="ov-page db">
      <header className="db-head">
        <div>
          <p className="kicker">
            {greeting()}
            {first ? `, ${first}` : ''}
          </p>
          <h1>Overview</h1>
        </div>
        <div className="db-head-meta">
          <SourceBadge snapshot={snapshot} live={live} dataAsOf={dataAsOf} />
          {hasData && hasRanks && !building && (
            <button
              type="button"
              className={`db-flag ${unusualCount ? 'is-alert' : ''}`}
              onClick={() =>
                document
                  .getElementById('ov-hero')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            >
              {unusualCount
                ? `${unusualCount} unusual ${unusualCount === 1 ? 'gap' : 'gaps'} ${when}`
                : `Gaps look normal ${when}`}
            </button>
          )}
        </div>
      </header>

      {overview.error && !overviewData && dataSource.state !== 'offline' && (
        <div className="error-notice" role="alert">
          <span>{overview.error}</span>
          <button className="button" onClick={overview.retry}>
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="ui-stack">
          <Skeleton height={76} />
          <Skeleton height={420} />
          <div className="ui-grid-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={260} />
            ))}
          </div>
        </div>
      ) : empty ? (
        <Onboarding offline={dataSource.state === 'offline'} />
      ) : (
        <div className="db-grid">
          {checked && !user && <GuestWelcome />}
          {typeof document !== 'undefined' &&
            createPortal(
              <div
                className={`db-mbar ${statsGone ? 'is-shown' : ''}`}
                aria-hidden="true"
              >
                <strong>{product}</strong>
                <span>
                  {typeof reference?.close_p10_999 === 'number'
                    ? rupees.format(reference.close_p10_999)
                    : '—'}
                </span>
                <small className={`tone-${toneOf(reference?.day_change_pct)}`}>
                  {signedPct(reference?.day_change_pct)}
                </small>
                {live && <i className="db-mbar-live">Live</i>}
              </div>,
              document.body,
            )}
          {building && sessions !== null && (
            <HistoryGate
              compact
              sessions={sessions}
              need={MIN_SESSIONS}
              title={`${sessions} real trading ${sessions === 1 ? 'day' : 'days'} loaded`}
            >
              Prices, volumes and the futures curve are ready now. Gap rankings
              unlock at {MIN_SESSIONS} sessions and are most reliable from{' '}
              {FULL_SESSIONS}.
            </HistoryGate>
          )}
          {shortHistory && sessions !== null && (
            <HistoryGate
              compact
              sessions={sessions}
              need={FULL_SESSIONS}
              title="Gap rankings are live — on a short history"
            >
              Each gap is compared with its previous {span} sessions. Rankings
              settle once {FULL_SESSIONS} trading days are loaded; the backtest
              needs about 20.
            </HistoryGate>
          )}

          {/* Asset row: picker + stats strip */}
          <section className="db-asset ov-products" aria-label="Product">
            <ProductPicker
              references={references}
              value={product}
              onChange={setProduct}
            />
            <dl className="db-stats ui-card" ref={setStatsEl}>
              <div>
                <dt>Price / 10 g</dt>
                <dd className="db-stat-strong">
                  {typeof reference?.close_p10_999 === 'number' ? (
                    <CountUp
                      value={reference.close_p10_999}
                      format={(v) => rupees.format(v)}
                    />
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt>
                  {reference?.previous_comparison_date
                    ? `Change since ${shortDate(reference.previous_comparison_date)}${live ? ' close' : ''}`
                    : 'Change'}
                </dt>
                <dd className={`tone-${toneOf(reference?.day_change_pct)}`}>
                  {signedPct(reference?.day_change_pct)}{' '}
                  <small>({signedInr(reference?.day_change_abs)})</small>
                </dd>
              </div>
              <div>
                <dt>Volume {live ? 'today' : ''}</dt>
                <dd>{grams(reference?.volume_grams)}</dd>
              </div>
              <div>
                <dt>Open interest</dt>
                <dd>{grams(reference?.open_interest_grams)}</dd>
              </div>
              <div>
                <dt>Volume share</dt>
                <dd className="db-share">
                  {share === null ? '—' : `${share.toFixed(0)}%`}
                  <span aria-hidden="true">
                    <i
                      style={{
                        width: `${Math.max(share ?? 0, 2)}%`,
                        background: productColor(product),
                      }}
                    />
                  </span>
                </dd>
              </div>
              <div>
                <dt>Expiry</dt>
                <dd>
                  {reference?.expiry_date
                    ? `${shortDate(reference.expiry_date)} · ${reference.days_to_expiry ?? '—'}d`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>{live ? 'Last trade' : 'Session'}</dt>
                <dd>
                  {live
                    ? reference?.has_trade && lastTrades[product]
                      ? `${lastTrades[product]} IST`
                      : 'None today'
                    : shortDate(asOf)}
                </dd>
              </div>
            </dl>
          </section>

          {/* Main chart + pair check */}
          <div className="db-main">
            <section
              className="ui-card db-chart"
              aria-label={`${product} chart`}
            >
              <div className="db-toolbar">
                <Seg
                  label="Chart metric"
                  value={metric}
                  onChange={setMetric}
                  options={[
                    { value: 'price', label: 'Price' },
                    { value: 'oi', label: 'Open interest' },
                  ]}
                />
                <div className="db-toolbar-right">
                  <Switch on={showVolume} onChange={setShowVolume}>
                    Volume
                  </Switch>
                  {metric === 'price' && (
                    <Switch on={compare} onChange={setCompare}>
                      All products
                    </Switch>
                  )}
                  <Seg
                    label="Range"
                    value={range}
                    onChange={setRange}
                    options={RANGES}
                  />
                </div>
              </div>
              {chartData ? (
                <Suspense fallback={<Skeleton height={340} />}>
                  <ProductChart
                    product={product}
                    series={chartData.series}
                    metric={metric}
                    range={range}
                    showVolume={showVolume}
                    compare={compare && metric === 'price'}
                  />
                </Suspense>
              ) : (
                <Skeleton height={340} />
              )}
              <div className="db-chart-legend" aria-hidden="true">
                {(compare && metric === 'price' ? PRODUCTS : [product]).map(
                  (name) => (
                    <span key={name}>
                      <i
                        style={{
                          background:
                            compare && metric === 'price'
                              ? productColor(name)
                              : 'var(--text-strong)',
                        }}
                      />
                      {name}
                    </span>
                  ),
                )}
                {showVolume && (
                  <span>
                    <i className="is-bar" />
                    Volume
                  </span>
                )}
                <span className="db-chart-note">
                  {metric === 'price' ? '₹ per 10 g · ' : ''}nearest active
                  contract{live ? ' · last point live' : ''}
                </span>
              </div>
            </section>
            <PairCheck
              pairs={ranked}
              selected={selectedPair}
              onSelect={setPairChoice}
              moves={moves}
              live={live}
              settledOn={dataAsOf}
              span={span}
              hasRanks={hasRanks}
              onExplore={explore}
            />
          </div>

          {/* Comparisons + selected pair's trend */}
          <div className="db-bottom">
            <section className="ui-card" aria-labelledby="pairs-title">
              <div className="ui-card-head">
                <h2 id="pairs-title">All comparisons</h2>
                <p>{live ? 'Live · provisional' : 'Settlement prices'}</p>
              </div>
              {pairs.loading && !summaries.length ? (
                <Skeleton height={260} />
              ) : (
                <div className="ui-table-scroll">
                  <table className="ui-table ov-pairs db-pairs">
                    <thead>
                      <tr>
                        <th>Pair</th>
                        <th className="num">Gap / 10 g</th>
                        <th className="num">
                          {live ? `Since ${shortDate(dataAsOf)}` : 'Day change'}
                        </th>
                        <th>vs usual</th>
                        <th className="hide-sm">Last {WINDOW + 1}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranked.map((row) => (
                        <tr
                          key={row.pair}
                          className={`clickable ${row.pair === selectedPair?.pair ? 'is-selected' : ''}`}
                          tabIndex={0}
                          onClick={() => setPairChoice(row.pair)}
                          onDoubleClick={() => explore(row)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') explore(row)
                            if (event.key === ' ') {
                              event.preventDefault()
                              setPairChoice(row.pair)
                            }
                          }}
                        >
                          <td className="ov-pair-cell">
                            {pairLabel(row.pair)}
                            <span>Exp {shortDate(row.expiry)}</span>
                          </td>
                          <td className="num" data-label="Gap">
                            {signedInr(row.spread_abs)}
                          </td>
                          <td
                            className={`num tone-${toneOf(moves[row.pair])}`}
                            data-label={
                              live ? `Since ${shortDate(dataAsOf)}` : 'Day'
                            }
                          >
                            {signedInr(moves[row.pair])}
                          </td>
                          <td>
                            {hasRanks ? (
                              <GapChip z={row.z} />
                            ) : (
                              <span className="ui-muted-note">
                                After {MIN_SESSIONS} sessions
                              </span>
                            )}
                          </td>
                          <td className="hide-sm">
                            <Sparkline
                              values={row.history
                                .slice(-(WINDOW + 1))
                                .map((point) => point.spread_abs)}
                              width={110}
                              color="var(--c6)"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="db-table-hint">
                Click a row to check it above · double-click or Enter opens it
                in Compare
              </p>
            </section>
            <section className="ui-card db-card" aria-labelledby="gt-title">
              <div className="db-card-head">
                <div>
                  <h2 id="gt-title">
                    {selectedPair ? pairLabel(selectedPair.pair) : 'Gap trend'}
                  </h2>
                  <p>Gap per 10 g · last {trendSpan} sessions</p>
                </div>
                <Seg
                  label="Sessions"
                  value={trendSpan}
                  onChange={setTrendSpan}
                  options={['10', '30']}
                />
              </div>
              <GapTrend
                points={(selectedPair?.history ?? []).slice(-Number(trendSpan))}
              />
            </section>
          </div>

          {/* Plain-English summary */}
          <section
            className="ui-card ov-insights db-insights"
            aria-labelledby="insights-title"
          >
            <div className="ui-card-head">
              <h2 id="insights-title">What stands out</h2>
              <p>{live ? 'From live prices' : `From ${shortDate(asOf)}`}</p>
            </div>
            {insights.length ? (
              <InsightList items={insights} />
            ) : (
              <p className="ui-muted-note">Nothing stands out yet.</p>
            )}
          </section>

          {live && <p className="ov-live-note">{snapshot.note}</p>}
        </div>
      )}
    </div>
  )
}
