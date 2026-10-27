import { env } from './env'
import { session } from './auth'
import { canonicalParameters } from './api'
import { isoDate, recordObject } from './schemas'
import type {
  SpreadParameters,
  CurveParameters,
  RolldownParameters,
  BacktestParameters,
  SpreadsResponse,
  CurveResponse,
  RolldownResponse,
  BacktestResponse,
  SourcedResponse,
} from './types'

function object(value: unknown, label: string): Record<string, unknown> {
  if (!recordObject(value)) throw new Error(`Invalid ${label}.`)
  return value as Record<string, unknown>
}
function dateValue(value: unknown): string {
  if (!isoDate(value)) throw new Error('Invalid workspace ISO date.')
  return value as string
}

export type Selection =
  { mode: 'latest'; value: null } | { mode: 'explicit'; value: string }
export type ResearchConfiguration =
  | { kind: 'relative_value'; query: SpreadParameters; expiry: Selection }
  | {
      kind: 'term_structure'
      curve: CurveParameters
      roll: RolldownParameters
      curve_expiry: Selection
      roll_expiry: Selection
    }
  | { kind: 'backtest'; query: BacktestParameters; expiry: Selection }
export interface SaveResearch {
  title: string
  notes: string
  configuration_version: 1
  configuration: ResearchConfiguration
  saved_context: {
    data_as_of: string | null
    source: 'API' | 'Offline snapshot'
  }
}
export interface Workspace extends SaveResearch {
  id: string
  owner_id: number
  revision: number
  created_at: string
  updated_at: string
}
export interface WorkspaceList {
  items: Workspace[]
  total: number
  limit: number
  offset: number
}
export const selection = (value?: string | null): Selection =>
  value ? { mode: 'explicit', value } : { mode: 'latest', value: null }
