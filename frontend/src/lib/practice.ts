import { useSyncExternalStore } from 'react'
import { env } from './env'

/** Practice trading with demo money (no cash value). */

export type PracticeKind = 'product' | 'pair'
export type PracticeSide = 'buy' | 'sell' | 'rise' | 'fall'

export interface PracticePosition {
  id: number
  kind: PracticeKind
  instrument: string
  expiry: string
  side: PracticeSide
  grams: number
  entry_a: number
  entry_b: number | null
  entry_z: number | null
  entry_cost: number
  margin: number
  opened_at: string
  status: 'open' | 'closed'
  mark_a?: number
  mark_b?: number | null
  mark_source?: 'live' | 'settlement' | 'entry'
  open_pnl?: number
  net_if_closed?: number
  exit_a?: number
  exit_b?: number | null
  exit_cost?: number
  gross?: number
  net?: number
  closed_at?: string
  close_reason?: 'manual' | 'expired'
}

export interface PracticeProduct {
  product: string
  expiry: string | null
  lot: number
  price: number | null
  tradable: boolean
}

export interface PracticePair {
  pair: string
  expiry: string | null
  lot: number
  price_a: number | null
  price_b: number | null
  gap: number | null
  z: number | null
  suggested: 'rise' | 'fall' | null
  tradable: boolean
}

export interface PracticeSummary {
  currency: string
  start_balance: number
  balance: number
  open_pnl: number
  margin_in_use: number
  equity: number
  available: number
  return_pct: number
  resets: number
  market: {
    can_trade: boolean
    reason: string
    trade_date: string | null
    updated_at: string | null
  }
  limits: {
    max_grams: number
    max_open: number
    margin_pct: number
    cost_bps: number
  }
  instruments: { products: PracticeProduct[]; pairs: PracticePair[] }
  positions: PracticePosition[]
  history: PracticePosition[]
  stats: {
    trades: number
    wins: number
    win_rate: number | null
    realized: number
    best: number | null
    worst: number | null
  }
  week: { trades: number; wins: number; realized: number }
  achievements: {
    code: string
    title: string
    description: string
    earned_at: string | null
  }[]
  profile: { display_name: string | null; leaderboard: boolean }
}

export interface LeaderboardEntry {
  name: string
  return_pct: number
  trades: number
  you: boolean
  rank: number
}

const base = () => env.apiBaseUrl.replace(/\/$/, '')

async function call<T>(
  path: string,
  init: RequestInit = {},
  fallback = 'Practice service unavailable.',
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base()}/api/practice${path}`, {
      credentials: 'include',
      cache: 'no-store',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new PracticeError("Can't reach the backend. Is it running?", 0)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail =
      typeof body?.detail === 'string'
        ? body.detail
        : response.status === 401
          ? 'Log in to use demo money.'
          : response.status === 422
            ? 'Check the trade details and try again.'
            : fallback
    throw new PracticeError(detail, response.status)
  }
  return (await response.json()) as T
}

export class PracticeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'PracticeError'
  }
}

export const practiceApi = {
  summary: (signal?: AbortSignal) => call<PracticeSummary>('', { signal }),
  order: (body: {
    request_id: string
    kind: PracticeKind
    instrument: string
    side: PracticeSide
    grams: number
  }) =>
    call<PracticePosition>('/orders', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  close: (id: number) =>
    call<{ id: number; net: number; gross: number; exit_cost: number }>(
      `/positions/${id}/close`,
      { method: 'POST' },
    ),
  reset: () =>
    call<{ balance: number }>('/reset', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    }),
  profile: (body: { leaderboard: boolean; display_name: string | null }) =>
    call<{ leaderboard: boolean; display_name: string | null }>('/profile', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  leaderboard: () =>
    call<{ entries: LeaderboardEntry[]; you: LeaderboardEntry | null }>(
      '/leaderboard',
    ),
}

export function newRequestId() {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `req-${random}`
}

/* ------------------------------------------------------------------------ */
/* Shared store: one summary for the top-bar chip and the Practice page.    */
/* ------------------------------------------------------------------------ */

export type PracticeStatus =
  'idle' | 'loading' | 'ready' | 'signed-out' | 'error'

interface PracticeState {
  status: PracticeStatus
  summary: PracticeSummary | null
  error: string | null
}

const SERVER_STATE: PracticeState = {
  status: 'idle',
  summary: null,
  error: null,
}
let state: PracticeState = SERVER_STATE
const listeners = new Set<() => void>()
let timer: number | undefined
let controller: AbortController | undefined
const REFRESH_MS = 30_000

function publish(next: PracticeState) {
  state = next
  listeners.forEach((listener) => listener())
}

export async function refreshPractice() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden')
    return
  controller?.abort()
  const current = new AbortController()
  controller = current
  if (!state.summary) publish({ ...state, status: 'loading' })
  try {
    const summary = await practiceApi.summary(current.signal)
    if (current.signal.aborted) return
    publish({ status: 'ready', summary, error: null })
  } catch (error) {
    if (current.signal.aborted) return
    if (error instanceof PracticeError && error.status === 401)
      publish({ status: 'signed-out', summary: null, error: null })
    else
      publish({
        status: state.summary ? 'ready' : 'error',
        summary: state.summary,
        error: error instanceof Error ? error.message : 'Unavailable.',
      })
  } finally {
    window.clearTimeout(timer)
    if (listeners.size) timer = window.setTimeout(refreshPractice, REFRESH_MS)
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') void refreshPractice()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', onVisible)
    void refreshPractice()
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

export function usePractice() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  )
}

/** Forget the cached summary (for example after signing out). */
export function clearPractice() {
  controller?.abort()
  publish({ status: 'idle', summary: null, error: null })
}

/* ------------------------------------------------------------------------ */
/* Formatting                                                               */
/* ------------------------------------------------------------------------ */

const demo = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const demo2 = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** "◎ 9,84,200" — demo money, deliberately not shown with the ₹ sign. */
export const demoMoney = (value: number | null | undefined, exact = false) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `◎ ${(exact ? demo2 : demo).format(value)}`
    : '—'

export const signedDemo = (value: number | null | undefined, exact = false) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const text = (exact ? demo2 : demo).format(Math.abs(value))
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}◎ ${text}`
}

export const sideLabel = (kind: PracticeKind, side: PracticeSide) =>
  kind === 'product'
    ? side === 'buy'
      ? 'Buy'
      : 'Sell'
    : side === 'rise'
      ? 'Gap to rise'
      : 'Gap to fall'
