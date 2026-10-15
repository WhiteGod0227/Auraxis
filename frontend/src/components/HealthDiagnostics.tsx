import { diagnosticState, returnedObservations } from '@/lib/dataHealth'
import { formatDate, number } from '@/lib/format'
import type {
  DiagnosticPage,
  FileDiagnostic,
  ObservationDiagnostic,
} from '@/lib/types'
const value = (v: number | null) =>
  v === null ? 'Unavailable' : number.format(v)
export function DiagnosticNotice({ page }: { page: DiagnosticPage<unknown> }) {
  const state = diagnosticState(page)
  return (
    <div
      className={`dh-list-note ${state.state === 'unavailable' ? 'dh-unavailable' : ''}`}
    >
      <p>{page.definition}</p>
      <p>
        <strong>
          {state.state === 'unavailable' ? 'Unavailable: ' : ''}
          {state.text}
        </strong>
      </p>
    </div>
  )
}
export function FileDiagnostics({
  title,
  page,
}: {
  title: string
  page: DiagnosticPage<FileDiagnostic>
}) {
  return (
    <section className="panel dh-files">
      <h2>{title}</h2>
      <DiagnosticNotice page={page} />
      {page.available &&
        (page.items.length ? (
          <div
            className="table-scroll dh-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={title}
          >
            <table>
              <thead>
                <tr>
                  <th>Recorded filename</th>
                  <th>Trade date</th>
                  <th>Status</th>
                  <th>Total rows</th>
                  <th>Kept rows</th>
                  <th>Safe diagnostic details</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((item, i) => (
                  <tr key={`${item.file_name}-${i}`}>
                    <td>{item.file_name}</td>
                    <td>{formatDate(item.trade_date)}</td>
                    <td>{item.status}</td>
                    <td>{item.rows_total}</td>
                    <td>{item.rows_kept}</td>
                    <td className="rv-reasons">
                      {item.error_summary && <p>{item.error_summary}</p>}
                      Notes recorded: {String(item.notes_recorded)}. Notes
                      available: {String(item.notes_available)}.{' '}
                      {item.notes_unavailable_reason}
                      <br />
                      Dates extracted from notes:{' '}
                      {item.recorded_dates_in_notes.join(', ') ||
                        'No reason provided'}
                      . These dates have no inferred cause or attribution.
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">Zero matching processing records.</p>
        ))}
    </section>
  )
}
export function ObservationDiagnostics({
  title,
  page,
  product,
  descending,
}: {
  title: string
  page: DiagnosticPage<ObservationDiagnostic>
  product: string
  descending: boolean
}) {
  const rows = returnedObservations(page, product, descending)
  return (
    <section className="panel dh-observations">
      <h2>{title}</h2>
      <DiagnosticNotice page={page} />
      <p className="section-description">
        Local filter and sorting apply to the returned list only: {rows.length}{' '}
        displayed of {page.returned_count} returned. Global matching counts are
        unchanged. Row-level validation reasons are not recorded; the list
        definition and has_trade flag are shown.
      </p>
      <p className="mobile-scroll-hint">
        Scroll horizontally for volume, open interest and observation flags.
      </p>
      {page.available &&
        (rows.length ? (
          <div
            className="table-scroll dh-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={title}
          >
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Observation date</th>
                  <th>Expiry</th>
                  <th>Volume (grams)</th>
                  <th>Open interest (grams)</th>
                  <th>has_trade</th>
                  <th>List criterion / flag</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.product}-${row.trade_date}-${row.expiry_date}`}
                  >
                    <td>{row.product}</td>
                    <td>{formatDate(row.trade_date)}</td>
                    <td>{formatDate(row.expiry_date)}</td>
                    <td>{value(row.volume_grams)}</td>
                    <td>{value(row.open_interest_grams)}</td>
                    <td>{row.has_trade ? 'Passed' : 'Failed'}</td>
                    <td className="rv-reasons">
                      {page.definition} Trade flag:{' '}
                      {row.has_trade ? 'Passed' : 'Failed'}.
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">
            {page.total_count === 0
              ? 'Zero matching observations.'
              : 'No observations match the local filter within the returned list.'}
          </p>
        ))}
    </section>
  )
}
