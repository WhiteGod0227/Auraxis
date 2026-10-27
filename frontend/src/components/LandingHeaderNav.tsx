import { useState, type CSSProperties } from 'react'
import { Link, useLocation } from 'react-router-dom'
import './LandingHeaderNav.css'

const links = [
  { label: 'Home', to: '/', icon: 'home' },
  { label: 'My Profile', to: '/app/profile', icon: 'profile' },
  { label: 'Open Dashboard', to: '/app', icon: 'dashboard' },
] as const

export default function LandingHeaderNav() {
  const { pathname } = useLocation()
  const activeIndex = pathname === '/' ? 0 : pathname === '/app/profile' ? 1 : 2
  return (
    <FlipNavigation
      key={activeIndex}
      activeIndex={activeIndex}
      pathname={pathname}
    />
  )
}

function FlipNavigation({
  activeIndex,
  pathname,
}: {
  activeIndex: number
  pathname: string
}) {
  const [card, setCard] = useState({
    from: activeIndex,
    to: activeIndex,
    rotationFrom: 0,
    rotationTo: 0,
    step: 0,
  })
  const highlight = (index: number) => {
    setCard((previous) =>
      previous.to === index
        ? previous
        : {
            from: previous.to,
            to: index,
            rotationFrom: previous.rotationTo,
            rotationTo:
              previous.rotationTo + (index > previous.to ? 180 : -180),
            step: previous.step + 1,
          },
    )
  }
  const style = {
    '--flip-from': card.from,
    '--flip-to': card.to,
    '--rotation-from': `${card.rotationFrom}deg`,
    '--rotation-to': `${card.rotationTo}deg`,
  } as CSSProperties

  return (
    <nav
      className="landing-flip-nav"
      aria-label="Primary navigation"
      style={style}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement))
          highlight(activeIndex)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          highlight(activeIndex)
      }}
    >
      <div
        key={card.step}
        className="landing-flip-card"
        data-animated={card.step > 0}
        aria-hidden="true"
      >
        <span className="landing-flip-face" />
        <span className="landing-flip-face landing-flip-back" />
      </div>
      {links.map(({ label, to, icon }, index) => (
        <Link
          key={to}
          to={to}
          className="landing-flip-link"
          aria-current={
            index === activeIndex
              ? pathname === to
                ? 'page'
                : 'location'
              : undefined
          }
          data-highlighted={card.to === index}
          onMouseEnter={() => highlight(index)}
          onFocus={() => highlight(index)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            {icon === 'home' ? (
              <path d="m2 11 10-9 10 9h-3v10h-5v-7h-4v7H5V11Z" />
            ) : icon === 'profile' ? (
              <>
                <circle cx="12" cy="7" r="4" />
                <path d="M4 21v-3c0-4 4-6 8-6s8 2 8 6v3Z" />
              </>
            ) : (
              <path d="M3 3h8v8H3Zm10 0h8v5h-8Zm0 7h8v11h-8ZM3 13h8v8H3Z" />
            )}
          </svg>
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  )
}
