import { env } from './env'

export interface RefreshRun {
  status: string
  started_at: string
  finished_at: string | null
  rows: number
  contracts: number
  latest_trade_date: string | null
  message: string
  trigger: string
}

export interface WatchEvent {
  file_name: string
  trade_date: string | null
  status: 'imported' | 'duplicate' | 'skipped' | 'failed'
  detail: string
  at: string
}

/** Auto-import of Bhavcopy files from a watched folder (e.g. Downloads). */
export interface WatchStatus {
  enabled: boolean
  folder: string | null
  last_import_at: string | null
  recent: WatchEvent[]
}

export interface DataSourceStatus {
  provider: string
  configured: boolean
  auto_refresh_hours: number
  refreshing: boolean
  latest_trade_date: string | null
  last_run: RefreshRun | null
  watch?: WatchStatus
}

export interface RefreshOutcome {
  status: string
  rows: number
  contracts: number
  latest_trade_date: string | null
  message: string
}

const base = () => env.apiBaseUrl.replace(/\/$/, '')

async function detail(response: Response, fallback: string) {
  const value = await response.json().catch(() => null)
  return typeof value?.detail === 'string' ? value.detail : fallback
}

export async function fetchDataStatus(
  signal?: AbortSignal,
): Promise<DataSourceStatus> {
  const response = await fetch(`${base()}/api/data/status`, {
    cache: 'no-store',
    signal,
  })
  if (!response.ok)
    throw new Error(await detail(response, 'Data status unavailable.'))
  return (await response.json()) as DataSourceStatus
}

export async function refreshMarketData(): Promise<RefreshOutcome> {
  let response: Response
  try {
    response = await fetch(`${base()}/api/data/refresh`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(180000),
    })
  } catch {
    throw new Error('Data server is unreachable. Is the backend running?')
  }
  if (response.status === 401) throw new Error('Log in to refresh market data.')
  if (!response.ok)
    throw new Error(await detail(response, 'Refresh failed. Please retry.'))
  return (await response.json()) as RefreshOutcome
}

export function formatTradeDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export interface UploadOutcome {
  file_name: string
  stored_as: string
  status: 'ok' | 'date_mismatch' | 'error' | 'no_gold_rows'
  trade_date: string | null
  rows_total: number
  rows_kept: number
  notes: string
}

/** Send one MCX Bhavcopy CSV as the raw request body. */
export async function uploadBhavcopy(file: File): Promise<UploadOutcome> {
  let response: Response
  try {
    response = await fetch(
      `${base()}/api/data/upload?filename=${encodeURIComponent(file.name)}`,
      {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'text/csv' },
        body: file,
        signal: AbortSignal.timeout(120000),
      },
    )
  } catch {
    throw new Error('Data server is unreachable. Is the backend running?')
  }
  if (response.status === 401) throw new Error('Log in to import data.')
  if (!response.ok)
    throw new Error(
      await detail(response, `Upload failed (HTTP ${response.status}).`),
    )
  return (await response.json()) as UploadOutcome
}
