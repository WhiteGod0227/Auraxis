import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import Crow from './Crow'

export interface SideLink {
  to: string
  label: string
  icon: IconName
  /** Paths that should highlight this link (defaults to `to`). */
  match?: string[]
  /** Run an action instead of navigating (rendered as a button). */
  action?: () => void
}

export interface SideGroup {
  title: string
  links: SideLink[]
}

const ICONS = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  compare: 'M4 18 9 11l4 4 7-9M4 20h16',
  backtest: 'M12 3a9 9 0 1 0 9 9h-9z M14 3.3A9 9 0 0 1 20.7 10H14z',
  alerts: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  data: 'M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  book: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10',
  play: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM10 8.5v7l6-3.5z',
  present: 'M3 4.5h18v11.5H3zM8 20h8M12 16v4M10.5 7.8v5.4l4.3-2.7z',
  research: 'M6 3h12v18l-6-4-6 4z',
} as const
export type IconName = keyof typeof ICONS

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

const COLLAPSE_KEY = 'auraxis.sidebar.collapsed'
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

/** Slide the highlight pill onto `target` (or hide it). */
function placePill(
  nav: HTMLElement | null,
  pill: HTMLElement | null,
  target?: HTMLElement | null,
) {
  if (!pill || !nav) return
  if (!target) {
    pill.style.opacity = '0'
    return
  }
  const box = target.getBoundingClientRect()
  const base = nav.getBoundingClientRect()
  pill.style.opacity = '1'
  pill.style.top = `${box.top - base.top + nav.scrollTop}px`
  pill.style.height = `${box.height}px`
}

/** Left liquid-glass sidebar: sliding highlight, collapsible rail, mobile drawer. */
export default function GlassSidebar({
  groups,
  account,
  footer,
  brandTo = '/',
}: {
  groups: SideGroup[]
  /** Shown under the logo (account menu or log-in button). */
  account?: ReactNode
  footer?: ReactNode
  brandTo?: string
}) {
  const { pathname } = useLocation()
  const path = pathname.replace(/\/$/, '') || '/'
  const [collapsed, setCollapsed] = useState(readCollapsed)
  // The drawer belongs to the page it was opened on; navigating closes it.
  const [openFor, setOpenFor] = useState<string | null>(null)
  const open = openFor === pathname
  const navRef = useRef<HTMLElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)

  const links = groups.flatMap((group) => group.links)
  const isActive = (link: SideLink) => (link.match ?? [link.to]).includes(path)
  const activeTo = links.find(isActive)?.to

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }, [collapsed])

  const movePill = (target?: HTMLElement | null) =>
    placePill(navRef.current, pillRef.current, target)
  const activeElement = () =>
    activeTo
      ? navRef.current?.querySelector<HTMLElement>(`a[data-to="${activeTo}"]`)
      : null

  useLayoutEffect(() => {
    const nav = navRef.current
    const find = () =>
      activeTo
        ? nav?.querySelector<HTMLElement>(`a[data-to="${activeTo}"]`)
        : null
    const sync = () => placePill(nav, pillRef.current, find())
    sync()
    window.addEventListener('resize', sync)
    document.fonts?.ready.then(sync).catch(() => {})
    return () => window.removeEventListener('resize', sync)
  }, [activeTo, collapsed])

  return (
    <>
      <div className="g-topbar">
        <Link to={brandTo} className="g-brand" aria-label="Auraxis home">
          <Crow size={30} bar={false} mood="guarding" animated={false} />
          <b>AURAXIS</b>
        </Link>
        <button
          type="button"
          className={`g-menu ${open ? 'is-open' : ''}`}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="g-side"
          onClick={() => setOpenFor(open ? null : pathname)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
      <div
        className={`g-scrim ${open ? 'show' : ''}`}
        aria-hidden="true"
        onClick={() => setOpenFor(null)}
      />
      <aside
        id="g-side"
        className={`g-side ${collapsed ? 'collapsed' : ''} ${open ? 'open' : ''}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpenFor(null)
        }}
      >
        <div className="g-side-head">
          <Link to={brandTo} className="g-brand" aria-label="Auraxis home">
            <Crow size={34} bar={false} mood="guarding" animated={false} />
            <b>AURAXIS</b>
          </Link>
          <button
            type="button"
            className="g-collapse"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M15 6l-6 6 6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        {account && <div className="g-side-account">{account}</div>}
        <nav
          className="g-side-nav"
          ref={navRef}
          aria-label="Main"
          onMouseLeave={() => movePill(activeElement())}
        >
          <span ref={pillRef} className="g-side-pill" aria-hidden="true" />
          {groups.map((group) => (
            <div className="g-side-group" key={group.title}>
              <p className="g-side-title">{group.title}</p>
              {group.links.map((link) => {
                const active = isActive(link)
                if (link.action)
                  return (
                    <button
                      key={link.to}
                      type="button"
                      className="g-side-action"
                      title={collapsed ? link.label : undefined}
                      onClick={() => {
                        setOpenFor(null)
                        link.action?.()
                      }}
                      onMouseEnter={(event) => movePill(event.currentTarget)}
                      onFocus={(event) => movePill(event.currentTarget)}
                    >
                      <Icon name={link.icon} />
                      <span>{link.label}</span>
                    </button>
                  )
                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end
                    data-to={link.to}
                    className={() => (active ? 'active' : '')}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? link.label : undefined}
                    onMouseEnter={(event) => movePill(event.currentTarget)}
                    onFocus={(event) => movePill(event.currentTarget)}
                  >
                    <Icon name={link.icon} />
                    <span>{link.label}</span>
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>
        {footer && <div className="g-side-foot">{footer}</div>}
      </aside>
    </>
  )
}
