import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAccount } from '@/lib/useAccount'
import SignOutButton from './SignOutButton'

/** Avatar dropdown holding every account-related link in one place. */
export default function AccountMenu({
  placement = 'down',
}: {
  placement?: 'up' | 'down'
}) {
  const { user, checked } = useAccount()
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

  if (!checked)
    return (
      <span
        className="account-menu"
        role="status"
        aria-label="Checking account"
      />
    )
  if (!user)
    return (
      <div className="account-menu">
        <Link className="account-signin" to="/login">
          Log in
        </Link>
      </div>
    )
  const initials =
    user.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '•'
  return (
    <div className="account-menu">
      <details ref={menu} className={`account-dropdown ${placement}`}>
        <summary aria-label={`Account menu for ${user.name}`}>
          <span className="account-avatar" aria-hidden="true">
            {initials}
          </span>
          <span className="account-name">{user.name}</span>
          <span className="account-caret" aria-hidden="true">
            {placement === 'up' ? '▴' : '▾'}
          </span>
        </summary>
        <div className="account-panel">
          <div className="account-email">{user.email}</div>
          <Link to="/app/profile">My Profile</Link>
          <Link to="/app/research">My Research</Link>
          <Link to="/app/security">Security</Link>
          <Link to="/">Auraxis home</Link>
          <SignOutButton />
        </div>
      </details>
    </div>
  )
}
