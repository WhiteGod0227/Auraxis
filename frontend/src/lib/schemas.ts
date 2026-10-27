import type {
  SpreadsResponse,
  BacktestResponse,
  CurveResponse,
  RolldownResponse,
  DataHealthResponse,
  MetaResponse,
  OverviewResponse,
  PricesResponse,
  CoverageResponse,
} from './types'

type Shape = (value: unknown) => boolean
export const recordObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str: Shape = (v) => typeof v === 'string'
const num: Shape = (v) => typeof v === 'number' && Number.isFinite(v)
const bool: Shape = (v) => typeof v === 'boolean'
export const isoDate: Shape = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !v.startsWith('0000-') &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v
const nullable =
  (s: Shape): Shape =>
  (v) =>
    v === null || s(v)
const list =
  (s: Shape): Shape =>
  (v) =>
    Array.isArray(v) && v.every(s)
const record =
  (s: Shape): Shape =>
  (v) =>
    recordObject(v) && Object.values(v).every(s)
const object =
  (fields: Record<string, Shape>): Shape =>
  (v) =>
    recordObject(v) &&
    Object.entries(fields).every(
      ([key, s]) => Object.hasOwn(v, key) && s(v[key]),
    )
const base = {
  data_as_of: nullable(isoDate),
  data_available: bool,
  message: nullable(str),
}
const normalization = object({
  unit: str,
  basis: str,
  base_grams: num,
  base_purity: num,
  quote_grams: record(num),
  purity_assumptions: record(num),
  purity_verification_status: str,
  default_purity_adjustment: bool,
  comparison_basis_status: str,
  comparison_basis_warning: str,
})
const meta = object({
  ...base,
  first_trade_date: nullable(isoDate),
  last_trade_date: nullable(isoDate),
  trading_session_count: num,
  supported_products: list(str),
  available_products: list(str),
  contract_counts_by_product: record(num),
  prototype_window: bool,
  normalization,
})
const reference = object({
  product: str,
  reference_available: bool,
  selection_reason: str,
  expiry_date: nullable(isoDate),
  days_to_expiry: nullable(num),
  trade_date: nullable(isoDate),
  close_p10_raw: nullable(num),
  close_p10_999: nullable(num),
  volume_grams: nullable(num),
  open_interest_grams: nullable(num),
  has_trade: nullable(bool),
  previous_comparison_date: nullable(isoDate),
  day_change_abs: nullable(num),
  day_change_pct: nullable(num),
  change_quality: str,
  change_reason: str,
})
const upcoming = object({
  product: str,
  expiry_date: isoDate,
  days_to_expiry: num,
  has_trade: bool,
  volume_grams: nullable(num),
  open_interest_grams: nullable(num),
  quality_reason: str,
})
const overview = object({
  ...base,
  purity_adjustment: bool,
  normalization,
  reference_selection_rule: str,
  day_change_basis: str,
  references: list(reference),
  upcoming_expiries: list(upcoming),
})
const pricePoint = object({
  trade_date: isoDate,
  expiry_date: isoDate,
  close_p10_raw: nullable(num),
  close_p10_999: nullable(num),
  has_trade: bool,
  quality_reason: str,
})
const priceSeries = object({
  product: str,
  reference_available: bool,
  selection_reason: str,
  expiry_date: nullable(isoDate),
  history: list(pricePoint),
})
const prices = object({
  ...base,
  series_type: (v) => v === 'fixed_expiry',
  purity_adjustment: bool,
  normalization,
  reference_selection_rule: str,
  series: list(priceSeries),
})
const file = object({
  file_name: str,
  trade_date: nullable(isoDate),
  status: str,
  rows_total: num,
  rows_kept: num,
  notes_recorded: bool,
  notes_available: bool,
  error_summary: nullable(str),
  notes_unavailable_reason: str,
  recorded_dates_in_notes: list(isoDate),
})
const observation = object({
  product: str,
  trade_date: isoDate,
  expiry_date: isoDate,
  volume_grams: nullable(num),
  open_interest_grams: nullable(num),
  has_trade: bool,
})
const page = (item: Shape) =>
  object({
    available: bool,
    unavailable_reason: nullable(str),
    definition: str,
    total_count: num,
    returned_count: num,
    truncated: bool,
    items: list(item),
  })
