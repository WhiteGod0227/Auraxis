import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import Crow from './Crow'
import { pairLabel } from '@/lib/insight'

export interface NavItem {
  to: string
  label: string
  /** Paths that highlight this link (defaults to `to`). */
  match?: string[]
}

export interface NavAction {
  label: string
  to?: string
  action?: () => void
}

interface SearchResult {
  key: string
  label: string
  hint: string
  run: () => void
}

const PRODUCTS = ['GOLDM', 'GOLDTEN', 'GOLDGUINEA', 'GOLDPETAL']

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null
  return Boolean(
    element &&
    (element.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)),
  )
}

/** Search across pages, products and pairs. "/" focuses it from anywhere. */
function Search({
  pages,
  pairs,
  onPair,
  onDone,
  autoFocusKey = true,
}: {
  pages: (NavItem | NavAction)[]
  pairs: string[]
  onPair: (pair: string) => void
  onDone?: () => void
  autoFocusKey?: boolean
}) {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (!autoFocusKey) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && !isTyping(event.target)) {
        event.preventDefault()
        input.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [autoFocusKey])

  const results = useMemo<SearchResult[]>(() => {
    const finish = (run: () => void) => () => {
      run()
      setQuery('')
      setOpen(false)
      input.current?.blur()
      onDone?.()
    }
    const all: SearchResult[] = [
      ...PRODUCTS.map((product) => ({
        key: `product-${product}`,
        label: product,
        hint: 'Product',
        run: finish(() =>
          navigate(`/app?product=${encodeURIComponent(product)}`),
        ),
      })),
      ...pairs.map((pair) => ({
        key: `pair-${pair}`,
        label: pairLabel(pair),
        hint: 'Compare pair',
        run: finish(() => onPair(pair)),
      })),
      ...pages.map((page) => ({
        key: `page-${page.label}`,
        label: page.label,
        hint: 'Page',
        run: finish(() => {
          if ('action' in page && page.action) page.action()
          else if (page.to) navigate(page.to)
        }),
      })),
    ]
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return all.slice(0, 8)
    return all
      .filter((item) => {
        const text = `${item.label} ${item.hint}`.toLowerCase()
        return terms.every((term) => text.includes(term))
      })
      .slice(0, 10)
  }, [query, pairs, pages, navigate, onPair, onDone])

  const selected = Math.min(active, Math.max(results.length - 1, 0))

  return (
    <div className="tn-search">
      <label>
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          ref={input}
          type="search"
          placeholder="Search products, pairs, pages…"
          aria-label="Search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && results[selected]
              ? `${listId}-${results[selected].key}`
              : undefined
          }
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((value) => Math.min(value + 1, results.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((value) => Math.max(value - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              results[selected]?.run()
            } else if (event.key === 'Escape') {
              setOpen(false)
              input.current?.blur()
            }
          }}
        />
        <kbd aria-hidden="true">/</kbd>
      </label>
      {open && (
        <ul className="tn-results" id={listId} role="listbox">
          {results.length ? (
            results.map((item, index) => (
              <li
                key={item.key}
                id={`${listId}-${item.key}`}
                role="option"
                aria-selected={index === selected}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={item.run}
                >
                  <span>{item.label}</span>
                  <small>{item.hint}</small>
                </button>
              </li>
            ))
          ) : (
            <li className="tn-empty">No matches</li>
          )}
        </ul>
      )}
    </div>
  )
}

/** Learn ▾ menu: secondary pages and actions. */
function More({ items }: { items: NavAction[] }) {
  const menu = useRef<HTMLDetailsElement>(null)
  const { pathname } = useLocation()
  useEffect(() => {
    if (menu.current) menu.current.open = false
  }, [pathname])
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
    <details className="tn-more" ref={menu}>
      <summary>
        Learn
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path
            d="m2.5 4.5 3.5 3.5 3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </summary>
      <div className="tn-more-panel">
        {items.map((item) =>
          item.action ? (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                if (menu.current) menu.current.open = false
                item.action?.()
              }}
            >
              {item.label}
            </button>
          ) : (
            <Link key={item.label} to={item.to ?? '/app'}>
              {item.label}
            </Link>
          ),
        )}
      </div>
    </details>
  )
}

/** Horizontal app bar: brand, search, primary links, status and account. */
export default function TopNav({
  links,
  more,
  pages,
  pairs,
  onPair,
  right,
}: {
  links: NavItem[]
  more: NavAction[]
  /** Extra search-only destinations. */
  pages: NavAction[]
  pairs: string[]
  onPair: (pair: string) => void
  right: ReactNode
}) {
  const { pathname } = useLocation()
  const path = pathname.replace(/\/$/, '') || '/'
  const [drawerFor, setDrawerFor] = useState<string | null>(null)
  const drawer = drawerFor === pathname
  const isActive = (item: NavItem) => (item.match ?? [item.to]).includes(path)
  const searchPages = [...links, ...pages, ...more]

  return (
    <>
      <header className="tn">
        <Link to="/app" className="tn-brand" aria-label="Auraxis home">
          <Crow size={30} bar={false} mood="guarding" animated={false} />
          <span>Auraxis</span>
        </Link>
        <Search pages={searchPages} pairs={pairs} onPair={onPair} />
        <nav className="tn-links" aria-label="Main">
          {links.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={() => (isActive(item) ? 'active' : '')}
              aria-current={isActive(item) ? 'page' : undefined}
            >
              {item.label}
            </NavLink>
          ))}
          <More items={more} />
        </nav>
        <div className="tn-right">
          {right}
          <button
            type="button"
            className="tn-menu"
            aria-label={drawer ? 'Close menu' : 'Open menu'}
            aria-expanded={drawer}
            aria-controls="tn-drawer"
            onClick={() => setDrawerFor(drawer ? null : pathname)}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {drawer ? (
                <path d="M6 6l12 12M18 6 6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>
      </header>
      <div
        id="tn-drawer"
        className={`tn-drawer ${drawer ? 'open' : ''}`}
        hidden={!drawer}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setDrawerFor(null)
        }}
      >
        {drawer && (
          <Search
            pages={searchPages}
            pairs={pairs}
            onPair={onPair}
            onDone={() => setDrawerFor(null)}
            autoFocusKey={false}
          />
        )}
        {links.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={isActive(item) ? 'active' : ''}
            onClick={() => setDrawerFor(null)}
          >
            {item.label}
          </Link>
        ))}
        <p>Learn</p>
        {more.map((item) =>
          item.action ? (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setDrawerFor(null)
                item.action?.()
              }}
            >
              {item.label}
            </button>
          ) : (
            <Link
              key={item.label}
              to={item.to ?? '/app'}
              onClick={() => setDrawerFor(null)}
            >
              {item.label}
            </Link>
          ),
        )}
      </div>
    </>
  )
}
