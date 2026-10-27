import type {
  CoverageCounts,
  CoverageDay,
  CoverageIngestion,
} from '@/lib/types'
import { formatDate, number } from '@/lib/format'

const labels: [keyof CoverageCounts, string][] = [
  ['observation_count', 'Observations'],
  ['distinct_contract_count', 'Distinct observed contracts'],
  ['no_trade_count', 'No trade'],
  ['zero_volume_count', 'Zero volume'],
  ['thin_volume_count', 'Thin volume'],
  ['invalid_close_count', 'Invalid settlement'],
]
export function CoverageCountList({ counts }: { counts: CoverageCounts }) {
  return (
    <dl className="coverage-counts">
      {labels.map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>{number.format(counts[key])}</dd>
        </div>
      ))}
    </dl>
  )
}
const statuses: Record<string, string> = {
  ok: 'Imported',
  error: 'Import error',
  date_mismatch: 'Rejected: date mismatch',
  no_gold_rows: 'No matching gold futures',
  unknown: 'Unknown recorded status',
}
export function CoverageFiles({
  files,
  label,
}: {
  files: CoverageIngestion[]
  label: string
}) {
  return (
    <div className="table-scroll" role="region" tabIndex={0} aria-label={label}>
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Recorded file date</th>
            <th>Status</th>
            <th>Input rows</th>
            <th>Kept rows (all products)</th>
            <th>Safe diagnostic</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file, i) => (
            <tr key={`${file.file_name}-${i}`}>
              <td>{file.file_name}</td>
              <td>
                {file.trade_date ? formatDate(file.trade_date) : 'Undated'}
              </td>
              <td>{statuses[file.status] ?? file.status}</td>
              <td>{file.rows_total}</td>
              <td>{file.rows_kept}</td>
              <td>{file.error_summary ?? 'No error summary recorded'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export default function CoverageDetails({
  day,
  product,
  filesAvailable,
}: {
  day: CoverageDay
  product: string | null
  filesAvailable: boolean
}) {
  return (
    <section
      className="panel"
      aria-label="Selected date coverage"
      aria-live="polite"
    >
      <h2>
        {formatDate(day.date)} · {product ?? 'All Products'}
      </h2>
      <CoverageCountList counts={day} />
      {!day.observation_count && (
        <p>
          No loaded observations for this date/product. This is not an
          exchange-holiday classification.
        </p>
      )}
      <p>
        Expected contract coverage unavailable. Diagnostic categories overlap;
        do not add them into a unique affected-row total.
      </p>
      {!!day.products.length && (
        <div
          className="table-scroll"
          role="region"
          tabIndex={0}
          aria-label="Selected date product breakdown"
        >
          <table>
            <thead>
              <tr>
                <th>Product</th>
                {labels.map(([, label]) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {day.products.map((row) => (
                <tr key={row.product}>
                  <th scope="row">{row.product}</th>
                  {labels.map(([key]) => (
                    <td key={key}>{row[key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!day.observations.length && (
        <details open>
          <summary>
            Observed products and actual expiries ({day.observations.length})
          </summary>
          <div
            className="table-scroll"
            role="region"
            tabIndex={0}
            aria-label="Selected date observed contracts"
          >
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Actual expiry</th>
                  <th>Source trade flag</th>
                  <th>Volume lots</th>
                  <th>Volume (g)</th>
                  <th>Open interest (g)</th>
                  <th>Supported diagnostics</th>
                </tr>
              </thead>
              <tbody>
                {day.observations.map((row) => (
                  <tr key={`${row.product}-${row.expiry_date}`}>
                    <td>{row.product}</td>
                    <td>{formatDate(row.expiry_date)}</td>
                    <td>
                      {row.has_trade ? 'Recorded trade' : 'No recorded trade'}
                    </td>
                    <td>{row.volume_lots}</td>
                    <td>
                      {row.volume_grams === null
                        ? 'Unavailable'
                        : number.format(row.volume_grams)}
                    </td>
                    <td>
                      {row.open_interest_grams === null
                        ? 'Unavailable'
                        : number.format(row.open_interest_grams)}
                    </td>
                    <td>
                      {[
                        row.no_trade && 'No trade',
                        row.zero_volume && 'Zero volume',
                        row.thin_volume && 'Thin volume',
                        row.invalid_close && 'Invalid settlement',
                      ]
                        .filter(Boolean)
                        .join('; ') || 'No supported flags'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <h3>Dated file ingestion records</h3>
      <p>
        File-wide records; not filtered or attributed by product. The recorded
        file date does not prove that its observations passed validation.
      </p>
      {!filesAvailable ? (
        <p>File ingestion diagnostics unavailable: no data_health table.</p>
      ) : !day.ingestion_count ? (
        <p>No dated ingestion records for this date.</p>
      ) : (
        <>
          <p>
            {day.ingestions.length} of {day.ingestion_count} records shown
            {day.ingestions_truncated ? '; truncated' : ''}.
          </p>
          <CoverageFiles
            files={day.ingestions}
            label="Selected date file ingestion records"
          />
        </>
      )}
    </section>
  )
}
