import { env } from './env'

/** Proof of research: Bitcoin-anchored fingerprints (OpenTimestamps). */

export type ProofStatus =
  'queued' | 'submitting' | 'pending' | 'confirmed' | 'failed'

export interface ProofSummary {
  id: number
  kind: 'practice_trade' | 'research' | string
  title: string
  created_at: string
  status: ProofStatus
  batch_id: number | null
  bitcoin_height: number | null
  bitcoin_time: string | null
}

export interface ProofBundle {
  format: string
  record: {
    id: number
    kind: string
    title: string
    created_at: string
    content: Record<string, unknown>
  }
  salt: string
  leaf: string
  status: ProofStatus
  path: { hash: string; side: 'left' | 'right' }[] | null
  root: string | null
  batch: {
    id: number
    created_at: string
    document: string
    ots_base64: string | null
    calendars: string[]
    bitcoin_height: number | null
    bitcoin_time: string | null
    evm?: {
      network: string
      chain_id: number
      contract: string | null
      tx: string
      tx_url: string
      status: 'pending' | 'confirmed' | 'failed' | null
      block: number | null
    } | null
  } | null
}

export interface VerifyResult {
  valid: boolean
  anchored?: boolean
  bitcoin?: { height: number; time: string } | null
  checks: { name: string; ok: boolean; detail: string }[]
}

const base = () => env.apiBaseUrl.replace(/\/$/, '')

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base()}/api/proofs${path}`, {
      credentials: 'include',
      cache: 'no-store',
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    })
  } catch (error) {
    throw new Error("Can't reach the backend. Is it running?", {
      cause: error,
    })
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ProofError(
      typeof body?.detail === 'string'
        ? body.detail
        : response.status === 401
          ? 'Log in to see your proofs.'
          : `Proof service unavailable (HTTP ${response.status}).`,
      response.status,
    )
  }
  return (await response.json()) as T
}

export class ProofError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ProofError'
  }
}

export const proofsApi = {
  list: () => call<{ batch_minutes: number; proofs: ProofSummary[] }>(''),
  get: (id: number) => call<ProofBundle>(`/${id}`),
  certifyResearch: (workspaceId: string) =>
    call<{ id: number; status: string }>(
      `/research/${encodeURIComponent(workspaceId)}`,
      { method: 'POST' },
    ),
  verify: (text: string) =>
    call<VerifyResult>('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text,
    }),
}

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export const statusLabel: Record<ProofStatus, string> = {
  queued: 'Queued',
  submitting: 'Sealing',
  pending: 'Waiting for Bitcoin',
  confirmed: 'Anchored in Bitcoin',
  failed: 'Retrying',
}
