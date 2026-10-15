import {
  isoDate,
  parseDataHealth,
  parseMeta,
  parseOverview,
  parsePrices,
  parseSpreads,
  parseBacktest,
  parseCurve,
  parseRolldown,
  recordObject,
} from './schemas'
import type {
  SpreadParameters,
  BacktestParameters,
  CurveParameters,
  RolldownParameters,
  ParameterValue,
  Parameters,
  SourcedResponse,
  Validator,
  OverviewParameters,
  PricesParameters,
  DataHealthParameters,
} from './types'

export type ErrorKind =
  | 'http'
  | 'invalid-response'
  | 'offline-unavailable'
  | 'manifest'
  | 'snapshot'
  | 'cancelled'
  | 'parameters'
export class ClientError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ClientError'
  }
}
const defaults: Record<string, Record<string, ParameterValue>> = {
  '/api/meta': {},
  '/api/overview': { purity: false },
  '/api/prices': { product: null, purity: false },
  '/api/data-health': { min_volume_grams: 2000, diagnostic_limit: 20 },
  '/api/spreads': {
    pair: '',
    expiry: null,
    start: null,
    end: null,
    window: 10,
    min_periods: 5,
    carry_adjusted: true,
    purity: false,
    min_volume_grams: 2000,
    min_oi_grams: 0,
  },
  '/api/curve': { product: '', date: null, purity: false },
  '/api/rolldown': {
    product: '',
    expiry: null,
    start: null,
    end: null,
    purity: false,
  },
  '/api/backtest': {
    pair: '',
    expiry: null,
    window: 10,
    min_periods: 5,
    z_entry: 1,
    z_exit: 0.25,
    max_hold_sessions: 5,
    expiry_buffer_calendar_days: 3,
    min_volume_grams: 2000,
    min_oi_grams: 0,
    notional_per_leg: 1000000,
    cost_bps_per_leg_per_side: 5,
    purity: false,
    sizing_mode: 'fractional',
  },
}
export function canonicalParameters(
  endpoint: string,
  supplied: Parameters = {},
  overrides?: Record<string, ParameterValue>,
) {
  const base = overrides ?? defaults[endpoint]
  if (!base) throw new ClientError('parameters', 'Unsupported endpoint.')
  const result: Record<string, ParameterValue> = { ...base }
  for (const [key, value] of Object.entries(supplied)) {
    if (!Object.hasOwn(base, key))
      throw new ClientError('parameters', `Unknown parameter: ${key}.`)
    if (value !== undefined) result[key] = value
  }
  for (const [key, value] of Object.entries(result)) {
    if (value === null && base[key] === null) continue
    const expected = typeof base[key]
    if (
      (expected !== 'object' && typeof value !== expected) ||
      (typeof value === 'number' && !Number.isFinite(value))
    )
      throw new ClientError('parameters', `Invalid parameter: ${key}.`)
    if (['date', 'start', 'end', 'expiry'].includes(key) && !isoDate(value))
      throw new ClientError('parameters', 'Dates must use ISO YYYY-MM-DD.')
    if (
      base[key] === null &&
      !['date', 'start', 'end', 'expiry', 'product'].includes(key)
    )
      throw new ClientError('parameters', 'Invalid parameter.')
    if (base[key] === null && typeof value !== 'string')
      throw new ClientError('parameters', `Invalid parameter: ${key}.`)
  }
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  )
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (recordObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
interface Entry {
  endpoint: string
  parameters: Record<string, ParameterValue>
  path: string
  request_key: string
  sha256: string
  size_bytes: number
}
export interface SnapshotManifest {
  snapshot_schema_version: number
  generated_at_utc: string
  data_as_of: string | null
  data_window: {
    first_trade_date: string | null
    last_trade_date: string | null
  }
  files: Entry[]
  supported_offline_configurations: string[]
  purity_verification_status: string
  limitations: string[]
}
function parseManifest(value: unknown): SnapshotManifest {
  if (
    !recordObject(value) ||
    value.snapshot_schema_version !== 1 ||
    typeof value.generated_at_utc !== 'string' ||
    !value.generated_at_utc.endsWith('Z') ||
    !Number.isFinite(Date.parse(value.generated_at_utc)) ||
    !(value.data_as_of === null || isoDate(value.data_as_of)) ||
    !recordObject(value.data_window) ||
    ![
      value.data_window.first_trade_date,
      value.data_window.last_trade_date,
    ].every((v) => v === null || isoDate(v)) ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.supported_offline_configurations) ||
    !value.supported_offline_configurations.every(
      (v) => typeof v === 'string',
    ) ||
    typeof value.purity_verification_status !== 'string' ||
    !Array.isArray(value.limitations) ||
    !value.limitations.every((v) => typeof v === 'string')
  )
    throw new ClientError(
      'manifest',
      'Snapshot manifest is invalid or has an unsupported schema version. Refresh the snapshot export.',
    )
  const keys = new Set<string>()
  for (const entry of value.files) {
    if (
      !recordObject(entry) ||
      typeof entry.endpoint !== 'string' ||
      !defaults[entry.endpoint] ||
      !recordObject(entry.parameters) ||
      !Object.values(entry.parameters).every(
        (v) =>
          v === null ||
          typeof v === 'string' ||
          typeof v === 'boolean' ||
          (typeof v === 'number' && Number.isFinite(v)),
      ) ||
      typeof entry.path !== 'string' ||
      !/^versions\/(?:[A-Za-z0-9_-]+)\/[A-Za-z0-9_-]+\.json$/.test(
        entry.path,
      ) ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.size_bytes) ||
      (entry.size_bytes as number) < 1 ||
      typeof entry.request_key !== 'string'
    )
      throw new ClientError(
        'manifest',
        'Snapshot manifest contains an invalid or unsafe entry.',
      )
    let parsed: unknown
    try {
      parsed = JSON.parse(entry.request_key)
    } catch {
      throw new ClientError('manifest', 'Snapshot request key is corrupt.')
    }
    try {
      if (
        stable(
          canonicalParameters(entry.endpoint, entry.parameters as Parameters),
        ) !== stable(entry.parameters)
      )
        throw new Error('Incomplete parameters')
    } catch {
      throw new ClientError(
        'manifest',
        'Snapshot parameters are invalid or incomplete.',
      )
    }
    const key = stable({
      endpoint: entry.endpoint,
      parameters: entry.parameters,
    })
    if (
      stable(parsed) !== key ||
      keys.has(key) ||
      !value.supported_offline_configurations.includes(entry.request_key)
    )
      throw new ClientError(
        'manifest',
        'Snapshot configuration index is inconsistent.',
      )
    keys.add(key)
  }
  if (value.supported_offline_configurations.length !== value.files.length)
    throw new ClientError(
      'manifest',
      'Snapshot configuration count is inconsistent.',
    )
  return value as unknown as SnapshotManifest
}
interface Options {
  baseUrl?: string
  snapshotBaseUrl?: string
  timeoutMs?: number
  fetcher?: typeof fetch
}
export function createApiClient(options: Options = {}) {
  const base = (
    options.baseUrl ??
    (import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8010')
  ).replace(/\/$/, '')
  const snapshotBase =
    options.snapshotBaseUrl ?? `${import.meta.env?.BASE_URL ?? '/'}snapshots/`
  const fetcher = options.fetcher ?? fetch
  const timeoutMs = options.timeoutMs ?? 8000
  async function download(
    url: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const controller = new AbortController()
    const cancel = () => controller.abort()
    if (signal?.aborted)
      throw new ClientError('cancelled', 'Request cancelled.')
    signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(cancel, timeoutMs)
    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok)
        throw new ClientError(
          'http',
          `Request failed (HTTP ${response.status}). Retry or check the backend.`,
          response.status,
        )
      return new Uint8Array(await response.arrayBuffer())
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
  }
  function decode(bytes: Uint8Array): unknown {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  }
  async function offline<T>(
    endpoint: string,
    supplied: Parameters,
    validate: Validator<T>,
    signal?: AbortSignal,
  ): Promise<SourcedResponse<T>> {
    let manifest: SnapshotManifest
    try {
      manifest = parseManifest(
        decode(await download(`${snapshotBase}manifest.json`, signal)),
      )
    } catch (e) {
      if (signal?.aborted)
        throw new ClientError('cancelled', 'Request cancelled.')
      if (e instanceof ClientError && e.kind === 'manifest') throw e
      throw new ClientError(
        'manifest',
        'Offline manifest is unavailable or corrupt. Serve the frontend and regenerate snapshots.',
      )
    }
    const overrides =
      endpoint === '/api/data-health'
        ? manifest.files.find((e) => e.endpoint === endpoint)?.parameters
        : undefined
    const params = canonicalParameters(endpoint, supplied, overrides)
    const key = stable({ endpoint, parameters: params })
    const entry = manifest.files.find(
      (e) => stable({ endpoint: e.endpoint, parameters: e.parameters }) === key,
    )
    if (!entry)
      throw new ClientError(
        'offline-unavailable',
        'This exact configuration is unavailable offline. Restore the backend or choose a supported snapshot configuration.',
      )
    try {
      const bytes = await download(`${snapshotBase}${entry.path}`, signal)
      if (!globalThis.crypto?.subtle)
        throw new Error('Integrity verification requires a secure context.')
      const checksum = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            bytes as Uint8Array<ArrayBuffer>,
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      if (bytes.length !== entry.size_bytes || checksum !== entry.sha256)
        throw new Error('Checksum mismatch.')
      const payload = decode(bytes)
      const data = validate(payload)
      if (!recordObject(payload) || payload.data_as_of !== manifest.data_as_of)
        throw new Error('Historical dates differ.')
      if (signal?.aborted)
        throw new ClientError('cancelled', 'Request cancelled.')
      return {
        data,
        source: 'Offline snapshot',
        generatedAt: manifest.generated_at_utc,
      }
    } catch {
      if (signal?.aborted)
        throw new ClientError('cancelled', 'Request cancelled.')
      throw new ClientError(
        'snapshot',
        'Offline snapshot is missing, corrupt or incompatible. Regenerate snapshots.',
      )
    }
  }
  async function request<T>(
    endpoint: string,
    supplied: Parameters,
    validate: Validator<T>,
    signal?: AbortSignal,
  ): Promise<SourcedResponse<T>> {
    canonicalParameters(endpoint, supplied)
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(supplied))
      if (value !== undefined && value !== null) query.set(key, String(value))
    let bytes: Uint8Array
    try {
      bytes = await download(
        `${base}${endpoint}${query.size ? `?${query}` : ''}`,
        signal,
      )
    } catch (e) {
      if (signal?.aborted)
        throw new ClientError('cancelled', 'Request cancelled.')
      if (e instanceof ClientError) throw e
      if (
        e instanceof TypeError ||
        (e instanceof Error && ['AbortError', 'TimeoutError'].includes(e.name))
      )
        return offline(endpoint, supplied, validate, signal)
      throw new ClientError(
        'invalid-response',
        'API request failed unexpectedly. No snapshot substituted.',
      )
    }
    try {
      const data = validate(decode(bytes))
      if (signal?.aborted)
        throw new ClientError('cancelled', 'Request cancelled.')
      return { data, source: 'API' }
    } catch (e) {
      if (e instanceof ClientError) throw e
      throw new ClientError(
        'invalid-response',
        'API returned malformed or incompatible data. No snapshot substituted.',
      )
    }
  }
  return {
    request,
    snapshotCatalog: async (
      signal?: AbortSignal,
    ): Promise<SourcedResponse<SnapshotManifest>> => {
      try {
        const data = parseManifest(
          decode(await download(`${snapshotBase}manifest.json`, signal)),
        )
        return {
          data,
          source: 'Offline snapshot',
          generatedAt: data.generated_at_utc,
        }
      } catch (error) {
        if (signal?.aborted)
          throw new ClientError('cancelled', 'Request cancelled.')
        if (error instanceof ClientError && error.kind === 'manifest')
          throw error
        throw new ClientError(
          'manifest',
          'Snapshot configuration metadata is unavailable or corrupt.',
        )
      }
    },
    backtest: (parameters: BacktestParameters, signal?: AbortSignal) =>
      request(
        '/api/backtest',
        parameters,
        (value) => {
          const data = parseBacktest(value)
          const expected = canonicalParameters('/api/backtest', parameters)
          const matches = (
            configuration:
              | typeof data.configuration
              | (typeof data.reports)[number]['configuration'],
          ) =>
            Object.entries(expected).every(
              ([key, value]) =>
                key === 'expiry' ||
                configuration[
                  key === 'purity'
                    ? 'use_purity_adjustment'
                    : (key as keyof typeof configuration)
                ] === value,
            )
          if (
            data.configuration.requested_expiry !== null ||
            !matches(data.configuration) ||
            data.reports.some(
              (report) =>
                !matches(report.configuration) ||
                [
                  ...report.completed_trades,
                  ...report.open_positions,
                  ...report.unresolved_positions,
                  ...report.pending_orders,
                  ...report.order_events,
                  ...report.diagnostics,
                ].some(
                  (row) =>
                    row.expiry !== report.expiry ||
                    row.pair !== parameters.pair,
                ),
            )
          )
            throw new Error(
              'Backtest does not match requested configuration or independent expiry.',
            )
          return data
        },
        signal,
      ),
    curve: (parameters: CurveParameters, signal?: AbortSignal) =>
      request(
        '/api/curve',
        parameters,
        (value) => {
          const data = parseCurve(value)
          if (
            data.configuration.product !== parameters.product ||
            data.configuration.use_purity_adjustment !==
              (parameters.purity ?? false) ||
            data.configuration.date !== (parameters.date ?? null) ||
            (parameters.date != null &&
              data.selected_date !== parameters.date) ||
            data.points.some(
              (p) =>
                p.product !== parameters.product ||
                p.trade_date !== data.selected_date,
            )
          )
            throw new Error('Curve does not match requested configuration.')
          return data
        },
        signal,
      ),
    rolldown: (parameters: RolldownParameters, signal?: AbortSignal) =>
      request(
        '/api/rolldown',
        parameters,
        (value) => {
          const data = parseRolldown(value)
          if (
            data.configuration.product !== parameters.product ||
            data.configuration.use_purity_adjustment !==
              (parameters.purity ?? false) ||
            data.configuration.expiry !== null ||
            data.configuration.start !== null ||
            data.configuration.end !== null ||
            data.series.some((s) =>
              s.rows.some(
                (r) =>
                  r.product !== parameters.product ||
                  r.expiry_date !== s.expiry_date,
              ),
            )
          )
            throw new Error('Roll-down does not match requested configuration.')
          return data
        },
        signal,
      ),
    spreads: (parameters: SpreadParameters, signal?: AbortSignal) =>
      request('/api/spreads', parameters, parseSpreads, signal),
    meta: (signal?: AbortSignal) => request('/api/meta', {}, parseMeta, signal),
    overview: (parameters: OverviewParameters = {}, signal?: AbortSignal) =>
      request('/api/overview', parameters, parseOverview, signal),
    prices: (parameters: PricesParameters = {}, signal?: AbortSignal) =>
      request('/api/prices', parameters, parsePrices, signal),
    dataHealth: (parameters: DataHealthParameters = {}, signal?: AbortSignal) =>
      request('/api/data-health', parameters, parseDataHealth, signal),
  }
}
export const api = createApiClient()
