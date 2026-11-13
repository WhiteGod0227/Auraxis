import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { healthCounts, historicalMetadata } from '@/lib/dataHealth'
import {
  FileDiagnostics,
  ObservationDiagnostics,
} from '@/components/HealthDiagnostics'
import { HowItWorks, Skeleton, Stat } from '@/components/ui'
import { Ring } from '@/components/LuxCharts'
import { PALETTE } from '@/lib/chartTheme'
import { grams, longDate, num } from '@/lib/insight'
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
  const sessions = data?.no_trade_observations.available
    ? data.database_session_count
    : null
  const rows = data?.no_trade_observations.available
    ? data.database_observation_count
    : null
  const problems =
    (counts?.rejected ?? 0) + (data?.date_mismatch_files.total_count ?? 0)
  return (
    <div className="cmp-page data-health-page">
      {health.loading && !data && (
        <div className="ui-stack">
          <Skeleton height={180} />
          <Skeleton height={220} />
        </div>
      )}
      {health.error && (
        <div className="error-notice" role="alert">
          <span>Data health unavailable: {health.error}</span>
          <button className="button" onClick={health.retry}>
            Retry
          </button>
        </div>
      )}
      {data && counts && (
        <>
          <section className="ui-card cmp-summary" aria-label="Data summary">
            <div className="cmp-summary-head">
              <div>
                <h2>What's loaded</h2>
                <p className="ui-muted-note">
                  {historical
                    ? `${longDate(historical.first)} – ${longDate(historical.last)}`
                    : (data.message ?? 'No data yet')}
                </p>
              </div>
              <span
                className={`ui-chip ${problems ? 'tone-high' : 'tone-normal'}`}
              >
                <span className="ui-chip-dot" aria-hidden="true" />
                {problems
                  ? `${problems} file${problems === 1 ? '' : 's'} need attention`
                  : 'All files imported'}
              </span>
            </div>
            <div className="dh-lux">
              <div className="dh-lux-stats">
                <Stat
                  label="Trading sessions"
                  value={num(sessions)}
                  hint={`${num(counts.successful)} files imported`}
                />
                <Stat
                  label="Contract rows"
                  value={num(rows)}
                  hint="one per contract per day"
                />
              </div>
              <div className="dh-lux-rings">
                <Ring
                  color={PALETTE.jade}
                  value={rows ? 1 - (counts.noTrade ?? 0) / rows : null}
                  label={
                    <>
                      Rows with trades
                      <br />
                      <span className="ui-muted-note">
                        {num(counts.noTrade)} without
                      </span>
                    </>
                  }
                />
                <Ring
                  color={PALETTE.slate}
                  value={rows ? 1 - (counts.thinVolume ?? 0) / rows : null}
                  label={
                    <>
                      Liquid rows
                      <br />
                      <span className="ui-muted-note">
                        ≥ {grams(data.min_volume_grams)} traded
                      </span>
                    </>
                  }
                />
                <Ring
                  color={PALETTE.garnet}
                  value={
                    (counts.successful ?? 0) + (counts.rejected ?? 0)
                      ? (counts.successful ?? 0) /
                        ((counts.successful ?? 0) + (counts.rejected ?? 0))
                      : null
                  }
                  label={
                    <>
                      Files imported
                      <br />
                      <span className="ui-muted-note">
                        {num(counts.rejected)} rejected
                      </span>
                    </>
                  }
                />
              </div>
            </div>
          </section>

          {problems > 0 && (
            <div className="ui-stack">
              <FileDiagnostics
                title="Rejected files"
                page={data.rejected_files}
              />
              <FileDiagnostics
                title="Files whose dates don't match their name"
                page={data.date_mismatch_files}
              />
            </div>
          )}

          <section className="ui-card" aria-labelledby="dh-products">
            <div className="ui-card-head">
              <h2 id="dh-products">By product</h2>
              <p>Categories can overlap</p>
            </div>
            <div className="ui-table-scroll">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Zero volume</th>
                    <th className="num">No trades</th>
                    <th className="num">Thin volume</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p}>
                      <td>{p}</td>
                      <td className="num">
                        {num(data.zero_volume_counts_by_product[p])}
                      </td>
                      <td className="num">
                        {num(data.no_trade_counts_by_product[p])}
                      </td>
                      <td className="num">
                        {num(data.thin_volume_counts_by_product[p])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <HowItWorks title="Detailed records">
            <p>
              Zero-volume, no-trade and thin-volume counts can overlap — don't
              add them together. Thin volume means below{' '}
              {grams(data.min_volume_grams)}.
            </p>
            <FileDiagnostics
              title="All imported files"
              page={data.recorded_files}
            />
            <div className="ui-controls">
              <label className="ui-field">
                Product
                <select
                  aria-label="Returned-list product"
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                >
                  <option value="all">All products</option>
                  {products.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label className="ui-field">
                Order
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
            <ObservationDiagnostics
              title="Rows without trades"
              page={data.no_trade_observations}
              product={product}
              descending={descending}
            />
            <ObservationDiagnostics
              title="Thin-volume rows"
              page={data.thin_volume_observations}
              product={product}
              descending={descending}
            />
            <h3>Import rules</h3>
            <ul>
              {data.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </HowItWorks>
        </>
      )}
    </div>
  )
}
