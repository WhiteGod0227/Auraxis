import { lazy, Suspense } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import type { DashboardContext } from '@/layouts/AppLayout'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { useDataSource } from '@/lib/useDataSource'
import { useAccount } from '@/lib/useAccount'
import {
  gapLevel,
  grams,
  inr,
  longDate,
  pairLabel,
  pairParts,
  shortDate,
  signedInr,
  signedPct,
} from '@/lib/insight'
import { GapChip, InfoTip, Skeleton, Sparkline } from '@/components/ui'
import Crow from '@/components/Crow'
import { CountUp } from '@/components/Motion'
import { Donut, Ring, ZGauge } from '@/components/LuxCharts'
import { HIGH, LOW, NORMAL, productColor } from '@/lib/chartTheme'
import { HistoryGate, PriceLadder } from '@/components/HistoryGate'
import { FULL_SESSIONS, MIN_SESSIONS, useBuildingHistory } from '@/lib/history'
import type { PairSummary, Reference } from '@/lib/types'
import InsightList from '@/components/InsightList'
import { overviewInsights } from '@/lib/insights'
import '@/styles/overview.css'
import '@/styles/welcome.css'

const ReferencePriceChart = lazy(
  () => import('@/components/ReferencePriceChart'),
)
const GapBars = lazy(() => import('@/components/GapBars'))
const WINDOW = 10
const loadOverview = (signal: AbortSignal) => api.overview({}, signal)
const loadPrices = (signal: AbortSignal) => api.prices({}, signal)
const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

interface PairReading {
  pair: string
  expiry: string
  latest: PairSummary
  history: (number | null)[]
}

async function loadPairs(signal: AbortSignal) {
  const response = await api.spreadsSummary(signal)
  return {
    ...response,
    data: response.data.pairs
      .filter((item) => typeof item.spread_abs === 'number')
      .map((item) => ({
        pair: item.pair,
        expiry: item.expiry,
        latest: item,
        history: item.history.map((point) => point.spread_abs),
      })),
  }
}

/** `span` = earlier sessions actually compared (≤ WINDOW while history builds). */
function rankText(row: PairSummary, span = WINDOW) {
  const p = row.percentile
  if (typeof p !== 'number' || !Number.isFinite(p)) return null
  if (p >= 99.5) return `Highest of the last ${span} sessions`
  if (p <= 0.5) return `Lowest of the last ${span} sessions`
  return p >= 50
    ? `Higher than ${Math.round(p)}% of the last ${span} sessions`
    : `Lower than ${Math.round(100 - p)}% of the last ${span} sessions`
}

function ProductCard({
  reference,
  history,
  index,
  average,
}: {
  reference: Reference
  history: (number | null)[]
  index: number
  average: number | null
}) {
  const change = reference.day_change_pct
  const hasChange = typeof change === 'number' && Number.isFinite(change)
  const points = history.filter((v) => typeof v === 'number').length
  const price = reference.close_p10_999
  const vsAverage =
    typeof price === 'number' && average !== null ? price - average : null
  const color = productColor(reference.product, index)
  const tone =
    typeof change === 'number' && change !== 0
      ? change > 0
        ? 'up'
        : 'down'
      : 'neutral'
  return (
    <article
      className="ov-product"
      style={{ '--accent': color } as React.CSSProperties}
    >
      <div className="ov-product-top">
        <h3>
          <i style={{ background: color }} aria-hidden="true" />
          {reference.product}
        </h3>
        <span className="ov-product-expiry">
          {reference.expiry_date
            ? `Exp ${shortDate(reference.expiry_date)}`
            : ''}
        </span>
      </div>
      {reference.reference_available ? (
        <>
          <div className="ov-product-price">
            <CountUp
              value={reference.close_p10_999}
              format={(v) => rupees.format(v)}
            />
          </div>
          {hasChange ? (
            <div className={`ov-product-change tone-${tone}`}>
              {signedPct(change)}{' '}
              <span>{signedInr(reference.day_change_abs)}</span>
            </div>
          ) : (
            <div className="ov-product-change tone-neutral">
              {vsAverage === null
                ? 'First session loaded'
                : Math.abs(vsAverage) < 1
                  ? 'At the group average'
                  : `${signedInr(vsAverage)} vs group average`}
            </div>
          )}
          {points >= 2 ? (
            <Sparkline values={history} width={240} height={46} color={color} />
          ) : (
            <div className="ov-product-note">
              Day-on-day change appears after the next session.
            </div>
          )}
          <div className="ov-product-foot">
            <span>Volume</span>
            <strong>{grams(reference.volume_grams)}</strong>
          </div>
        </>
      ) : (
        <p className="ui-muted-note">No recent traded price.</p>
      )}
    </article>
  )
}