const dataHealth = object({
  ...base,
  file_records_available: bool,
  recorded_file_count: num,
  file_status_counts: record(num),
  database_session_count: num,
  database_observation_count: num,
  zero_volume_counts_by_product: record(num),
  no_trade_counts_by_product: record(num),
  thin_volume_counts_by_product: record(num),
  min_volume_grams: num,
  diagnostic_limit: num,
  recorded_files: page(file),
  rejected_files: page(file),
  date_mismatch_files: page(file),
  no_trade_observations: page(observation),
  thin_volume_observations: page(observation),
  unavailable_diagnostics: record(object({ available: bool, reason: str })),
  assumptions: list(str),
})
function parse<T>(shape: Shape, value: unknown): T {
  if (!shape(value))
    throw new Error('Response does not match the expected schema.')
  return value as T
}
export const parseMeta = (v: unknown) => parse<MetaResponse>(meta, v)
export const parseOverview = (v: unknown) =>
  parse<OverviewResponse>(overview, v)
export const parsePrices = (v: unknown) => parse<PricesResponse>(prices, v)
export const parseDataHealth = (v: unknown) =>
  parse<DataHealthResponse>(dataHealth, v)

const count: Shape = (v) => num(v) && Number.isSafeInteger(v) && Number(v) >= 0
const coverageCounts = {
  observation_count: count,
  distinct_contract_count: count,
  no_trade_count: count,
  zero_volume_count: count,
  thin_volume_count: count,
  invalid_close_count: count,
}
const coverageIngestion = object({
  file_name: str,
  trade_date: nullable(isoDate),
  status: str,
  rows_total: count,
  rows_kept: count,
  error_summary: nullable(str),
})
const coverageShape = object({
  ...base,
  configuration: object({
    start: isoDate,
    end: isoDate,
    product: nullable(str),
  }),
  data_window: object({
    first_trade_date: nullable(isoDate),
    last_trade_date: nullable(isoDate),
  }),
  supported_products: list(str),
  counts: object(coverageCounts),
  min_volume_grams: (v) => num(v) && Number(v) >= 0,
  days: list(
    object({
      ...coverageCounts,
      date: isoDate,
      products: list(object({ ...coverageCounts, product: str })),
      observations: list(
        object({
          product: str,
          expiry_date: isoDate,
          has_trade: bool,
          volume_lots: (v) => num(v) && Number.isSafeInteger(v),
          volume_grams: nullable(num),
          open_interest_grams: nullable(num),
          no_trade: bool,
          zero_volume: bool,
          thin_volume: bool,
          invalid_close: bool,
        }),
      ),
      ingestion_count: nullable(count),
      ingestions: list(coverageIngestion),
      ingestions_truncated: bool,
    }),
  ),
  expected_coverage_available: (v) => v === false,
  expected_contract_count: (v) => v === null,
  missing_contract_count: (v) => v === null,
  expected_coverage_reason: str,
  official_calendar_available: (v) => v === false,
  file_records_available: bool,
  ingestion_record_limit: count,
  undated_ingestion_count: nullable(count),
  undated_ingestions: list(coverageIngestion),
  undated_ingestions_truncated: bool,
  definitions: record(str),
  limitations: list(str),
})
export function parseCoverage(value: unknown): CoverageResponse {
  const data = parse<CoverageResponse>(coverageShape, value)
  const { start, end, product } = data.configuration
  const length = (Date.parse(end) - Date.parse(start)) / 86400000 + 1
  const countKeys = Object.keys(
    coverageCounts,
  ) as (keyof CoverageResponse['counts'])[]
  const bounded = (counts: CoverageResponse['counts']) =>
    countKeys.every((key) => counts[key] <= counts.observation_count)
  const validFiles = (
    count: number | null,
    returned: number,
    truncated: boolean,
  ) =>
    data.file_records_available
      ? count !== null &&
        returned <= count &&
        returned <= data.ingestion_record_limit &&
        truncated === returned < count
      : count === null && returned === 0 && !truncated
  if (
    length < 1 ||
    length > 31 ||
    data.days.length !== length ||
    !bounded(data.counts) ||
    data.counts.observation_count !==
      data.days.reduce((sum, day) => sum + day.observation_count, 0) ||
    !validFiles(
      data.undated_ingestion_count,
      data.undated_ingestions.length,
      data.undated_ingestions_truncated,
    ) ||
    (product !== null && !data.supported_products.includes(product)) ||
    data.undated_ingestions.some((file) => file.trade_date !== null) ||
    data.days.some(
      (day, index) =>
        day.date !==
          new Date(Date.parse(start) + index * 86400000)
            .toISOString()
            .slice(0, 10) ||
        day.ingestions.some((file) => file.trade_date !== day.date) ||
        !validFiles(
          day.ingestion_count,
          day.ingestions.length,
          day.ingestions_truncated,
        ) ||
        !bounded(day) ||
        day.distinct_contract_count !== day.observation_count ||
        day.products.reduce((sum, row) => sum + row.observation_count, 0) !==
          day.observation_count ||
        new Set(day.products.map((row) => row.product)).size !==
          day.products.length ||
        day.observations.some(
          (row) =>
            !data.supported_products.includes(row.product) ||
            (product !== null && row.product !== product),
        ) ||
        new Set(
          day.observations.map((row) => `${row.product}/${row.expiry_date}`),
        ).size !== day.observations.length ||
        day.observation_count !== day.observations.length ||
        day.products.some(
          (row) =>
            !data.supported_products.includes(row.product) ||
            (product !== null && row.product !== product) ||
            !bounded(row),
        ),
    )
  )
    throw new Error(
      'Coverage response has inconsistent dates, identities or counts.',
    )
  return data
}

