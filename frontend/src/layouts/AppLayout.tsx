import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import AccountMenu from '@/components/AccountMenu'
import ThemeToggle from '@/components/ThemeToggle'
import { presenter } from '@/lib/presenter'
import AutoImportWatcher from '@/components/AutoImportWatcher'
import CursorToggle from '@/components/CursorToggle'
import TopNav from '@/components/TopNav'
import type { NavAction, NavItem } from '@/components/TopNav'
import { PageHeader, Tabs } from '@/components/ui'
import { useDataSource } from '@/lib/useDataSource'
import { formatTradeDate } from '@/lib/dataSource'
import { ago, useLive, useNow } from '@/lib/live'
import { isLiveActive } from '@/lib/liveView'
import { shortDate } from '@/lib/insight'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import type { Resource } from '@/lib/useResource'
import type { MetaResponse } from '@/lib/types'
import { initialRelativeValueSelection } from '@/lib/relativeValue'
import type { RelativeValueSelection } from '@/lib/relativeValue'
import { initialCoverageSelection } from '@/lib/coverage'
import type { CoverageSelection } from '@/lib/coverage'
import type { Dispatch, SetStateAction } from 'react'
import '@/styles/data-source.css'
import '@/styles/market-status.css'
import '@/styles/practice.css'
import { useAccount } from '@/lib/useAccount'
import {
  clearPractice,
  demoMoney,
  refreshPractice,
  usePractice,
} from '@/lib/practice'

export interface DashboardContext {
  meta: Resource<MetaResponse>
  relativeValue: RelativeValueSelection
  setRelativeValue: Dispatch<SetStateAction<RelativeValueSelection>>
  coverageSelection: CoverageSelection
  setCoverageSelection: Dispatch<SetStateAction<CoverageSelection>>
}

const COMPARE = ['/app/relative-value', '/app/term-structure']
const DATA = ['/app/import', '/app/data-health', '/app/calendar']

const PAIRS = [
  'GOLDTEN-GOLDPETAL',
  'GOLDTEN-GOLDGUINEA',
  'GOLDGUINEA-GOLDPETAL',
  'GOLDM-GOLDTEN',
  'GOLDM-GOLDGUINEA',
  'GOLDM-GOLDPETAL',
]

const links: NavItem[] = [
  { to: '/app', label: 'Overview', match: ['/app'] },
  { to: '/app/relative-value', label: 'Compare', match: COMPARE },
  { to: '/app/backtest', label: 'Backtest' },
  { to: '/app/practice', label: 'Practice' },
  { to: '/app/alerts', label: 'Alerts' },
  { to: '/app/import', label: 'Data', match: DATA },
  { to: '/app/research', label: 'Research' },
]

const learn: NavAction[] = [
  { to: '/app/onchain', label: 'On-chain gold' },
  { to: '/app/proofs', label: 'Proof of research' },
  { to: '/app/methodology', label: 'Methodology' },
  { to: '/app/demo', label: 'Guided tour' },
  { label: 'Present demo', action: () => presenter.start() },
]

/** Search-only destinations (sub-pages and account pages). */
const searchPages: NavAction[] = [
  { to: '/app/term-structure', label: 'Across expiries' },
  { to: '/app/data-health', label: 'Data health' },
  { to: '/app/calendar', label: 'Coverage calendar' },
  { to: '/app/profile', label: 'Profile' },
  { to: '/app/security', label: 'Security' },
]

const sections = [
  {
    match: COMPARE,
    title: 'Compare',
    subtitle: 'How gold contracts are priced against each other.',
    tabs: [
      { to: '/app/relative-value', label: 'Between products' },
      { to: '/app/term-structure', label: 'Across expiries' },
    ],
  },
  {
    match: DATA,
    title: 'Data',
    subtitle: 'Load official MCX files and check what is available.',
    tabs: [
      { to: '/app/import', label: 'Import' },
      { to: '/app/data-health', label: 'Data health' },
      { to: '/app/calendar', label: 'Coverage' },
    ],
  },
]

/** Pages that work without market data and need no "import first" banner. */
const NO_DATA_OK = [
  '/app',
  '/app/import',
  '/app/profile',
  '/app/research',
  '/app/practice',
  '/app/onchain',
  '/app/proofs',
  '/app/security',
  '/app/recover',
  '/app/methodology',
  '/app/demo',
]

/** Demo-money balance; links to the Practice page. Signed-in users only. */
function WalletChip({ userId }: { userId: number }) {
  const { summary } = usePractice()
  useEffect(() => {
    void refreshPractice()
    return () => clearPractice()
  }, [userId])
  if (!summary) return null
  const change = summary.return_pct
  return (
    <Link
      to="/app/practice"
      className="tn-wallet"
      title="Demo money (no cash value). Open Practice."
    >
      {demoMoney(summary.equity)}
      <small
        className={`tone-${change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'}`}
      >
        {change > 0 ? '+' : change < 0 ? '−' : ''}
        {Math.abs(change).toFixed(1)}%
      </small>
    </Link>
  )
}

