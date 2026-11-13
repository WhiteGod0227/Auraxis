import { lazy, Suspense, useRef } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { longDate } from '@/lib/insight'
import CrowGuide from '@/components/CrowGuide'
import GlassNav from '@/components/GlassNav'
import AccountMenu from '@/components/AccountMenu'
import ThemeToggle from '@/components/ThemeToggle'
import { presenter } from '@/lib/presenter'
import CursorToggle from '@/components/CursorToggle'
import { Skeleton } from '@/components/ui'
import '@/styles/landing-v2.css'

const ReferencePriceChart = lazy(
  () => import('@/components/ReferencePriceChart'),
)
const pricesLoad = (signal: AbortSignal) => api.prices({}, signal)

const steps = [
  [
    'Put every contract on one scale',
    'GOLDM, GOLDTEN, GOLDGUINEA and GOLDPETAL quote different sizes. Auraxis converts them all to ₹ per 10 g.',
  ],
  [
    'Spot the unusual gaps',
    'Each price gap is compared with its own recent history, so you see at a glance which ones are out of line.',
  ],
  [
    'Test the idea with real costs',
    'Backtest a simple “gap returns to normal” rule, including trading costs, before trusting it.',
  ],
] as const

const features = [
  [
    '/app',
    'Overview',
    'The biggest gap today and every pair ranked against its usual level.',
  ],
  [
    '/app/relative-value',
    'Compare',
    'Drill into any pair or a single product’s prices across expiries.',
  ],
  [
    '/app/backtest',
    'Backtest',
    'Simulate trades with costs, drawdowns and open positions.',
  ],
  [
    '/app/import',
    'Data',
    'Drop in official MCX files — no broker account needed.',
  ],
] as const

export function LandingPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  const prices = useResource(pricesLoad)
  const data = prices.response?.data
  const hasChart = Boolean(data?.series.some((s) => s.history.length))
  return (
    <div className="landing lp" ref={pageRef}>
      <CrowGuide root={pageRef} />
      <a className="skip-link" href="#landing-main">
        Skip to content
      </a>
      <GlassNav
        links={[
          { to: '/', label: 'Home' },
          { to: '/app', label: 'Dashboard' },
          { to: '/app/demo', label: 'Tour' },
          { to: '/app/methodology', label: 'Methodology' },
        ]}
        right={
          <>
            <ThemeToggle />
            <CursorToggle />
            <AccountMenu placement="down" />
          </>
        }
      />
      <main id="landing-main" tabIndex={-1}>
        <section className="landing-hero landing-section">
          <div className="landing-hero-copy">
            <p className="kicker lp-rise">MCX gold futures · research</p>
            <h1 className="lp-title">
              <span className="lp-rise">Same gold.</span>
              <span className="lp-rise d1">Different contracts.</span>
              <span className="lp-rise d2 lp-title-muted">
                Is the gap real?
              </span>
            </h1>
            <p className="landing-intro lp-rise d3">
              Auraxis puts every MCX gold contract on one price scale, flags the
              gaps that are unusual, and lets you test them with real trading
              costs.
            </p>
            <div className="landing-actions lp-rise d3">
              <Link className="landing-cta" to="/app">
                Open dashboard <span aria-hidden="true">&rarr;</span>
              </Link>
              <Link className="landing-secondary" to="/app/demo">
                Take the 3-minute tour
              </Link>
              <button
                type="button"
                className="landing-secondary present-button"
                onClick={() => presenter.start()}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  aria-hidden="true"
                >
                  <path d="M7 5v14l11-7z" fill="currentColor" />
                </svg>
                Present demo
              </button>
            </div>
          </div>
          <div className="lp-hero-art">
            <div className="lp-preview" data-perch="0.78" data-perch-size="250">
              <div className="lp-preview-head">
                <h2>One basis. Four contracts.</h2>
                <span>
                  {data?.data_as_of
                    ? `₹ per 10 g · to ${longDate(data.data_as_of)}`
                    : '₹ per 10 g'}
                </span>
              </div>
              {prices.loading && !data ? (
                <Skeleton height={280} />
              ) : hasChart && data ? (
                <Suspense fallback={<Skeleton height={280} />}>
                  <ReferencePriceChart response={data} />
                </Suspense>
              ) : (
                <div className="lp-preview-empty">
                  <p>No market data loaded yet.</p>
                  <Link className="landing-secondary" to="/app/import">
                    Import MCX files
                  </Link>
                </div>
              )}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="landing-section" tabIndex={-1}>
          <h2 className="lp-section-title">How it works</h2>
          <ol className="lp-steps" data-perch="0.86" data-perch-size="140">
            {steps.map(([title, text], i) => (
              <li key={title}>
                <span className="lp-step-num">{i + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section">
          <h2 className="lp-section-title">Inside the dashboard</h2>
          <div className="lp-features" data-perch="0.12" data-perch-size="140">
            {features.map(([to, title, text]) => (
              <Link className="lp-feature" key={to} to={to}>
                <h3>
                  {title} <span aria-hidden="true">&rarr;</span>
                </h3>
                <p>{text}</p>
              </Link>
            ))}
          </div>
        </section>

        <section
          className="landing-section lp-closing"
          data-perch="0.84"
          data-perch-size="160"
        >
          <h2>Research first. Assumptions visible.</h2>
          <p>
            Historical settlement prices, not live quotes or advice. Every
            number links back to how it was calculated.
          </p>
          <div className="landing-actions">
            <Link className="landing-cta" to="/app">
              Open dashboard <span aria-hidden="true">&rarr;</span>
            </Link>
            <Link className="landing-secondary" to="/app/methodology">
              Read the methodology
            </Link>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <Link to="/">AURAXIS</Link>
        <span>Historical research tool · Not investment advice</span>
        <Link to="/app">Open dashboard</Link>
      </footer>
    </div>
  )
}
