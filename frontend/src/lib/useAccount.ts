import { useEffect, useSyncExternalStore } from 'react'
import { refreshSession, session } from './auth'
export function useAccount() {
  const account = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  )
  useEffect(() => {
    if (!session.getSnapshot().checked) void refreshSession().catch(() => {})
    const refresh = () => {
      void refreshSession().catch(() => {})
    }
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 60000)
    return () => {
      window.removeEventListener('focus', refresh)
      window.clearInterval(timer)
    }
  }, [])
  return account
}
