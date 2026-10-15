import type {
  DataHealthResponse,
  DiagnosticPage,
  MetaResponse,
  ObservationDiagnostic,
} from './types'
export function diagnosticState<T>(page: DiagnosticPage<T>) {
  return !page.available
    ? {
        state: 'unavailable',
        text: page.unavailable_reason ?? 'Diagnostic unavailable.',
      }
    : {
        state: page.total_count === 0 ? 'zero' : 'available',
        text: `${page.total_count} total matching; ${page.returned_count} returned; ${page.truncated ? 'truncated - returned list is incomplete' : 'not truncated'}.`,
      }
}
export function healthCounts(data: DataHealthResponse) {
  const sum = (counts: Record<string, number>) =>
    Object.values(counts).reduce((a, b) => a + b, 0)
  return {
    successful: data.file_records_available
      ? (data.file_status_counts.ok ?? 0)
      : null,
    rejected: data.rejected_files.available
      ? data.rejected_files.total_count
      : null,
    zeroVolume: data.no_trade_observations.available
      ? sum(data.zero_volume_counts_by_product)
      : null,
    noTrade: data.no_trade_observations.available
      ? sum(data.no_trade_counts_by_product)
      : null,
    thinVolume: data.thin_volume_observations.available
      ? sum(data.thin_volume_counts_by_product)
      : null,
  }
}
export function returnedObservations(
  page: DiagnosticPage<ObservationDiagnostic>,
  product: string,
  descending = false,
) {
  return page.items
    .filter((row) => product === 'all' || row.product === product)
    .sort(
      (a, b) =>
        (descending ? -1 : 1) * a.trade_date.localeCompare(b.trade_date) ||
        a.product.localeCompare(b.product) ||
        a.expiry_date.localeCompare(b.expiry_date),
    )
}
export function historicalMetadata(meta?: MetaResponse) {
  return meta
    ? {
        asOf: meta.data_as_of,
        first: meta.first_trade_date,
        last: meta.last_trade_date,
        sessions: meta.trading_session_count,
        purity: meta.normalization.purity_verification_status,
      }
    : null
}
