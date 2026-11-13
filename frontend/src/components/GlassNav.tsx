import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import Crow from './Crow'

export interface GlassNavLink {
  to: string
  label: string
  /** Paths that should highlight this link (defaults to `to`). */
  match?: string[]
}

/** Floating liquid-glass navigation bar with a sliding highlight pill. */
export default function GlassNav({
  links,
  right,
  brandTo = '/',
}: {
  links: GlassNavLink[]
  right?: ReactNode
  brandTo?: string
}) {
  const { pathname, hash } = useLocation()
  const path = pathname.replace(/\/$/, '') || '/'
  // The mobile menu belongs to the page it was opened on; navigating closes it.
  const [openFor, setOpenFor] = useState<string | null>(null)
  const open = openFor === pathname
  const setOpen = (value: boolean | ((current: boolean) => boolean)) =>
    setOpenFor((current) => {
      const next =
        typeof value === 'function' ? value(current === pathname) : value
      return next ? pathname : null
    })
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.scrollY > 40,
  )
  const linksRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  const isActive = (link: GlassNavLink) =>
    (link.match ?? [link.to]).some((m) =>
      m.startsWith('#') ? hash === m : m === path,
    )
  const activeIndex = links.findIndex(isActive)

  const movePill = useCallback((target?: HTMLElement | null) => {
    const pill = pillRef.current
    if (!pill) return
    if (!target) {
      pill.style.opacity = '0'
      return
    }
    pill.style.opacity = '1'
    pill.style.left = `${target.offsetLeft}px`
    pill.style.width = `${target.offsetWidth}px`
  }, [])
  const activeElement = () =>
    activeIndex >= 0
      ? (linksRef.current?.children[activeIndex + 1] as HTMLElement | undefined)
      : undefined

  useLayoutEffect(() => {
    movePill(activeElement())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, movePill])
  useEffect(() => {
    const onResize = () => movePill(activeElement())
    const onScroll = () => setCompact(window.scrollY > 40)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, { passive: true })
    document.fonts?.ready.then(onResize).catch(() => {})
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  return (
    <header
      className={`g-nav ${compact ? 'compact' : ''} ${open ? 'open' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <Link to={brandTo} className="g-brand" aria-label="Auraxis home">
        <Crow size={34} bar={false} mood="guarding" animated={false} />
        <b>AURAXIS</b>
      </Link>
      <nav
        className="g-links"
        id="g-links"
        ref={linksRef}
        aria-label="Main"
        onMouseLeave={() => movePill(activeElement())}
      >
        <span ref={pillRef} className="g-pill" aria-hidden="true" />
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end
            className={() => (isActive(link) ? 'active' : '')}
            aria-current={isActive(link) ? 'page' : undefined}
            onMouseEnter={(event) => movePill(event.currentTarget)}
            onClick={() => setOpen(false)}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="g-nav-right">{right}</div>
      <button
        type="button"
        className="g-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="g-links"
        onClick={() => setOpen((value) => !value)}
      >
        <span />
        <span />
        <span />
      </button>
    </header>
  )
}