function Wallet() {
  const { user } = useAccount()
  return user ? <WalletChip userId={user.id} /> : null
}

/** Market status: live session, closed with prices pending settlement, or settled. */
function MarketStatus({
  source,
}: {
  source: ReturnType<typeof useDataSource>
}) {
  const { status, state, account, busy, refresh } = source
  const { snapshot } = useLive()
  const now = useNow(5000)
  const latest = formatTradeDate(status?.latest_trade_date)
  const live =
    state !== 'offline' && isLiveActive(snapshot, status?.latest_trade_date)
  const trading = live && snapshot?.state === 'live'
  const tone = live ? (trading ? 'live' : 'closed') : state
  const label =
    state === 'offline'
      ? 'Offline'
      : live && snapshot
        ? trading
          ? `Live · ${shortDate(snapshot.trade_date)}`
          : `MCX closed · ${formatTradeDate(snapshot.trade_date)}`
        : state === 'empty'
          ? 'No data'
          : `Settled to ${latest}`
  const title = live
    ? `${label}${trading ? `, updated ${ago(snapshot?.updated_at, now) ?? 'just now'}` : ''}. Settlement data to ${latest ?? '—'}.`
    : label
  return (
    <span className="g-status" data-state={tone} title={title}>
      <i aria-hidden="true" />
      <Link to="/app/import" className="g-status-link">
        {label}
      </Link>
      {status?.configured && account.user && (
        <button
          type="button"
          onClick={refresh}
          disabled={busy || status.refreshing}
          aria-label="Refresh market data from Upstox"
        >
          {busy ? '…' : '↻'}
        </button>
      )}
    </span>
  )
}

export function AppLayout() {
  const { pathname } = useLocation()
  const meta = useResource(api.meta)
  const dataSource = useDataSource()
  const [relativeValue, setRelativeValue] = useState(
    initialRelativeValueSelection,
  )
  const [coverageSelection, setCoverageSelection] = useState(
    initialCoverageSelection,
  )
  const navigate = useNavigate()
  const path = pathname.replace(/\/$/, '') || '/app'
  const section = sections.find((item) => item.match.includes(path))
  const needsData =
    !NO_DATA_OK.includes(path) &&
    (dataSource.state === 'empty' || dataSource.state === 'offline')

  return (
    <div className="shell shell-topnav">
      <a className="skip-link" href="#dashboard-content">
        Skip to content
      </a>
      <TopNav
        links={links}
        more={learn}
        pages={searchPages}
        pairs={PAIRS}
        onPair={(pair) => {
          setRelativeValue((previous) => ({ ...previous, pair }))
          navigate('/app/relative-value')
        }}
        right={
          <>
            <Wallet />
            <MarketStatus source={dataSource} />
            <ThemeToggle />
            <CursorToggle />
            <AccountMenu placement="down" />
          </>
        }
      />
      <div className="shell-main">
        <main
          id="dashboard-content"
          className={`shell-content ${section ? 'in-section' : ''}`}
          tabIndex={-1}
        >
          <div className="page-enter" key={section ? section.title : path}>
            {section && (
              <PageHeader
                title={section.title}
                subtitle={section.subtitle}
                actions={
                  <Tabs label={`${section.title} views`} items={section.tabs} />
                }
              />
            )}
            {needsData && (
              <div className="shell-banner" role="status">
                <span>
                  {dataSource.state === 'offline'
                    ? "Can't reach the data server. Make sure the backend is running."
                    : 'No market data loaded yet.'}
                </span>
                {dataSource.state === 'empty' && (
                  <Link className="ui-button primary" to="/app/import">
                    Import data
                  </Link>
                )}
              </div>
            )}
            <div className="page-enter" key={path}>
              <Outlet
                context={
                  {
                    meta,
                    relativeValue,
                    setRelativeValue,
                    coverageSelection,
                    setCoverageSelection,
                  } satisfies DashboardContext
                }
              />
            </div>
          </div>
        </main>
        {dataSource.notice && (
          <p
            className={`data-source-notice ${dataSource.notice.tone}`}
            role={dataSource.notice.tone === 'error' ? 'alert' : 'status'}
          >
            {dataSource.notice.text}
          </p>
        )}
        <AutoImportWatcher />
        <footer className="shell-footer">
          <span>
            Auraxis · historical research tool · not investment advice
          </span>
          <nav aria-label="Footer">
            <Link to="/app/methodology">Methodology</Link>
            <Link to="/app/demo">Take the tour</Link>
            <Link to="/">Home</Link>
          </nav>
        </footer>
      </div>
    </div>
  )
}
