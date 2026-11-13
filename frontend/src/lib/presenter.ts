import { useSyncExternalStore } from 'react'

/** Demo ("present") mode state, kept for the browser tab. */
export interface PresenterState {
  active: boolean
  step: number
  auto: boolean
}

const KEY = 'auraxis.present'
const idle: PresenterState = { active: false, step: 0, auto: false }
const listeners = new Set<() => void>()

function read(): PresenterState {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? { ...idle, ...(JSON.parse(raw) as PresenterState) } : idle
  } catch {
    return idle
  }
}
let state: PresenterState = typeof window === 'undefined' ? idle : read()

function write(next: PresenterState) {
  state = next
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((listener) => listener())
}

export const presenter = {
  start: (auto = false) => write({ active: true, step: 0, auto }),
  stop: () => write({ ...idle }),
  go: (step: number) => write({ ...state, step }),
  setAuto: (auto: boolean) => write({ ...state, auto }),
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePresenter(): PresenterState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => idle,
  )
}