export function restoredExpiry(
  values: string[],
  preferred: Selection | undefined,
  fallback: () => string | undefined,
) {
  return preferred?.mode === 'explicit'
    ? values.includes(preferred.value)
      ? preferred.value
      : undefined
    : fallback()
}
export const researchRoutes = {
  relative_value: '/app/relative-value',
  term_structure: '/app/term-structure',
  backtest: '/app/backtest',
} as const
export function workspaceRoute(workspace: Workspace) {
  return `${researchRoutes[workspace.configuration.kind]}?workspace=${encodeURIComponent(workspace.id)}`
}
export function safeReturn(value: string | null) {
  if (!value) return '/'
  try {
    const url = new URL(value, 'https://auraxis.invalid')
    const allowed = [
      '/app/profile',
      '/app/research',
      ...Object.values(researchRoutes),
    ]
    return url.origin === 'https://auraxis.invalid' &&
      allowed.includes(url.pathname) &&
      [...url.searchParams.keys()].every((key) => key === 'workspace')
      ? url.pathname + url.search
      : '/'
  } catch {
    return '/'
  }
}
function parseSelection(value: unknown): Selection {
  const s = object(value, 'workspace selection')
  if (s.mode === 'latest' && s.value === null)
    return { mode: 'latest', value: null }
  if (s.mode === 'explicit')
    return { mode: 'explicit', value: dateValue(s.value) }
  throw new Error(
    'Incompatible workspace selection. Recreate it from the analysis page.',
  )
}
export function parseWorkspace(value: unknown): Workspace {
  const w = object(value, 'workspace')
  if (w.configuration_version !== 1)
    throw new Error(
      'Unsupported workspace version. Recreate it from the analysis page.',
    )
  if (
    typeof w.id !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(w.id) ||
    !Number.isInteger(w.owner_id) ||
    !Number.isInteger(w.revision) ||
    Number(w.revision) < 1 ||
    typeof w.title !== 'string' ||
    !w.title.trim() ||
    w.title.length > 120 ||
    typeof w.notes !== 'string' ||
    w.notes.length > 5000 ||
    typeof w.created_at !== 'string' ||
    !Number.isFinite(Date.parse(w.created_at)) ||
    typeof w.updated_at !== 'string' ||
    !Number.isFinite(Date.parse(w.updated_at))
  )
    throw new Error('Invalid workspace response.')
  const context = object(w.saved_context, 'saved context')
  if (!['API', 'Offline snapshot'].includes(String(context.source)))
    throw new Error('Invalid workspace source.')
  if (context.data_as_of !== null) dateValue(context.data_as_of)
  const c = object(w.configuration, 'workspace configuration')
  const query = (endpoint: string, value: unknown) => {
    const fields = object(value, 'workspace parameters')
    const defaults = canonicalParameters(endpoint)
    if (
      Object.keys(fields).length !== Object.keys(defaults).length ||
      Object.keys(defaults).some((key) => !Object.hasOwn(fields, key))
    )
      throw new Error(
        'Incomplete workspace settings. Recreate it from the analysis page.',
      )
    const result = canonicalParameters(
      endpoint,
      fields as Record<string, string | number | boolean | null>,
    )
    if (
      'product' in result &&
      !['GOLDM', 'GOLDTEN', 'GOLDGUINEA', 'GOLDPETAL'].includes(
        String(result.product),
      )
    )
      throw new Error('Unsupported workspace product.')
    if (
      'pair' in result &&
      ![
        'GOLDTEN-GOLDPETAL',
        'GOLDTEN-GOLDGUINEA',
        'GOLDGUINEA-GOLDPETAL',
        ...(endpoint === '/api/spreads'
          ? ['GOLDM-GOLDTEN', 'GOLDM-GOLDGUINEA', 'GOLDM-GOLDPETAL']
          : []),
      ].includes(String(result.pair))
    )
      throw new Error('Unsupported workspace pair.')
    if (
      'window' in result &&
      (!Number.isInteger(result.window) ||
        Number(result.window) < 1 ||
        Number(result.window) > 1000 ||
        !Number.isInteger(result.min_periods) ||
        Number(result.min_periods) < 1 ||
        Number(result.min_periods) > Number(result.window))
    )
      throw new Error('Invalid workspace rolling window.')
    if (
      'sizing_mode' in result &&
      !['fractional', 'integer_lots'].includes(String(result.sizing_mode))
    )
      throw new Error('Unsupported sizing mode.')
    if (result.start && result.end && String(result.start) > String(result.end))
      throw new Error('Invalid workspace date range.')
    for (const key of [
      'min_volume_grams',
      'min_oi_grams',
      'cost_bps_per_leg_per_side',
      'z_exit',
      'expiry_buffer_calendar_days',
    ])
      if (key in result && Number(result[key]) < 0)
        throw new Error('Invalid workspace thresholds.')
    if (
      'z_entry' in result &&
      (Number(result.z_entry) <= Number(result.z_exit) ||
        Number(result.notional_per_leg) <= 0 ||
        !Number.isInteger(result.max_hold_sessions) ||
        Number(result.max_hold_sessions) < 1 ||
        !Number.isInteger(result.expiry_buffer_calendar_days))
    )
      throw new Error('Invalid workspace simulation settings.')
    return result
  }
  let config: ResearchConfiguration
  if (c.kind === 'relative_value')
    config = {
      kind: c.kind,
      query: query('/api/spreads', c.query) as SpreadParameters,
      expiry: parseSelection(c.expiry),
    }
  else if (c.kind === 'term_structure')
    config = {
      kind: c.kind,
      curve: query('/api/curve', c.curve) as CurveParameters,
      roll: query('/api/rolldown', c.roll) as RolldownParameters,
      curve_expiry: parseSelection(c.curve_expiry),
      roll_expiry: parseSelection(c.roll_expiry),
    }
  else if (c.kind === 'backtest')
    config = {
      kind: c.kind,
      query: query('/api/backtest', c.query) as BacktestParameters,
      expiry: parseSelection(c.expiry),
    }
  else throw new Error('Unsupported research type. Recreate this workspace.')
  if (
    config.kind === 'term_structure' &&
    (config.curve.product !== config.roll.product ||
      config.curve.purity !== config.roll.purity)
  )
    throw new Error('Incompatible curve and roll-down settings.')
  return { ...w, configuration: config } as unknown as Workspace
}
export class WorkspaceError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
  }
}
export function createWorkspaceClient(
  base: string,
  fetcher: typeof fetch = fetch,
) {
  async function request(path: string, method = 'GET', body?: unknown) {
    const epoch = session.getSnapshot().epoch
    let response: Response
    try {
      response = await fetcher(
        `${base.replace(/\/$/, '')}/api/workspaces${path}`,
        {
          method,
          credentials: 'include',
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        },
      )
    } catch {
      throw new WorkspaceError(
        'Private research requires the backend. Retry when connected.',
      )
    }
    if (session.getSnapshot().epoch !== epoch)
      throw new WorkspaceError('Account changed. Reload My Research.')
    if (response.status === 401) session.set(null)
    if (response.status === 204) return null
    const value = await response.json().catch(() => null)
    if (!response.ok)
      throw new WorkspaceError(
        typeof value?.detail === 'string'
          ? value.detail
          : 'Workspace request failed. Retry.',
        response.status,
      )
    if (session.getSnapshot().epoch !== epoch)
      throw new WorkspaceError('Account changed. Reload My Research.')
    return value
  }
  return {
    create: async (value: SaveResearch) =>
      parseWorkspace(await request('', 'POST', value)),
    get: async (id: string) =>
      parseWorkspace(await request(`/${encodeURIComponent(id)}`)),
    list: async (offset = 0): Promise<WorkspaceList> => {
      const value = object(
        await request(`?limit=20&offset=${offset}`),
        'workspace list',
      )
      if (
        !Array.isArray(value.items) ||
        !Number.isInteger(value.total) ||
        value.limit !== 20 ||
        value.offset !== offset
      )
        throw new Error('Invalid workspace list.')
      return {
        items: value.items.map(parseWorkspace),
        total: Number(value.total),
        limit: 20,
        offset,
      }
    },
    update: async (
      id: string,
      revision: number,
      title: string,
      notes: string,
    ) =>
      parseWorkspace(
        await request(`/${encodeURIComponent(id)}`, 'PATCH', {
          revision,
          title,
          notes,
        }),
      ),
    delete: (id: string, revision: number) =>
      request(`/${encodeURIComponent(id)}?revision=${revision}`, 'DELETE'),
  }
}
export const workspaces = createWorkspaceClient(env.apiBaseUrl)