const spreadPriceSource = object({
  symbol: str,
  trade_date: isoDate,
  expiry_date: isoDate,
  close: nullable(num),
  quote_grams: num,
  unit_factor: num,
  purity: num,
  purity_factor: num,
  close_p10_raw: nullable(num),
  close_p10_adjusted: nullable(num),
  has_trade: bool,
  volume_grams: nullable(num),
  open_interest_grams: nullable(num),
})
const spreadCalculation = object({
  a: spreadPriceSource,
  b_components: list(spreadPriceSource),
  b_weights: list(num),
  preceding_finite_count: (v) =>
    num(v) && Number.isInteger(v) && Number(v) >= 0,
  statistics_status: str,
})
const spreadRowBase = object({
  trade_date: isoDate,
  pair: str,
  expiry_a: isoDate,
  expiry_b_used: list(isoDate),
  days_mismatch: list(num),
  a_p10_999: nullable(num),
  b_p10_999: nullable(num),
  spread_abs: nullable(num),
  spread_pct: nullable(num),
  roll_mean: nullable(num),
  roll_std: nullable(num),
  z: nullable(num),
  percentile: nullable(num),
  source_tradable: bool,
  reason: str,
  liquidity_ok: bool,
  liquidity_reason: str,
  executable_pair: bool,
  analytics_only: bool,
  comparison_type: str,
})
// Old, checksummed snapshots remain valid. Malformed supplied traces do not.
const spreadRow: Shape = (v) =>
  spreadRowBase(v) &&
  recordObject(v) &&
  (!Object.hasOwn(v, 'calculation') ||
    v.calculation === null ||
    (spreadCalculation(v.calculation) &&
      recordObject(v.calculation) &&
      recordObject(v.calculation.a) &&
      v.calculation.a.symbol === (v.pair as string).split('-')[0] &&
      v.calculation.a.trade_date === v.trade_date &&
      v.calculation.a.expiry_date === v.expiry_a &&
      v.calculation.a.close_p10_adjusted === v.a_p10_999 &&
      Array.isArray(v.calculation.b_components) &&
      v.calculation.b_components.every(
        (b: Record<string, unknown>, i: number) =>
          b.trade_date === v.trade_date &&
          b.symbol === (v.pair as string).split('-')[1] &&
          b.expiry_date === (v.expiry_b_used as string[])[i],
      ) &&
      v.calculation.b_components.length ===
        (v.expiry_b_used as string[]).length &&
      Array.isArray(v.calculation.b_weights) &&
      (v.calculation.b_weights.length === 0 ||
        v.calculation.b_weights.length === v.calculation.b_components.length) &&
      v.calculation.b_weights.every((w: number) => w >= 0 && w <= 1)))
