import DataContext from '@/components/DataContext'
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { healthCounts, historicalMetadata } from '@/lib/dataHealth'
import {
  FileDiagnostics,
  ObservationDiagnostics,
} from '@/components/HealthDiagnostics'
import { formatDate, number, humanize } from '@/lib/format'
import type { DashboardContext } from '@/layouts/AppLayout'
const loadHealth = (signal: AbortSignal) => api.dataHealth({}, signal)
export function DataHealthPage() {
  const { meta } = useOutletContext<DashboardContext>()
  const health = useResource(loadHealth)
  const [product, setProduct] = useState('all')
  const [descending, setDescending] = useState(false)
  const response = health.response
  const data = response?.data
  const counts = data ? healthCounts(data) : undefined
  const historical = historicalMetadata(meta.response?.data)
  const products = data
    ? [
        ...new Set([
          ...Object.keys(data.zero_volume_counts_by_product),
          ...Object.keys(data.no_trade_counts_by_product),
          ...Object.keys(data.thin_volume_counts_by_product),
        ]),
      ].sort()
    : []
  return (
    <div className="overview-page data-health-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">INGESTION RECORDS & OBSERVATION QUALITY</p>
          <h1>Data Health</h1>
          <p className="page-description">
            Review imported data and observation quality.
          </p>
        </div>
      </div>
      {meta.error && (
        <p className="error-notice">
          Data context unavailable.{' '}
          <button className="button" onClick={meta.retry}>
            Retry
          </button>
        </p>
      )}
      <details className="data-details">
        <summary>Dataset details</summary>
        {historical ? (
          <p>
            {formatDate(historical.first)} to {formatDate(historical.last)} ·{' '}
            {historical.sessions} sessions. Purity assumptions:{' '}
            {historical.purity}.
          </p>
        ) : (
          <p>Dataset details unavailable.</p>
        )}
      </details>
      {health.loading && (
        <div className="panel">
          <CrowLoader label="Checking data health…" />
        </div>
      )}
      {health.error && (
        <div className="error-notice" role="alert">
          <p>Data Health unavailable: {health.error}</p>
          <button className="button" onClick={health.retry}>
            Retry Data Health
          </button>
        </div>
      )}
      {data && response && counts && (
        <>
          <section className="panel dh-summary">
            <div className="section-heading">
              <h2>Data summary</h2>
              <DataContext date={data.data_as_of} source={response.source} />
            </div>
            {data.message && <p>{data.message}</p>}
            <div className="rv-readings">
              {[
                [
                  'Successful processing records',
                  counts.successful,
                  'Recorded status ok; successful parsing only.',
                ],
                [
                  'Rejected processing records',
                  counts.rejected,
                  'Recorded error or date_mismatch status; no inferred cause.',
                ],
                [
                  'Trading sessions',
                  data.no_trade_observations.available
                    ? data.database_session_count
                    : null,
                  'Distinct stored observation dates.',
                ],
                [
                  'Contract observations',
                  data.no_trade_observations.available
                    ? data.database_observation_count
                    : null,
                  'Stored symbol/expiry/trade-date rows.',
                ],
                [
                  'Zero-volume observations',
                  counts.zeroVolume,
                  'volume_lots equals zero; counted independently.',
                ],
                [
                  'No-trade observations',
                  counts.noTrade,
                  'has_trade=False; may overlap zero volume.',
                ],
                [
                  'Thin-volume observations',
                  counts.thinVolume,
                  'volume_grams strictly below the applied threshold, including zero volume.',
                ],
              ].map(([label, value, definition]) => (
                <div className="rv-reading" key={String(label)}>
                  <span>{String(label)}</span>
                  <strong>
                    {typeof value === 'number'
                      ? number.format(value)
                      : 'Unavailable'}
                  </strong>
                  <span className="sr-only">{String(definition)}</span>
                </div>
              ))}
            </div>
            <details>
              <summary>Count definitions</summary>
              <p>
                Processing records are keyed by filename; they are not a history
                of import attempts. Zero-volume, no-trade and thin-volume counts
                can overlap and must not be added together.
              </p>
              <p>
                Thin volume means below {number.format(data.min_volume_grams)}{' '}
                g, including zero volume. Missing diagnostic counts remain
                unavailable, not zero.
              </p>
            </details>
            <details>
              <summary>Import status breakdown</summary>
              <div className="dh-status-counts">
                {Object.entries(data.file_status_counts).map(
                  ([status, count]) => (
                    <span className="badge" key={status}>
                      {humanize(status)}: {count}
                    </span>
                  ),
                )}
              </div>
            </details>
            {!data.file_records_available && (
              <p className="dh-unavailable">
                Recorded processing statuses unavailable.
              </p>
            )}
            {(data.file_status_counts.error ?? 0) > 0 && (
              <p className="dh-unavailable">
                Recorded error statuses: {data.file_status_counts.error}.
                Detailed causes were not retained.
              </p>
            )}
          </section>
          <FileDiagnostics
            title="Rejected processing records"
            page={data.rejected_files}
          />
          <FileDiagnostics
            title="Date mismatch records"
            page={data.date_mismatch_files}
          />
          <FileDiagnostics
            title="All recorded processing results"
            page={data.recorded_files}
          />
          <section className="panel dh-checks">
            <p>Unavailable checks are not zero issues.</p>
            <details>
              <summary>Diagnostic availability</summary>
              <div
                className="table-scroll dh-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Diagnostic availability"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th>Availability</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.unavailable_diagnostics).map(
                      ([name, diagnostic]) => (
                        <tr key={name}>
                          <td>{humanize(name)}</td>
                          <td>
                            {diagnostic.available
                              ? 'Available (no issue count supplied)'
                              : 'Unavailable'}
                          </td>
                          <td className="rv-reasons">{diagnostic.reason}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <section className="panel dh-quality">
            <h2>Global observation counts by product</h2>
            <p>Counts cover all stored observations. Categories may overlap.</p>
            <div
              className="table-scroll dh-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="By-product quality counts"
            >
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Zero volume</th>
                    <th>No recorded trade</th>
                    <th>Thin volume</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p}>
                      <td>{p}</td>
                      <td>
                        {data.no_trade_observations.available
                          ? (data.zero_volume_counts_by_product[p] ??
                            'Unavailable')
                          : 'Unavailable'}
                      </td>
                      <td>
                        {data.no_trade_observations.available
                          ? (data.no_trade_counts_by_product[p] ??
                            'Unavailable')
                          : 'Unavailable'}
                      </td>
                      <td>
                        {data.thin_volume_observations.available
                          ? (data.thin_volume_counts_by_product[p] ??
                            'Unavailable')
                          : 'Unavailable'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rv-controls dh-filters">
              <label>
                Filter returned observations
                <select
                  aria-label="Returned-list product"
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                >
                  <option value="all">All returned products</option>
                  {products.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                Date order
                <select
                  aria-label="Returned-list date order"
                  value={descending ? 'descending' : 'ascending'}
                  onChange={(e) =>
                    setDescending(e.target.value === 'descending')
                  }
                >
                  <option value="ascending">Oldest first</option>
                  <option value="descending">Newest first</option>
                </select>
              </label>
            </div>
          </section>
          <ObservationDiagnostics
            title="No-trade observations"
            page={data.no_trade_observations}
            product={product}
            descending={descending}
          />
          <ObservationDiagnostics
            title="Thin-volume observations"
            page={data.thin_volume_observations}
            product={product}
            descending={descending}
          />
          <section className="panel dh-assumptions">
            <details>
              <summary>Import and normalization details</summary>
              <ul>
                {data.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </details>
          </section>
        </>
      )}
    </div>
  )
}
import CrowLoader from '@/components/CrowLoader'