function greeting() {
  const hour = new Date().getHours()
  return hour < 12
    ? 'Good morning'
    : hour < 17
      ? 'Good afternoon'
      : 'Good evening'
}

/** Page heading with the crow, whose mood follows what the data shows. */
/** Brings the biggest-gap card into view and briefly highlights it. */
function showHero() {
  const hero = document.getElementById('ov-hero')
  if (!hero) return
  hero.scrollIntoView({ behavior: 'smooth', block: 'center' })
  hero.classList.remove('is-pointed')
  void hero.offsetWidth
  hero.classList.add('is-pointed')
  window.setTimeout(() => hero.classList.remove('is-pointed'), 1600)
}

function Welcome({
  name,
  subtitle,
  mood,
  status,
}: {
  name?: string
  subtitle: string
  mood: 'alert' | 'thinking' | 'sleepy'
  status?: string
}) {
  const first = name?.trim().split(/\s+/)[0]
  return (
    <header className="ov-welcome">
      <div className="ov-welcome-text">
        <p className="kicker">
          {greeting()}
          {first ? `, ${first}` : ''}
        </p>
        <h1>Overview</h1>
        <p>{subtitle}</p>
      </div>
      {mood === 'alert' ? (
        <button
          type="button"
          className="ov-welcome-crow is-clickable"
          onClick={showHero}
          title="Show me the biggest gap"
          aria-label={`${status ?? 'Unusual gaps today'}. Show the biggest gap.`}
        >
          <span className="ov-welcome-glow" />
          <Crow size={150} mood={mood} />
          {status && <span className="ov-welcome-chip">{status} →</span>}
        </button>
      ) : (
        <div className="ov-welcome-crow" aria-hidden="true">
          <span className="ov-welcome-glow" />
          <Crow size={150} mood={mood} />
          {status && <span className="ov-welcome-chip">{status}</span>}
        </div>
      )}
    </header>
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
  const { user } = useAccount()
  const overview = useResource(loadOverview)
  const prices = useResource(loadPrices)
  const pairs = useResource(loadPairs)
  const overviewData = overview.response?.data
  const references = overviewData?.references ?? []
  const hasData = references.some((r) => r.reference_available)
  const readings = pairs.response?.data ?? []
  const ranked = [...readings].sort(
    (x, y) => Math.abs(y.latest.z ?? 0) - Math.abs(x.latest.z ?? 0),
  )
  const hasRanks = readings.some((r) => typeof r.latest.z === 'number')
  const byGap = [...readings].sort(
    (x, y) =>
      Math.abs(y.latest.spread_abs ?? 0) - Math.abs(x.latest.spread_abs ?? 0),
  )
  const top = hasRanks
    ? ranked.find((r) => typeof r.latest.z === 'number')
    : byGap[0]
  const tableRows = hasRanks ? ranked : byGap
  const insights = overviewInsights({
    references,
    pairs: readings.map((r) => r.latest),
    sessions,
    span,
    asOf: overviewData?.data_as_of,
  })
  const unusualCount = readings.filter(
    (r) => Math.abs(r.latest.z ?? 0) >= 2,
  ).length
  const available = references.filter(
    (r) => r.reference_available && typeof r.close_p10_999 === 'number',
  )
  const average = available.length
    ? available.reduce((sum, r) => sum + (r.close_p10_999 as number), 0) /
      available.length
    : null
  const singleDay =
    Boolean(prices.response) &&
    (prices.response?.data.series ?? []).every(
      (s) => s.history.filter((p) => p.has_trade).length < 2,
    )

  const explore = (reading: PairReading) => {
    setRelativeValue((previous) => ({
      ...previous,
      pair: reading.pair,
      preferred: reading.expiry,
    }))
    navigate('/app/relative-value')
  }
  const historyFor = (product: string) =>
    prices.response?.data.series
      .find((s) => s.product === product)
      ?.history.slice(-30)
      .map((point) => (point.has_trade ? point.close_p10_999 : null)) ?? []
  const nextExpiries = (overviewData?.upcoming_expiries ?? [])
    .filter(
      (item, index, all) =>
        all.findIndex(
          (other) =>
            other.product === item.product &&
            other.expiry_date <= item.expiry_date,
        ) === index,
    )
    .sort((x, y) => x.days_to_expiry - y.days_to_expiry)
  const volumes = references
    .map((r, index) => ({
      label: r.product,
      value: r.volume_grams ?? 0,
      color: productColor(r.product, index),
      note: grams(r.volume_grams),
    }))
    .filter((item) => item.value > 0)
  const totalVolume = volumes.reduce((sum, item) => sum + item.value, 0)

  const loading = overview.loading && !overviewData
  const empty =
    !loading &&
    !hasData &&
    (dataSource.state === 'empty' ||
      dataSource.state === 'offline' ||
      Boolean(overviewData))

  return (
    <div className="ov-page">
      <Welcome
        name={user?.name}
        subtitle={
          overviewData?.data_as_of
            ? `Latest session ${longDate(overviewData.data_as_of)} · prices in ₹ per 10 g`
            : 'MCX gold futures on one common price basis'
        }
        mood={
          building || !hasRanks
            ? 'thinking'
            : unusualCount > 0
              ? 'alert'
              : 'sleepy'
        }
        status={
          !hasData
            ? undefined
            : building || !hasRanks
              ? 'Collecting history'
              : unusualCount > 0
                ? `${unusualCount} unusual ${unusualCount === 1 ? 'gap' : 'gaps'} today`
                : 'Gaps look normal today'
        }
      />

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
          <div className="ui-grid-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={200} />
            ))}
          </div>
          <Skeleton height={300} />
        </div>
      ) : empty ? (
        <Onboarding offline={dataSource.state === 'offline'} />
      ) : (
        <div className="ov-layout">
          {building && sessions !== null && (
            <HistoryGate
              compact
              sessions={sessions}
              need={MIN_SESSIONS}
              title={`${sessions} real trading ${sessions === 1 ? 'day' : 'days'} loaded`}
            >
              Prices, volumes and the futures curve are live from MCX now. Gap
              rankings unlock at {MIN_SESSIONS} sessions and are most reliable
              from {FULL_SESSIONS}.
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
          <section aria-label="Products" className="ov-row ov-products">
            {references.map((reference, index) => (
              <ProductCard
                key={reference.product}
                reference={reference}
                history={historyFor(reference.product)}
                index={index}
                average={average}
              />
            ))}
          </section>

          {insights.length > 0 && (
            <section
              className="ui-card ov-insights"
              aria-labelledby="insights-title"
            >
              <div className="ui-card-head">
                <h2 id="insights-title">What stands out</h2>
                <p>Written from today's numbers</p>
              </div>
              <InsightList items={insights} />
            </section>
          )}

          <div className="ov-row ov-split">
            <section
              className="ov-hero ui-card"
              id="ov-hero"
              aria-labelledby="hero-title"
            >
              {top ? (
                <>
                  <div className="ov-hero-main">
                    <p className="kicker" id="hero-title">
                      {hasRanks
                        ? 'Biggest gap vs usual'
                        : 'Biggest price gap today'}
                    </p>
                    <div className="ov-hero-pair">
                      <h2>{pairLabel(top.pair)}</h2>
                      {hasRanks && <GapChip z={top.latest.z} />}
                    </div>
                    <p className="ui-summary-line">
                      {pairParts(top.pair)[0]} is{' '}
                      <strong>
                        {inr(Math.abs(top.latest.spread_abs ?? 0))}
                      </strong>{' '}
                      {(top.latest.spread_abs ?? 0) >= 0
                        ? 'more expensive'
                        : 'cheaper'}{' '}
                      than {pairParts(top.pair)[1]} per 10 g
                      {gapLevel(top.latest.z).phrase
                        ? ` — ${gapLevel(top.latest.z).phrase}.`
                        : '.'}
                    </p>
                    <dl className="ov-hero-figures">
                      <div>
                        <dt>Gap per 10 g</dt>
                        <dd>{signedInr(top.latest.spread_abs)}</dd>
                      </div>
                      <div>
                        <dt>Of price</dt>
                        <dd>{signedPct(top.latest.spread_pct)}</dd>
                      </div>
                      <div>
                        <dt>Contract</dt>
                        <dd>{shortDate(top.expiry)}</dd>
                      </div>
                    </dl>
                    <div className="ov-hero-actions">
                      <button
                        type="button"
                        className="ui-button primary"
                        onClick={() => explore(top)}
                      >
                        Explore this gap →
                      </button>
                      <Link
                        className="ui-button"
                        to={`/app/report?pair=${encodeURIComponent(top.pair)}&expiry=${top.expiry}`}
                      >
                        Share report
                      </Link>
                    </div>
                  </div>
                  {hasRanks ? (
                    <ZGauge
                      z={top.latest.z}
                      size={280}
                      caption={rankText(top.latest, span) ?? undefined}
                    />
                  ) : (
                    <div className="ov-hero-unlock">
                      <Ring
                        value={(sessions ?? 0) / MIN_SESSIONS}
                        size={150}
                        stroke={12}
                        color={LOW}
                        center={
                          <span className="history-gate-count">
                            <strong>{sessions ?? 0}</strong>
                            <small>/ {MIN_SESSIONS}</small>
                          </span>
                        }
                      />
                      <p>
                        <strong>Is it unusual?</strong>
                        <span>
                          The gauge appears once {MIN_SESSIONS} sessions are
                          loaded.
                        </span>
                      </p>
                    </div>
                  )}
                </>
              ) : pairs.loading ? (
                <Skeleton height={220} />
              ) : (
                <p className="ui-muted-note">
                  Not enough history yet to rank price gaps. Import more trading
                  days to unlock this view.
                </p>
              )}
            </section>

            <section className="ui-card" aria-labelledby="share-title">
              <div className="ui-card-head">
                <h2 id="share-title">Volume share</h2>
                <p>Latest session</p>
              </div>
              <Donut
                data={volumes}
                size={160}
                stroke={22}
                center={
                  <span>
                    <strong>{grams(totalVolume)}</strong>
                    <small>traded</small>
                  </span>
                }
              />
            </section>
          </div>

          <div className="ov-row ov-split">
            <section className="ui-card" aria-labelledby="trend-title">
              <div className="ui-card-head">
                <h2 id="trend-title">
                  {singleDay ? 'Price per 10 g today' : 'Price trend'}
                </h2>
                <p>
                  {singleDay
                    ? 'Nearest active contract · close-up scale'
                    : '₹ per 10 g · nearest active contract'}
                </p>
              </div>
              {singleDay ? (
                <>
                  <PriceLadder
                    items={available.map((r) => ({
                      product: r.product,
                      price: r.close_p10_999,
                    }))}
                  />
                  <p className="price-ladder-note">
                    Every product is converted to ₹ per 10 g of 999 gold, so
                    these prices are directly comparable. The spread between the
                    cheapest and dearest is the gap Auraxis tracks. The trend
                    chart appears from the second session.
                  </p>
                </>
              ) : prices.response?.data ? (
                <Suspense fallback={<Skeleton height={320} />}>
                  <ReferencePriceChart response={prices.response.data} />
                </Suspense>
              ) : (
                <Skeleton height={320} />
              )}
            </section>
            <section className="ui-card" aria-labelledby="bars-title">
              <div className="ui-card-head">
                <h2 id="bars-title">
                  {hasRanks ? 'Gap vs usual' : 'Gap today'}{' '}
                  <InfoTip>
                    {hasRanks
                      ? `How far each pair's gap is from its average of the last ${WINDOW} sessions, in standard deviations. Beyond ±2 is unusual. Click a bar to explore.`
                      : 'First product minus second, in ₹ per 10 g on the same 999 purity basis. Click a bar to explore.'}
                  </InfoTip>
                </h2>
              </div>
              <div className="g-legend" aria-hidden="true">
                {hasRanks ? (
                  <>
                    <span>
                      <i style={{ background: LOW }} />
                      Below usual
                    </span>
                    <span>
                      <i style={{ background: NORMAL }} />
                      Normal
                    </span>
                    <span>
                      <i style={{ background: HIGH }} />
                      Above usual
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      <i style={{ background: LOW }} />
                      First is cheaper
                    </span>
                    <span>
                      <i style={{ background: HIGH }} />
                      First is dearer
                    </span>
                  </>
                )}
              </div>
              {readings.length ? (
                <Suspense fallback={<Skeleton height={280} />}>
                  <GapBars
                    mode={hasRanks ? 'z' : 'gap'}
                    items={ranked.map((r) => ({
                      pair: r.pair,
                      z: r.latest.z,
                      gap: r.latest.spread_abs,
                    }))}
                    onSelect={(pair) => {
                      const reading = readings.find((r) => r.pair === pair)
                      if (reading) explore(reading)
                    }}
                  />
                </Suspense>
              ) : (
                <Skeleton height={280} />
              )}
            </section>
          </div>

          <div className="ov-row ov-split">
            <section className="ui-card" aria-labelledby="pairs-title">
              <div className="ui-card-head">
                <h2 id="pairs-title">All comparisons</h2>
                <p>Click a row to explore</p>
              </div>
              {pairs.loading && !readings.length ? (
                <Skeleton height={260} />
              ) : (
                <div className="ui-table-scroll">
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>Pair</th>
                        <th className="num">Gap / 10 g</th>
                        <th>vs usual</th>
                        {hasRanks && <th className="hide-sm">Recent trend</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((reading) => (
                        <tr
                          key={reading.pair}
                          className="clickable"
                          tabIndex={0}
                          onClick={() => explore(reading)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') explore(reading)
                          }}
                        >
                          <td className="ov-pair-cell">
                            {pairLabel(reading.pair)}
                            <span>Exp {shortDate(reading.expiry)}</span>
                          </td>
                          <td className="num">
                            {signedInr(reading.latest.spread_abs)}
                          </td>
                          <td>
                            {hasRanks ? (
                              <GapChip z={reading.latest.z} />
                            ) : (
                              <span className="ui-muted-note">
                                After {MIN_SESSIONS} sessions
                              </span>
                            )}
                          </td>
                          {hasRanks && (
                            <td className="hide-sm">
                              <Sparkline
                                values={reading.history}
                                width={130}
                                color="#9A9AA2"
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="ui-card" aria-labelledby="expiry-title">
              <div className="ui-card-head">
                <h2 id="expiry-title">Next expiries</h2>
                <p>Days left</p>
              </div>
              <ul className="ov-expiries">
                {nextExpiries.map((item, index) => (
                  <li key={item.product}>
                    <Ring
                      value={Math.max(0.05, 1 - item.days_to_expiry / 60)}
                      size={48}
                      stroke={5}
                      color={productColor(item.product, index)}
                      center={
                        <strong className="ov-ring-days">
                          {item.days_to_expiry}
                        </strong>
                      }
                    />
                    <div>
                      <strong>{item.product}</strong>
                      <span>{longDate(item.expiry_date)}</span>
                    </div>
                  </li>
                ))}
                {!nextExpiries.length && (
                  <li className="ui-muted-note">No upcoming expiries.</li>
                )}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