const spreads = object({
  ...base,
  configuration: object({
    pair: str,
    window: num,
    min_periods: num,
    carry_adjusted: bool,
    use_purity_adjustment: bool,
    min_volume_grams: num,
    min_oi_grams: num,
    expiry: nullable(isoDate),
    start: nullable(isoDate),
    end: nullable(isoDate),
  }),
  normalization,
  data_window: object({
    first_trade_date: nullable(isoDate),
    last_trade_date: nullable(isoDate),
  }),
  units: record(str),
  assumptions: list(str),
  convention: str,
  maturity_definition: str,
  series: list(
    object({
      expiry_a: isoDate,
      rows: list(spreadRow),
      latest: spreadRow,
      description: str,
    }),
  ),
})
export const parseSpreads = (v: unknown) => parse<SpreadsResponse>(spreads, v)

const termBase = {
  ...base,
  normalization,
  data_window: object({
    first_trade_date: nullable(isoDate),
    last_trade_date: nullable(isoDate),
  }),
  units: record(str),
  assumptions: list(str),
}
const curvePoint = object({
  trade_date: isoDate,
  product: str,
  expiry_date: isoDate,
  days_to_expiry: num,
  close_p10_raw: nullable(num),
  close_p10_999: nullable(num),
  has_trade: bool,
  volume_grams: nullable(num),
  open_interest_grams: nullable(num),
  quality_reason: str,
})
const curveShape = object({
  ...termBase,
  configuration: object({
    product: str,
    date: nullable(isoDate),
    use_purity_adjustment: bool,
  }),
  selected_date: nullable(isoDate),
  points: list(curvePoint),
})
const rolldownRow = object({
  trade_date: isoDate,
  previous_trade_date: isoDate,
  product: str,
  expiry_date: isoDate,
  next_expiry_used: nullable(isoDate),
  elapsed_days: num,
  previous_price: nullable(num),
  current_price: nullable(num),
  slope_per_day: nullable(num),
  raw_change: nullable(num),
  estimated_roll_down: nullable(num),
  residual_change: nullable(num),
  decomposition_valid: bool,
  reason: str,
})
const rolldownShape = object({
  ...termBase,
  configuration: object({
    product: str,
    expiry: nullable(isoDate),
    start: nullable(isoDate),
    end: nullable(isoDate),
    use_purity_adjustment: bool,
  }),
  valid_count: num,
  invalid_count: num,
  explanation: str,
  series: list(object({ expiry_date: isoDate, rows: list(rolldownRow) })),
})
export const parseCurve = (v: unknown) => parse<CurveResponse>(curveShape, v)
export const parseRolldown = (v: unknown) =>
  parse<RolldownResponse>(rolldownShape, v)

