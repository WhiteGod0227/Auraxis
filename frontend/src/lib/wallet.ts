import { env } from './env'

/** Optional wallet link: Sign-In with Ethereum (EIP-4361) via EIP-1193. */

export interface LinkedWallet {
  address: string
  chain_id: number
  linked_at: string
  explorer_url: string
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider
  }
}

const base = () => env.apiBaseUrl.replace(/\/$/, '')

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base()}/api/wallet${path}`, {
      credentials: 'include',
      cache: 'no-store',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch (error) {
    throw new Error("Can't reach the backend. Is it running?", {
      cause: error,
    })
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : `Wallet request failed (HTTP ${response.status}).`,
    )
  }
  return (await response.json()) as T
}

export const walletApi = {
  get: () => call<{ wallet: LinkedWallet | null }>(''),
  challenge: (address: string, chainId: number) =>
    call<{ nonce: string; message: string; expires_at: string }>('/challenge', {
      method: 'POST',
      body: JSON.stringify({ address, chain_id: chainId }),
    }),
  link: (nonce: string, signature: string) =>
    call<{ wallet: LinkedWallet }>('/link', {
      method: 'POST',
      body: JSON.stringify({ nonce, signature }),
    }),
  unlink: () => call<{ wallet: null }>('', { method: 'DELETE' }),
}

export const hasWallet = () =>
  typeof window !== 'undefined' && Boolean(window.ethereum)

/** UTF-8 text as a 0x-hex string, as personal_sign expects. */
export function toHex(text: string) {
  return (
    '0x' +
    Array.from(new TextEncoder().encode(text))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  )
}

/** Ask the wallet for an account, have it sign the challenge, then link. */
export async function connectWallet(): Promise<LinkedWallet> {
  const provider = window.ethereum
  if (!provider) throw new Error('No Ethereum wallet found in this browser.')
  let accounts: unknown
  try {
    accounts = await provider.request({ method: 'eth_requestAccounts' })
  } catch (error) {
    throw new Error('Wallet connection was cancelled.', { cause: error })
  }
  const address = Array.isArray(accounts) ? accounts[0] : null
  if (typeof address !== 'string')
    throw new Error('The wallet did not share an account.')
  const chainHex = await provider.request({ method: 'eth_chainId' })
  const chainId =
    typeof chainHex === 'string' ? Number.parseInt(chainHex, 16) : 1
  const { nonce, message } = await walletApi.challenge(
    address,
    Number.isFinite(chainId) && chainId > 0 ? chainId : 1,
  )
  let signature: unknown
  try {
    signature = await provider.request({
      method: 'personal_sign',
      params: [toHex(message), address],
    })
  } catch (error) {
    throw new Error('Signing was cancelled. Nothing was linked.', {
      cause: error,
    })
  }
  if (typeof signature !== 'string')
    throw new Error('The wallet returned no signature.')
  return (await walletApi.link(nonce, signature)).wallet
}

export const shortWallet = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`

export const chainName = (id: number) =>
  ({
    1: 'Ethereum',
    8453: 'Base',
    84532: 'Base Sepolia',
    11155111: 'Sepolia',
    137: 'Polygon',
    10: 'Optimism',
    42161: 'Arbitrum',
  })[id] ?? `Chain ${id}`