export function createExclusiveAction() {
  let busy = false
  return {
    get busy() {
      return busy
    },
    async run<T>(action: () => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined
      busy = true
      try {
        return await action()
      } finally {
        busy = false
      }
    },
  }
}

// Request keys come from the validated result configuration, not editable controls.
function appliedQuery(endpoint: string, configuration: object) {
  const c = configuration as Record<string, unknown>
  const defaults = canonicalParameters(endpoint)
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [
      key,
      key === 'purity'
        ? c.use_purity_adjustment
        : key === 'expiry' && 'requested_expiry' in c
          ? c.requested_expiry
          : (c[key] ?? defaults[key]),
    ]),
  ) as Record<string, string | number | boolean | null>
}
export function relativeConfiguration(
  data: SpreadsResponse,
  expiry?: string,
): ResearchConfiguration {
  return {
    kind: 'relative_value',
    query: appliedQuery('/api/spreads', data.configuration) as SpreadParameters,
    expiry: selection(expiry),
  }
}
export function termConfiguration(
  curve: CurveResponse,
  roll: RolldownResponse,
  point?: string,
  expiry?: string,
): ResearchConfiguration {
  return {
    kind: 'term_structure',
    curve: appliedQuery('/api/curve', curve.configuration) as CurveParameters,
    roll: appliedQuery(
      '/api/rolldown',
      roll.configuration,
    ) as RolldownParameters,
    curve_expiry: selection(point),
    roll_expiry: selection(expiry),
  }
}
export function backtestConfiguration(
  data: BacktestResponse,
  expiry?: string,
): ResearchConfiguration {
  return {
    kind: 'backtest',
    query: appliedQuery(
      '/api/backtest',
      data.configuration,
    ) as BacktestParameters,
    expiry: selection(expiry),
  }
}
export function researchCandidate<T extends { data_as_of: string | null }>(
  response: SourcedResponse<T> | undefined,
  loading: boolean,
  configuration: ResearchConfiguration | undefined,
) {
  return !loading && response && configuration
    ? {
        configuration_version: 1 as const,
        configuration,
        saved_context: {
          data_as_of: response.data.data_as_of,
          source: response.source,
        },
      }
    : undefined
}
