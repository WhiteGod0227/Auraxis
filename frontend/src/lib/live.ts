import { useEffect, useState, useSyncExternalStore } from 'react'
import { env } from './env'

export type LiveState =
  | 'live'
  | 'closed'
  | 'settled'
  | 'starting'
  | 'error'
  | 'not_configured'
  | 'disabled'

export interface LiveReference {
  product: string
  available: boolean
  expiry_date?: string
  days_to_expiry?: number
  last_price?: number | null
  price_p10?: number | null
  previous_close_p10?: number | null
  previous_trade_date?: string | null
  change_basis?: 'stored_settlement' | 'exchange_previous_close' | null
  change_abs?: number | null
  change_pct?: number | null
  volume_grams?: number
  open_interest_grams?: number
  traded_today?: boolean
  last_trade_at?: string | null
}

export interface LivePair {
  pair: string
  expiry: string
  a_p10: number | null
  b_p10: number | null
  spread_abs: number | null
  spread_pct: number | null
  z: number | null
  percentile: number | null
  tradable: boolean
  reason: string
  settled_trade_date: string | null
  settled_spread_abs: number | null
  settled_z: number | null
}

export interface LiveSnapshot {
  state: LiveState
  message: string
  market_open: boolean
  poll_seconds: number
  session: { start: string; end: string; timezone: string; weekdays: string }
  last_attempt_at: string | null
  next_poll_at: string | null
  note: string
  trade_date: string | null
  updated_at: string | null
  settled: boolean
  window: number | null
  references: LiveReference[]
  pairs: LivePair[]
}

const STATES: LiveState[] = [
  'live',
  'closed',
  'settled',
  'starting',
  'error',
  'not_configured',
  'disabled',
]

function isSnapshot(value: unknown): value is LiveSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    STATES.includes(item.state as LiveState) &&
    Array.isArray(item.references) &&
    Array.isArray(item.pairs) &&
    typeof item.poll_seconds === 'number'
  )
}

export async function fetchLive(signal?: AbortSignal): Promise<LiveSnapshot> {
  const base = env.apiBaseUrl.replace(/\/$/, '')
  const response = await fetch(`${base}/api/live`, {
    cache: 'no-store',
    signal,
  })
  if (!response.ok)
    throw new Error(`Live prices unavailable (${response.status}).`)
  const body: unknown = await response.json()
  if (!isSnapshot(body)) throw new Error('Unexpected live price response.')
  return body
}

const SECOND = 1000
const CLOSED_DELAY = 60 * SECOND
const OFF_DELAY = 5 * 60 * SECOND
const RETRY_DELAY = 20 * SECOND

/** Milliseconds until the next useful fetch for this snapshot. */
export function nextDelay(snapshot: LiveSnapshot, now = Date.now()) {
  const interval = Math.max(snapshot.poll_seconds, 5) * SECOND
  switch (snapshot.state) {
    case 'live':
    case 'starting': {
      const next = snapshot.next_poll_at
        ? Date.parse(snapshot.next_poll_at)
        : NaN
      // Fetch shortly after the server's next poll should have finished.
      const delay = Number.isFinite(next) ? next - now + 2 * SECOND : interval
      return Math.min(Math.max(delay, 2 * SECOND), interval + 5 * SECOND)
    }
    case 'error':
      return Math.max(RETRY_DELAY, interval)
    case 'closed':
    case 'settled':
      return CLOSED_DELAY
    default:
      return OFF_DELAY
  }
}

/* One fetch loop for the whole app, shared by every component that reads it. */
interface LiveStoreState {
  snapshot: LiveSnapshot | null
  failed: boolean
}
let state: LiveStoreState = { snapshot: null, failed: false }
const SERVER_STATE: LiveStoreState = { snapshot: null, failed: false }
const listeners = new Set<() => void>()
let timer: number | undefined
let controller: AbortController | undefined

function publish(next: LiveStoreState) {
  state = next
  listeners.forEach((listener) => listener())
}

function schedule(delay: number) {
  window.clearTimeout(timer)
  if (listeners.size) timer = window.setTimeout(load, delay)
}

async function load() {
  if (!listeners.size || document.visibilityState === 'hidden') return
  controller?.abort()
  const current = new AbortController()
  controller = current
  try {
    const value = await fetchLive(current.signal)
    if (current.signal.aborted) return
    publish({ snapshot: value, failed: false })
    schedule(nextDelay(value))
  } catch {
    if (current.signal.aborted) return
    publish({ snapshot: state.snapshot, failed: true })
    schedule(RETRY_DELAY)
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') {
    window.clearTimeout(timer)
    void load()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', onVisible)
    void load()
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      window.clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }
}

/**
 * Latest live snapshot from the backend, refreshed just after each server poll.
 * Pauses while the tab is hidden and catches up as soon as it is visible.
 */
export function useLive() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  )
}

/** Re-render on an interval, for "updated 12 s ago" style labels. */
export function useNow(intervalMs = SECOND) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function ago(iso: string | null | undefined, now: number) {
  if (!iso) return null
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  const seconds = Math.max(0, Math.round((now - then) / SECOND))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds} s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

/** 14:05:32 in India time, whatever the viewer's own time zone. */
export function istTime(iso: string | null | undefined, seconds = true) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: false,
    timeZone: 'Asia/Kolkata',
  })
}
