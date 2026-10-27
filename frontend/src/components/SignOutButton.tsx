import { useRef, useState } from 'react'
import { auth } from '@/lib/auth'
export default function SignOutButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  return (
    <span>
      <button
        className="button"
        disabled={busy}
        onClick={async () => {
          if (lock.current) return
          lock.current = true
          setBusy(true)
          setError('')
          try {
            await auth.logout()
          } catch {
            setError('Sign out failed. Retry when the backend is available.')
          } finally {
            lock.current = false
            setBusy(false)
          }
        }}
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  )
}
