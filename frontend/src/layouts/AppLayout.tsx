import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import AccountMenu from '@/components/AccountMenu'
import ThemeToggle from '@/components/ThemeToggle'
import { presenter } from '@/lib/presenter'
import AutoImportWatcher from '@/components/AutoImportWatcher'
import CursorToggle from '@/components/CursorToggle'
import GlassSidebar from '@/components/GlassSidebar'
import type { SideGroup } from '@/components/GlassSidebar'
import { PageHeader, Tabs } from '@/components/ui'
import { useDataSource } from '@/lib/useDataSource'
import { formatTradeDate } from '@/lib/dataSource'
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

export interface DashboardContext {
  meta: Resource<MetaResponse>
  relativeValue: RelativeValueSelection
  setRelativeValue: Dispatch<SetStateAction<RelativeValueSelection>>
  coverageSelection: CoverageSelection
  setCoverageSelection: Dispatch<SetStateAction<CoverageSelection>>
}

const COMPARE = ['/app/relative-value', '/app/term-structure']
const DATA = ['/app/import', '/app/data-health', '/app/calendar']

const nav: SideGroup[] = [
  {
    title: 'Research',
    links: [
      { to: '/app', label: 'Overview', icon: 'overview', match: ['/app'] },
      {
        to: '/app/relative-value',
        label: 'Compare',
        icon: 'compare',
        match: COMPARE,
      },
      { to: '/app/backtest', label: 'Backtest', icon: 'backtest' },
      { to: '/app/alerts', label: 'Alerts', icon: 'alerts' },
    ],
  },
  {
    title: 'Data',
    links: [
      { to: '/app/import', label: 'Market data', icon: 'data', match: DATA },
      { to: '/app/research', label: 'Saved research', icon: 'research' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { to: '/app/methodology', label: 'Methodology', icon: 'book' },
      { to: '/app/demo', label: 'Guided tour', icon: 'play' },
      {
        to: '#present',
        label: 'Present demo',
        icon: 'present',
        action: () => presenter.start(),
      },
    ],
  },
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
  '/app/security',
  '/app/recover',
  '/app/methodology',
  '/app/demo',
]

function DataStatus({ source }: { source: ReturnType<typeof useDataSource> }) {
  const { status, state, account, busy, refresh } = source
  const latest = formatTradeDate(status?.latest_trade_date)
  const label =
    state === 'offline'
      ? 'Offline'
      : state === 'empty'
        ? 'No data'
        : `Data to ${latest}`
  return (
    <span className="g-status" data-state={state} title={label}>
      <i aria-hidden="true" />
      <span>{label}</span>
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
  const path = pathname.replace(/\/$/, '') || '/app'
  const section = sections.find((item) => item.match.includes(path))
  const needsData =
    !NO_DATA_OK.includes(path) &&
    (dataSource.state === 'empty' || dataSource.state === 'offline')

  return (
    <div className="shell">
      <a className="skip-link" href="#dashboard-content">
        Skip to content
      </a>
      <GlassSidebar
        groups={nav}
        brandTo="/app"
        footer={
          <>
            <DataStatus source={dataSource} />
            <div className="g-side-row">
              <AccountMenu placement="up" />
              <ThemeToggle />
              <CursorToggle />
            </div>
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
              <PageHeader title={section.title} subtitle={section.subtitle}>
                <Tabs label={`${section.title} views`} items={section.tabs} />
              </PageHeader>
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
