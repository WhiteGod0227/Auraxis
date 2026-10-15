import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import CrowMascot from '@/components/CrowMascot'
import AccountMenu from '@/components/AccountMenu'
import type { CrowPose } from '@/components/CrowMascot'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import type { Resource } from '@/lib/useResource'
import type { MetaResponse } from '@/lib/types'

export interface DashboardContext {
  meta: Resource<MetaResponse>
}
const links = [
  { path: '/app', label: 'Overview', icon: '◈', end: true },
  { path: '/app/relative-value', label: 'Relative Value', icon: '⇄' },
  { path: '/app/term-structure', label: 'Term Structure', icon: '⌁' },
  { path: '/app/backtest', label: 'Backtest', icon: '↻' },
  { path: '/app/data-health', label: 'Data Health', icon: '▤' },
  { path: '/app/methodology', label: 'Methodology', icon: '⊙' },
]
export function AppLayout() {
  const { pathname } = useLocation()
  const crowPose: CrowPose = pathname.endsWith('/backtest')
    ? 'running'
    : pathname.endsWith('/data-health')
      ? 'inspecting'
      : pathname.endsWith('/methodology')
        ? 'reading'
        : pathname.endsWith('/relative-value') || pathname === '/app'
          ? 'gold'
          : 'walking'
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const meta = useResource(api.meta)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)')
    const closeOnDesktop = () => {
      if (!media.matches) setMobileOpen(false)
    }
    media.addEventListener('change', closeOnDesktop)
    return () => media.removeEventListener('change', closeOnDesktop)
  }, [])
  const closeNavigation = () => {
    setMobileOpen(false)
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('.mobile-toggle')?.focus(),
    )
  }
  return (
    <div
      className={`dashboard ${collapsed ? 'sidebar-collapsed' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && mobileOpen) closeNavigation()
      }}
    >
      <a className="skip-link" href="#dashboard-content">
        Skip to content
      </a>
      <aside
        className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}
        aria-label="Dashboard navigation"
      >
        <NavLink
          to="/app"
          className="brand"
          onClick={() => setMobileOpen(false)}
          aria-label="Auraxis Overview"
        >
          <span className="brand-symbol" aria-hidden="true">
            A<span>╱</span>
          </span>
          <span className="brand-word">
            AURAXIS<small>GOLD FUTURES RESEARCH</small>
          </span>
        </NavLink>
        <div className="sidebar-label">WORKSPACE</div>
        <nav id="dashboard-nav">
          {links.map((link) => (
            <NavLink
              key={link.path}
              to={link.path}
              end={link.end}
              aria-label={`${link.label}${!['Overview', 'Relative Value', 'Term Structure', 'Backtest', 'Data Health', 'Methodology'].includes(link.label) ? ' (not implemented yet)' : ''}`}
              title={collapsed ? link.label : undefined}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `nav-link ${isActive ? 'active' : ''}`
              }
            >
              <span className="nav-icon" aria-hidden="true">
                {link.icon}
              </span>
              <span className="nav-label">{link.label}</span>
              {![
                'Overview',
                'Relative Value',
                'Term Structure',
                'Backtest',
                'Data Health',
                'Methodology',
              ].includes(link.label) && (
                <span className="nav-pending" aria-label="Not implemented">
                  Soon
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <Link
          to="/"
          className="dashboard-home"
          aria-label="Auraxis landing page"
        >
          <span aria-hidden="true">&#8592;</span>
          <span className="nav-label">Auraxis home</span>
        </Link>
        <div className="sidebar-bottom">
          <span className="prototype-dot" aria-hidden="true" />
          <span className="nav-label">Research prototype</span>
        </div>
        <button
          className="collapse-button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          <span aria-hidden="true">{collapsed ? '→' : '←'}</span>
          <span className="nav-label">Collapse sidebar</span>
        </button>
        <button className="mobile-close" onClick={() => setMobileOpen(false)}>
          Close navigation
        </button>
      </aside>
      {mobileOpen && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={closeNavigation}
        />
      )}
      <div className="workspace" inert={mobileOpen}>
        <header className="topbar">
          <button
            className="mobile-toggle"
            aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileOpen}
            aria-controls="dashboard-nav"
            onClick={() => {
              setMobileOpen((v) => !v)
              requestAnimationFrame(() =>
                document
                  .querySelector<HTMLAnchorElement>('.sidebar nav a')
                  ?.focus(),
              )
            }}
          >
            ☰
          </button>
          <div className="topbar-identity">
            <CrowMascot pose={crowPose} />
            <span className="topbar-title">
              MCX <span className="muted">/</span> Gold futures
            </span>
          </div>
          <div className="topbar-meta">
            <AccountMenu />
            <span>
              Historical data{' '}
              <strong>
                {meta.response?.data.data_as_of ??
                  (meta.loading ? 'Loading…' : 'Unavailable')}
              </strong>
            </span>
            <span className="badge">
              Prototype window:{' '}
              {meta.response?.data.trading_session_count ?? '—'} sessions
            </span>
            {meta.response && (
              <span
                className={`source-badge ${meta.response.source === 'Offline snapshot' ? 'offline' : ''}`}
              >
                {meta.response.source}
              </span>
            )}
          </div>
        </header>
        <main id="dashboard-content" tabIndex={-1}>
          <p className="basis-warning">
            Research prototype · Purity adjustment is experimental and off by
            default.
          </p>
          <Outlet context={{ meta } satisfies DashboardContext} />
        </main>
        <footer>
          Educational and research purposes only. Not investment advice.
        </footer>
      </div>
    </div>
  )
}
