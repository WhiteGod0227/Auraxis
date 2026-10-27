export type ISODate = string
export interface DataResponse {
  data_as_of: ISODate | null
  data_available: boolean
  message: string | null
}
export interface NormalizationBasis {
  unit: string
  basis: string
  base_grams: number
  base_purity: number
  quote_grams: Record<string, number>
  purity_assumptions: Record<string, number>
  purity_verification_status: string
  default_purity_adjustment: boolean
  comparison_basis_status: string
  comparison_basis_warning: string
}
export interface MetaResponse extends DataResponse {
  first_trade_date: ISODate | null
  last_trade_date: ISODate | null
  trading_session_count: number
  supported_products: string[]
  available_products: string[]
  contract_counts_by_product: Record<string, number>
  prototype_window: boolean
  normalization: NormalizationBasis
}
export interface Reference {
  product: string
  reference_available: boolean
  selection_reason: string
  expiry_date: ISODate | null
  days_to_expiry: number | null
  trade_date: ISODate | null
  close_p10_raw: number | null
  close_p10_999: number | null
  volume_grams: number | null
  open_interest_grams: number | null
  has_trade: boolean | null
  previous_comparison_date: ISODate | null
  day_change_abs: number | null
  day_change_pct: number | null
  change_quality: string
  change_reason: string
}
export interface UpcomingExpiry {
  product: string
  expiry_date: ISODate
  days_to_expiry: number
  has_trade: boolean
  volume_grams: number | null
  open_interest_grams: number | null
  quality_reason: string
}
export interface OverviewResponse extends DataResponse {
  purity_adjustment: boolean
  normalization: NormalizationBasis
  reference_selection_rule: string
  day_change_basis: string
  references: Reference[]
  upcoming_expiries: UpcomingExpiry[]
}
export interface PricePoint {
  trade_date: ISODate
  expiry_date: ISODate
  close_p10_raw: number | null
  close_p10_999: number | null
  has_trade: boolean
  quality_reason: string
}
export interface PriceSeries {
  product: string
  reference_available: boolean
  selection_reason: string
  expiry_date: ISODate | null
  history: PricePoint[]
}
export interface PricesResponse extends DataResponse {
  series_type: 'fixed_expiry'
  purity_adjustment: boolean
  normalization: NormalizationBasis
  reference_selection_rule: string
  series: PriceSeries[]
}
export interface FileDiagnostic {
  file_name: string
  trade_date: ISODate | null
  status: string
  rows_total: number
  rows_kept: number
  notes_recorded: boolean
  notes_available: boolean
  error_summary: string | null
  notes_unavailable_reason: string
  recorded_dates_in_notes: ISODate[]
}
export interface ObservationDiagnostic {
  product: string
  trade_date: ISODate
  expiry_date: ISODate
  volume_grams: number | null
  open_interest_grams: number | null
  has_trade: boolean
}
export interface DiagnosticPage<T> {
  available: boolean
  unavailable_reason: string | null
  definition: string
  total_count: number
  returned_count: number
  truncated: boolean
  items: T[]
}
export interface DataHealthResponse extends DataResponse {
  file_records_available: boolean
  recorded_file_count: number
  file_status_counts: Record<string, number>
  database_session_count: number
  database_observation_count: number
  zero_volume_counts_by_product: Record<string, number>
  no_trade_counts_by_product: Record<string, number>
  thin_volume_counts_by_product: Record<string, number>
  min_volume_grams: number
  diagnostic_limit: number
  recorded_files: DiagnosticPage<FileDiagnostic>
  rejected_files: DiagnosticPage<FileDiagnostic>
  date_mismatch_files: DiagnosticPage<FileDiagnostic>
  no_trade_observations: DiagnosticPage<ObservationDiagnostic>
  thin_volume_observations: DiagnosticPage<ObservationDiagnostic>
  unavailable_diagnostics: Record<
    string,
    { available: boolean; reason: string }
  >
  assumptions: string[]
}
export type Source = 'API' | 'Offline snapshot'
export interface SourcedResponse<T> {
  data: T
  source: Source
  generatedAt?: string
}
export type ParameterValue = string | number | boolean | null
export type Parameters = Record<string, ParameterValue | undefined>
export type Validator<T> = (value: unknown) => T

