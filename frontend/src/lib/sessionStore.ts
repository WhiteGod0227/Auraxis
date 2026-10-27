// Memory only. Epoch changes invalidate private responses from an older account.
import type { AccountUser } from './auth'
export function createSessionStore() {
  let state: {
    user: AccountUser | null
    epoch: number
    checked: boolean
    error?: string
  } = {
    user: null,
    epoch: 0,
    checked: false,
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(user: AccountUser | null, error?: string) {
      const changed = user?.id !== state.user?.id
      state = {
        user,
        checked: true,
        epoch: state.epoch + (changed ? 1 : 0),
        error,
      }
      listeners.forEach((listener) => listener())
    },
  }
}
