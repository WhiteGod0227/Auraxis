import { env } from './env'

/** Soulbound achievement badges on a test network (no monetary value). */

export interface BadgeState {
  code: string
  title: string
  description: string
  earned_at: string | null
  status: 'pending' | 'minted' | 'failed' | null
  address: string | null
  tx_url: string | null
  token_id: number | null
  token_url: string | null
  error: string
}

export interface BadgeList {
  enabled: boolean
  network: {
    name: string
    chain_id: number
    explorer: string
    contract: string | null
    contract_url: string | null
  }
  wallet: string | null
  badges: BadgeState[]
}

const base = () => env.apiBaseUrl.replace(/\/$/, '')

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base()}/api/badges${path}`, {
      credentials: 'include',
      cache: 'no-store',
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    })
  } catch (error) {
    throw new Error("Can't reach the backend. Is it running?", { cause: error })
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : `Badge request failed (HTTP ${response.status}).`,
    )
  }
  return (await response.json()) as T
}

export const badgesApi = {
  list: () => call<BadgeList>(''),
  claim: (code: string) =>
    call<{ status: string; tx_url: string | null }>(
      `/${encodeURIComponent(code)}/claim`,
      { method: 'POST' },
    ),
}