export type OverviewParameters = { purity?: boolean }
export type PricesParameters = { product?: string | null; purity?: boolean }
export type DataHealthParameters = {
  min_volume_grams?: number
  diagnostic_limit?: number
}

export type CoverageParameters = {
  start: ISODate
  end: ISODate
  product?: string | null
}
export interface CoverageCounts {
  observation_count: number
  distinct_contract_count: number
  no_trade_count: number
  zero_volume_count: number
  thin_volume_count: number
  invalid_close_count: number
}
export interface CoverageObservation {
  product: string
  expiry_date: ISODate
  has_trade: boolean
  volume_lots: number
  volume_grams: number | null
  open_interest_grams: number | null
  no_trade: boolean
  zero_volume: boolean
  thin_volume: boolean
  invalid_close: boolean
}
export interface CoverageIngestion {
  file_name: string
  trade_date: ISODate | null
  status: string
  rows_total: number
  rows_kept: number
  error_summary: string | null
}
export interface CoverageDay extends CoverageCounts {
  date: ISODate
  products: (CoverageCounts & { product: string })[]
  observations: CoverageObservation[]
  ingestion_count: number | null
  ingestions: CoverageIngestion[]
  ingestions_truncated: boolean
}
export interface CoverageResponse extends DataResponse {
  configuration: { start: ISODate; end: ISODate; product: string | null }
  data_window: {
    first_trade_date: ISODate | null
    last_trade_date: ISODate | null
  }
  supported_products: string[]
  counts: CoverageCounts
  min_volume_grams: number
  days: CoverageDay[]
  expected_coverage_available: boolean
  expected_contract_count: number | null
  missing_contract_count: number | null
  expected_coverage_reason: string
  official_calendar_available: boolean
  file_records_available: boolean
  ingestion_record_limit: number
  undated_ingestion_count: number | null
  undated_ingestions: CoverageIngestion[]
  undated_ingestions_truncated: boolean
  definitions: Record<string, string>
  limitations: string[]
}

export type SpreadParameters = {
  pair: string
  expiry?: string | null
  start?: string | null
  end?: string | null
  min_volume_grams?: number
  min_oi_grams?: number
  window?: number
  min_periods?: number
  purity?: boolean
  carry_adjusted?: boolean
}
export interface SpreadPriceSource {
  symbol: string
  trade_date: ISODate
  expiry_date: ISODate
  close: number | null
  quote_grams: number
  unit_factor: number
  purity: number
  purity_factor: number
  close_p10_raw: number | null
  close_p10_adjusted: number | null
  has_trade: boolean
  volume_grams: number | null
  open_interest_grams: number | null
}
export interface SpreadCalculation {
  a: SpreadPriceSource
  b_components: SpreadPriceSource[]
  b_weights: number[]
  preceding_finite_count: number
  statistics_status: string
}
export interface SpreadRow {
  trade_date: ISODate
  pair: string
  expiry_a: ISODate
  expiry_b_used: ISODate[]
  days_mismatch: number[]
  a_p10_999: number | null
  b_p10_999: number | null
  spread_abs: number | null
  spread_pct: number | null
  roll_mean: number | null
  roll_std: number | null
  z: number | null
  percentile: number | null
  source_tradable: boolean
  reason: string
  liquidity_ok: boolean
  liquidity_reason: string
  executable_pair: boolean
  analytics_only: boolean
  comparison_type: string
  calculation?: SpreadCalculation | null
}
export interface SpreadSeries {
  expiry_a: ISODate
  rows: SpreadRow[]
  latest: SpreadRow
  description: string
}
export interface SpreadsResponse extends DataResponse {
  configuration: {
    pair: string
    window: number
    min_periods: number
    carry_adjusted: boolean
    use_purity_adjustment: boolean
    min_volume_grams: number
    min_oi_grams: number
    expiry: ISODate | null
    start: ISODate | null
    end: ISODate | null
  }
  normalization: NormalizationBasis
  data_window: {
    first_trade_date: ISODate | null
    last_trade_date: ISODate | null
  }
  units: Record<string, string>
  assumptions: string[]
  convention: string
  maturity_definition: string
  series: SpreadSeries[]
}

