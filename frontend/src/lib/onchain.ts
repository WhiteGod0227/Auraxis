import { env } from './env'

/** Read-only on-chain gold data (tokenized gold vs MCX). */

export interface OnchainToken {
  symbol: string
  name: string
  issuer: string
  chain: string
  contract: string
  explorer_url: string
  price_inr: number | null
  price_usd: number | null
  price_updated_at: string | null
  parity_p10: number | null
  supply_tokens: number | null
  supply_tonnes: number | null
  supply_read_at: string | null
}

export interface OnchainMcx {
  product: string
  expiry: string | null
  price_p10: number
  source: 'live' | 'settlement'
  as_of: string | null
}

export interface OnchainComparison {
  product: string
  token: string
  mcx_p10: number
  parity_p10: number
  gap: number
  gap_pct: number
}

export interface OnchainGold {
  updated_at: string | null
  errors: string[]
  duty_pct: number
  duty_schedule: { start: string; pct: number }[]
  tokens: OnchainToken[]
  mcx: OnchainMcx[]
  comparisons: OnchainComparison[]
  assumptions: string[]
}

export interface OnchainHistoryPoint {
  date: string
  expiry: string
  mcx_p10: number
  duty_pct: number
  PAXG_parity: number | null
  PAXG_gap: number | null
  XAUT_parity: number | null
  XAUT_gap: number | null
}

export interface OnchainHistory {
  product: string
  days: number
  points: OnchainHistoryPoint[]
}

const base = () => env.apiBaseUrl.replace(/\/$/, '')

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base()}/api/onchain${path}`, {
      cache: 'no-store',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error("Can't reach the backend. Is it running?", {
      cause: error,
    })
  }
  if (response.status === 404)
    throw new Error('On-chain data is turned off on this server.')
  if (!response.ok)
    throw new Error(`On-chain data unavailable (HTTP ${response.status}).`)
  return (await response.json()) as T
}

export const onchainApi = {
  gold: (signal?: AbortSignal) => get<OnchainGold>('/gold', signal),
  history: (product: string, signal?: AbortSignal) =>
    get<OnchainHistory>(
      `/history?product=${encodeURIComponent(product)}&days=365`,
      signal,
    ),
}

export const shortAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`
