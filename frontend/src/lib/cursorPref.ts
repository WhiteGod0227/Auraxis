import { useSyncExternalStore } from 'react'

/** Whether the animated crow replaces the mouse pointer. Default: on. */
const KEY = 'auraxis.cursor'
const listeners = new Set<() => void>()

export function crowCursorOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'native'
  } catch {
    return true
  }
}

export function setCrowCursor(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'crow' : 'native')
  } catch {
    /* storage unavailable: lasts for this visit only */
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useCrowCursor(): boolean {
  return useSyncExternalStore(subscribe, crowCursorOn, () => true)
}