export type CurveParameters = {
  product: string
  date?: ISODate | null
  purity?: boolean
}
export type RolldownParameters = {
  product: string
  purity?: boolean
  expiry?: string | null
  start?: string | null
  end?: string | null
}
export interface TermAnalyticsResponse extends DataResponse {
  normalization: NormalizationBasis
  data_window: {
    first_trade_date: ISODate | null
    last_trade_date: ISODate | null
  }
  units: Record<string, string>
  assumptions: string[]
}
export interface CurvePoint {
  trade_date: ISODate
  product: string
  expiry_date: ISODate
  days_to_expiry: number
  close_p10_raw: number | null
  close_p10_999: number | null
  has_trade: boolean
  volume_grams: number | null
  open_interest_grams: number | null
  quality_reason: string
}
export interface CurveResponse extends TermAnalyticsResponse {
  configuration: {
    product: string
    date: ISODate | null
    use_purity_adjustment: boolean
  }
  selected_date: ISODate | null
  points: CurvePoint[]
}
export interface RolldownRow {
  trade_date: ISODate
  previous_trade_date: ISODate
  product: string
  expiry_date: ISODate
  next_expiry_used: ISODate | null
  elapsed_days: number
  previous_price: number | null
  current_price: number | null
  slope_per_day: number | null
  raw_change: number | null
  estimated_roll_down: number | null
  residual_change: number | null
  decomposition_valid: boolean
  reason: string
}
export interface RolldownSeries {
  expiry_date: ISODate
  rows: RolldownRow[]
}
export interface RolldownResponse extends TermAnalyticsResponse {
  configuration: {
    product: string
    expiry: ISODate | null
    start: ISODate | null
    end: ISODate | null
    use_purity_adjustment: boolean
  }
  valid_count: number
  invalid_count: number
  explanation: string
  series: RolldownSeries[]
}