const backtestConfig = {
  pair: str,
  sizing_mode: (v: unknown) => v === 'fractional' || v === 'integer_lots',
  window: num,
  min_periods: num,
  z_entry: num,
  z_exit: num,
  max_hold_sessions: num,
  expiry_buffer_calendar_days: num,
  min_volume_grams: num,
  min_oi_grams: num,
  notional_per_leg: num,
  cost_bps_per_leg_per_side: num,
  use_purity_adjustment: bool,
}
const metrics = object({
  first_simulation_date: nullable(isoDate),
  last_simulation_date: nullable(isoDate),
  overall_data_window: list(nullable(isoDate)),
  session_count: num,
  completed_count: num,
  open_count: num,
  unresolved_count: num,
  pending_order_count: num,
  realized_gross_pnl: nullable(num),
  completed_trade_costs: nullable(num),
  realized_net_pnl: nullable(num),
  open_marked_gross_pnl: nullable(num),
  unresolved_marked_gross_pnl: nullable(num),
  open_entry_costs: nullable(num),
  unresolved_entry_costs: nullable(num),
  open_marked_net_pnl: nullable(num),
  unresolved_marked_net_pnl: nullable(num),
  total_marked_gross_pnl: nullable(num),
  total_incurred_costs: nullable(num),
  total_marked_net_pnl: nullable(num),
  total_marked_pnl_reason: str,
  win_rate: nullable(num),
  average_holding_sessions: nullable(num),
  blocked_exit_count: num,
  blocked_exit_attempt_count: num,
  cancelled_entry_count: num,
  reference_capital: num,
  reference_capital_label: str,
  net_pnl_pct_reference: nullable(num),
  maximum_drawdown_rupees: nullable(num),
  maximum_drawdown_reason: str,
  drawdown_based_on_stale_marks: bool,
  stale_session_count: num,
  unavailable_session_count: num,
  valuation_quality: str,
  warnings: list(str),
})
const marks = {
  mark_a: nullable(num),
  mark_b: nullable(num),
  mark_quality_a: nullable(str),
  mark_quality_b: nullable(str),
  mark_age_calendar_days_a: nullable(num),
  mark_age_calendar_days_b: nullable(num),
  mark_age_sessions_a: nullable(num),
  mark_age_sessions_b: nullable(num),
}
const equityPoint = object({
  ...marks,
  trade_date: isoDate,
  cumulative_gross_pnl: nullable(num),
  cumulative_incurred_costs: nullable(num),
  cumulative_net_pnl: nullable(num),
  reference_capital: num,
  reference_equity: nullable(num),
  drawdown_rupees: nullable(num),
  valuation_quality: str,
  valuation_reason: str,
  drawdown_reason: str,
  drawdown_based_on_stale_marks: bool,
})
const entry = {
  position_id: str,
  pair: str,
  expiry: isoDate,
  side: str,
  signal_date: isoDate,
  signal_z: nullable(num),
  entry_date: isoDate,
  entry_execution_z: nullable(num),
  entry_raw_a: nullable(num),
  entry_raw_b: nullable(num),
  quantity_a_10g: num,
  quantity_b_10g: num,
  entry_costs: nullable(num),
  holding_sessions: num,
}
const completedTrade = object({
  ...entry,
  exit_date: isoDate,
  exit_signal_date: isoDate,
  exit_execution_z: nullable(num),
  exit_reason: str,
  exit_raw_a: nullable(num),
  exit_raw_b: nullable(num),
  gross_pnl: nullable(num),
  exit_costs: nullable(num),
  total_costs: nullable(num),
  net_pnl: nullable(num),
})
const position = (status: string) =>
  object({
    ...entry,
    ...marks,
    status: (v) => v === status,
    gross_marked_pnl: nullable(num),
    net_marked_pnl: nullable(num),
  })
const order = {
  order_id: str,
  pair: str,
  expiry: isoDate,
  kind: str,
  side: str,
  signal_date: isoDate,
  signal_z: nullable(num),
  eligible_after: isoDate,
  exit_reason: str,
}
const orderEvent = object({
  ...order,
  event_date: isoDate,
  status: str,
  reason: str,
})
const costToleranceShape = object({
  label: str,
  highest_profitable_tested_bps: nullable(num),
  range_capped: bool,
  reason: str,
  excluded_open_count: num,
  excluded_unresolved_count: num,
})
const backtestReport = object({
  expiry: isoDate,
  configuration: object({
    ...backtestConfig,
    base_grams: num,
    base_purity: num,
    quote_grams: record(num),
    purity: record(num),
    start: nullable(isoDate),
    end: nullable(isoDate),
  }),
  metrics,
  verdict: str,
  equity_curve: list(equityPoint),
  completed_trades: list(completedTrade),
  open_positions: list(position('open')),
  unresolved_positions: list(position('unresolved_expiry')),
  pending_orders: list(object(order)),
  order_events: list(orderEvent),
  diagnostics: list(orderEvent),
  cost_sensitivity: list(
    object({
      cost_bps_per_leg_per_side: num,
      gross_pnl: nullable(num),
      costs: nullable(num),
      net_pnl: nullable(num),
    }),
  ),
  cost_tolerance: costToleranceShape,
  reference_capital: num,
  assumptions: list(str),
})
const backtestShape = object({
  ...termBase,
  configuration: object({
    ...backtestConfig,
    requested_expiry: nullable(isoDate),
  }),
  aggregation: str,
  reports: list(backtestReport),
})
export const parseBacktest = (v: unknown) =>
  parse<BacktestResponse>(backtestShape, v)
