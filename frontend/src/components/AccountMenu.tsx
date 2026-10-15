import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { auth, AuthError } from '@/lib/auth'
import type { AccountUser } from '@/lib/auth'

export default function AccountMenu() {
  const [user, setUser] = useState<AccountUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    auth
      .me()
      .then((value) => {
        if (active) setUser(value)
      })
      .catch((e) => {
        if (active && !(e instanceof AuthError && e.status === 401))
          setError('Account unavailable')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])
  const logout = async () => {
    setLoading(true)
    setError('')
    try {
      await auth.logout()
      setUser(null)
    } catch {
      setError('Sign out failed. Retry when the backend is available.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="account-menu">
      {loading ? (
        <span role="status">Checking account…</span>
      ) : user ? (
        <>
          <span title={user.email}>Hi, {user.name}</span>
          <button className="button" onClick={logout}>
            Sign out
          </button>
        </>
      ) : (
        <Link to="/login">Log in</Link>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
