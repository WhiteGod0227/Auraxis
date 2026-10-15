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
            Inspect recorded ingestion results and observation quality.
            Successful parsing does not establish complete market-data validity.
          </p>
        </div>
      </div>
      <section className="panel dh-meta">
        <h2>Historical dataset metadata</h2>
        {meta.response && (
          <span
            className={`source-badge ${meta.response.source === 'Offline snapshot' ? 'offline' : ''}`}
          >
            {meta.response.source}
          </span>
        )}
        {meta.loading && <p role="status">Loading metadata...</p>}
        {meta.error && (
          <div className="error-notice" role="alert">
            <p>Metadata unavailable: {meta.error}</p>
            <button className="button" onClick={meta.retry}>
              Retry metadata
            </button>
          </div>
        )}
        {historical ? (
          <>
            <p>
              Historical window: {formatDate(historical.first)} to{' '}
              {formatDate(historical.last)}; data as of{' '}
              {formatDate(historical.asOf)}. Sessions: {historical.sessions}.
            </p>
            <p>
              Purity verification: <strong>{historical.purity}</strong>.
              Close/settlement is not an executable quote.
            </p>
          </>
        ) : (
          !meta.loading && (
            <p>
              Historical window, session metadata and purity metadata:
              unavailable.
            </p>
          )
        )}
      </section>
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
              <h2>Recorded counts</h2>
              <span
                className={`source-badge ${response.source === 'Offline snapshot' ? 'offline' : ''}`}
              >
                {response.source}
              </span>
            </div>
            <p>
              Data Health historical data as of {formatDate(data.data_as_of)}.
              Applied minimum volume: {number.format(data.min_volume_grams)}{' '}
              grams; diagnostic limit: {data.diagnostic_limit}. No custom
              thresholds are applied.
            </p>
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
                  <small>{String(definition)}</small>
                </div>
              ))}
            </div>
            <p>
              These are retained processing results keyed by filename, not
              unique physical files or a history of processing attempts.
              Zero-volume, no-trade and thin-volume counts overlap; they are
              never added into a combined issue count.
            </p>
            <div className="dh-status-counts">
              {Object.entries(data.file_status_counts).map(
                ([status, count]) => (
                  <span className="badge" key={status}>
                    {status}: {count}
                  </span>
                ),
              )}
            </div>
            {!data.file_records_available && (
              <p className="dh-unavailable">
                Recorded processing statuses unavailable.
              </p>
            )}
            {(data.file_status_counts.error ?? 0) > 0 && (
              <p className="dh-unavailable">
                Recorded error statuses: {data.file_status_counts.error}.
                Detailed causes are unavailable: free-form notes are withheld.
                No cause or recovery recommendation is inferred.
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
            <h2>Diagnostic availability</h2>
            <p>Unavailable checks are not checks with zero issues.</p>
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
                    <th>API reason</th>
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
          </section>
          <section className="panel dh-quality">
            <h2>Global observation counts by product</h2>
            <p>
              Counts come from complete API aggregates, not the truncated
              diagnostic lists. Columns overlap.
            </p>
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
                    <th>has_trade=False</th>
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
                Product - returned lists only
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
                Date order - returned lists only
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