export type BacktestParameters = {
  pair: string
  expiry?: string | null
  window?: number
  min_periods?: number
  expiry_buffer_calendar_days?: number
  min_oi_grams?: number
  notional_per_leg?: number
  purity?: boolean
  sizing_mode?: 'fractional' | 'integer_lots'
  z_entry?: number
  z_exit?: number
  cost_bps_per_leg_per_side?: number
  min_volume_grams?: number
  max_hold_sessions?: number
}
export interface BacktestConfiguration {
  pair: string
  window: number
  min_periods: number
  z_entry: number
  z_exit: number
  max_hold_sessions: number
  expiry_buffer_calendar_days: number
  min_volume_grams: number
  min_oi_grams: number
  notional_per_leg: number
  cost_bps_per_leg_per_side: number
  use_purity_adjustment: boolean
  sizing_mode: 'fractional' | 'integer_lots'
  base_grams?: number
  base_purity?: number
  quote_grams?: Record<string, number>
  purity?: Record<string, number>
  start?: ISODate | null
  end?: ISODate | null
}
export interface BacktestMetrics {
  first_simulation_date: ISODate | null
  last_simulation_date: ISODate | null
  overall_data_window: (ISODate | null)[]
  session_count: number
  completed_count: number
  open_count: number
  unresolved_count: number
  pending_order_count: number
  realized_gross_pnl: number | null
  completed_trade_costs: number | null
  realized_net_pnl: number | null
  open_marked_gross_pnl: number | null
  unresolved_marked_gross_pnl: number | null
  open_entry_costs: number | null
  unresolved_entry_costs: number | null
  open_marked_net_pnl: number | null
  unresolved_marked_net_pnl: number | null
  total_marked_gross_pnl: number | null
  total_incurred_costs: number | null
  total_marked_net_pnl: number | null
  total_marked_pnl_reason: string
  win_rate: number | null
  average_holding_sessions: number | null
  blocked_exit_count: number
  blocked_exit_attempt_count: number
  cancelled_entry_count: number
  reference_capital: number
  reference_capital_label: string
  net_pnl_pct_reference: number | null
  maximum_drawdown_rupees: number | null
  maximum_drawdown_reason: string
  drawdown_based_on_stale_marks: boolean
  stale_session_count: number
  unavailable_session_count: number
  valuation_quality: string
  warnings: string[]
}
export interface BacktestMarks {
  mark_a: number | null
  mark_b: number | null
  mark_quality_a: string | null
  mark_quality_b: string | null
  mark_age_calendar_days_a: number | null
  mark_age_calendar_days_b: number | null
  mark_age_sessions_a: number | null
  mark_age_sessions_b: number | null
}
export interface BacktestEquityPoint extends BacktestMarks {
  trade_date: ISODate
  cumulative_gross_pnl: number | null
  cumulative_incurred_costs: number | null
  cumulative_net_pnl: number | null
  reference_capital: number
  reference_equity: number | null
  drawdown_rupees: number | null
  valuation_quality: string
  valuation_reason: string
  drawdown_reason: string
  drawdown_based_on_stale_marks: boolean
}
export interface BacktestEntry {
  position_id: string
  pair: string
  expiry: ISODate
  side: string
  signal_date: ISODate
  signal_z: number | null
  entry_date: ISODate
  entry_execution_z: number | null
  entry_raw_a: number | null
  entry_raw_b: number | null
  quantity_a_10g: number
  quantity_b_10g: number
  lots_a?: number
  lots_b?: number
  entry_notional_a?: number
  entry_notional_b?: number
  residual_notional_a?: number
  residual_notional_b?: number
  net_exposure_grams?: number
  entry_costs: number | null
  holding_sessions: number
}
export interface CompletedTrade extends BacktestEntry {
  exit_date: ISODate
  exit_signal_date: ISODate
  exit_execution_z: number | null
  exit_reason: string
  exit_raw_a: number | null
  exit_raw_b: number | null
  gross_pnl: number | null
  exit_costs: number | null
  total_costs: number | null
  net_pnl: number | null
}
export interface OutstandingPosition extends BacktestEntry, BacktestMarks {
  status: 'open' | 'unresolved_expiry'
  gross_marked_pnl: number | null
  net_marked_pnl: number | null
}
export interface BacktestOrder {
  order_id: string
  pair: string
  expiry: ISODate
  kind: string
  side: string
  signal_date: ISODate
  signal_z: number | null
  eligible_after: ISODate
  exit_reason: string
}
export interface BacktestOrderEvent extends BacktestOrder {
  event_date: ISODate
  status: string
  reason: string
}
export interface CostSensitivityPoint {
  cost_bps_per_leg_per_side: number
  gross_pnl: number | null
  costs: number | null
  net_pnl: number | null
}
export interface CostTolerance {
  label: string
  highest_profitable_tested_bps: number | null
  range_capped: boolean
  reason: string
  excluded_open_count: number
  excluded_unresolved_count: number
}
export interface BacktestReport {
  expiry: ISODate
  configuration: BacktestConfiguration
  metrics: BacktestMetrics
  verdict: string
  equity_curve: BacktestEquityPoint[]
  completed_trades: CompletedTrade[]
  open_positions: OutstandingPosition[]
  unresolved_positions: OutstandingPosition[]
  pending_orders: BacktestOrder[]
  order_events: BacktestOrderEvent[]
  diagnostics: BacktestOrderEvent[]
  cost_sensitivity: CostSensitivityPoint[]
  cost_tolerance: CostTolerance
  reference_capital: number
  assumptions: string[]
}
export interface BacktestResponse extends TermAnalyticsResponse {
  configuration: BacktestConfiguration & { requested_expiry: ISODate | null }
  aggregation: string
  reports: BacktestReport[]
}
