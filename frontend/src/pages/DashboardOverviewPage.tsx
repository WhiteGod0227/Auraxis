import { lazy, Suspense } from 'react'
import { useOutletContext } from 'react-router-dom'

import type { DashboardContext } from '@/layouts/AppLayout'
import { api } from '@/lib/api'
import { number, currency, formatDate, humanize } from '@/lib/format'
import { useResource } from '@/lib/useResource'
import type { Resource } from '@/lib/useResource'
import type {
  DataResponse,
  NormalizationBasis,
  Reference,
  SourcedResponse,
} from '@/lib/types'

const ReferencePriceChart = lazy(
  () => import('@/components/ReferencePriceChart'),
)
const loadOverview = (signal: AbortSignal) => api.overview({}, signal)
const loadPrices = (signal: AbortSignal) => api.prices({}, signal)
function SourceLabel<T extends DataResponse>({
  response,
}: {
  response?: SourcedResponse<T>
}) {
  if (!response) return null
  return (
    <div className="dataset-source">
      <span
        className={`source-badge ${response.source === 'Offline snapshot' ? 'offline' : ''}`}
      >
        {response.source}
      </span>
      <span>As of {response.data.data_as_of ?? 'unavailable'}</span>
    </div>
  )
}
function ErrorNotice<T>({
  resource,
  label,
}: {
  resource: Resource<T>
  label: string
}) {
  if (!resource.error) return null
  return (
    <div className="error-notice" role="alert">
      <div>
        <strong>{label} could not refresh</strong>
        <p>
          {resource.error}
          {resource.response
            ? ' Previously loaded data remains displayed.'
            : ''}
        </p>
      </div>
      <button className="button" onClick={resource.retry}>
        Retry {label.toLowerCase()}
      </button>
    </div>
  )
}
function PriceCard({
  reference,
  basis,
}: {
  reference: Reference
  basis: NormalizationBasis
}) {
  const change = reference.day_change_pct
  const direction =
    change === null || change === 0 ? '' : change > 0 ? 'positive' : 'negative'
  const comparison = reference.previous_comparison_date
    ? `Same fixed expiry versus ${formatDate(reference.previous_comparison_date)}. ${humanize(reference.change_quality)}. ${humanize(reference.change_reason)}`
    : humanize(reference.change_reason)
  return (
    <article className="panel product-card">
      <div className="product-card-top">
        <h2>{reference.product}</h2>
        <span className="contract-tag">FUTCOM</span>
      </div>
      <p className="reference-expiry">
        Reference expiry <strong>{formatDate(reference.expiry_date)}</strong>
      </p>
      {reference.reference_available ? (
        <>
          <p className="product-price">
            {reference.close_p10_999 === null
              ? 'Unavailable'
              : currency.format(reference.close_p10_999)}
          </p>
          <p className="price-unit">
            per {basis.base_grams} g · Quote-size normalized
          </p>
          <div className={`day-change ${direction}`} title={comparison}>
            {change === null ? (
              <span>Day change unavailable</span>
            ) : (
              <span>
                {change > 0 ? '+' : ''}
                {number.format(change)}%{' '}
                <span className="change-absolute">
                  (
                  {reference.day_change_abs === null
                    ? 'unavailable'
                    : `${reference.day_change_abs > 0 ? '+' : ''}${currency.format(reference.day_change_abs)}`}
                  )
                </span>
              </span>
            )}
          </div>
          <details className="comparison-details">
            <summary>Comparison details</summary>
            <p>{comparison}</p>
          </details>
          <div className="liquidity">
            <span>
              Volume{' '}
              <strong>
                {reference.volume_grams === null
                  ? 'Unavailable'
                  : `${number.format(reference.volume_grams)} g`}
              </strong>
            </span>
            <span>
              Open interest{' '}
              <strong>
                {reference.open_interest_grams === null
                  ? 'Unavailable'
                  : `${number.format(reference.open_interest_grams)} g`}
              </strong>
            </span>
          </div>
        </>
      ) : (
        <div className="reference-unavailable">
          <strong>Reference unavailable</strong>
          <p>{humanize(reference.selection_reason)}</p>
        </div>
      )}
    </article>
  )
}
export function DashboardOverviewPage() {
  const { meta } = useOutletContext<DashboardContext>()
  const overview = useResource(loadOverview)
  const prices = useResource(loadPrices)
  const overviewData = overview.response?.data
  const pricesData = prices.response?.data
  const basis = overviewData?.normalization ?? meta.response?.data.normalization
  const excluded =
    pricesData?.series.reduce(
      (total, item) =>
        total + item.history.filter((point) => !point.has_trade).length,
      0,
    ) ?? 0
  const missing =
    pricesData?.series.reduce(
      (total, item) =>
        total +
        item.history.filter(
          (point) => point.has_trade && point.close_p10_999 === null,
        ).length,
      0,
    ) ?? 0
  const hasChart =
    pricesData?.series.some((item) =>
      item.history.some(
        (point) => point.has_trade && point.close_p10_999 !== null,
      ),
    ) ?? false
  return (
    <div className="overview-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">RESEARCH WORKSPACE</p>
          <h1>Overview</h1>
          <p className="page-description">
            A common basis for four gold futures contracts.
          </p>
        </div>
        <span className="badge historical-label">Historical observations</span>
      </div>
      <ErrorNotice resource={meta} label="Metadata" />
      <div className="basis-note">
        <span className="note-icon" aria-hidden="true">
          i
        </span>
        <div>
          <strong>Purity assumptions unverified.</strong>
          <p>Historical settlement prices, not executable quotes.</p>
          <details>
            <summary>Normalization details</summary>
            <p>
              {basis
                ? `${basis.unit}; purity adjustment off (experimental when enabled). Quote grams: ${Object.entries(
                    basis.quote_grams,
                  )
                    .map(([symbol, grams]) => `${symbol} ${grams} g`)
                    .join(' · ')}. Purity assumptions: ${Object.entries(
                    basis.purity_assumptions,
                  )
                    .map(([symbol, purity]) => `${symbol} ${purity}`)
                    .join(' · ')}.`
                : 'Normalization metadata is not available yet.'}{' '}
              Close/settlement is not an executable price.
            </p>
          </details>
        </div>
      </div>
      <section aria-labelledby="reference-heading">
        <div className="section-heading">
          <h2 id="reference-heading">Reference contracts</h2>
          <SourceLabel response={overview.response} />
        </div>
        <ErrorNotice resource={overview} label="References" />
        {overview.loading && !overviewData ? (
          <div
            className="panel"
            aria-label="Loading reference contracts"
            role="status"
          >
            <CrowLoader label="Loading reference contracts…" />
          </div>
        ) : overviewData?.references.length ? (
          <div className="product-grid">
            {overviewData.references.map((reference) => (
              <PriceCard
                key={reference.product}
                reference={reference}
                basis={overviewData.normalization}
              />
            ))}
          </div>
        ) : !overview.loading && !overview.error ? (
          <div className="panel empty-state">
            No reference contracts available. {overviewData?.message}
          </div>
        ) : null}
        {overviewData && (
          <details className="selection-details">
            <summary>How reference contracts are selected</summary>
            <p>{overviewData.reference_selection_rule}</p>
          </details>
        )}
      </section>
      <section className="panel chart-panel" aria-labelledby="chart-heading">
        <div className="section-heading">
          <div>
            <h2 id="chart-heading">Fixed-expiry price histories</h2>
            <p className="section-description">
              Each line follows one reference contract, not a continuous series.
            </p>
          </div>
          <SourceLabel response={prices.response} />
        </div>
        <ErrorNotice resource={prices} label="Price histories" />
        {prices.loading && !pricesData ? (
          <div
            className="skeleton chart-skeleton"
            role="status"
            aria-label="Loading price histories"
          />
        ) : hasChart && pricesData ? (
          <>
            <Suspense
              fallback={
                <div
                  className="skeleton chart-skeleton"
                  role="status"
                  aria-label="Loading chart"
                />
              }
            >
              <ReferencePriceChart response={pricesData} />
            </Suspense>
            <p className="chart-caption">
              {pricesData.normalization.unit} ·{' '}
              {pricesData.purity_adjustment
                ? 'Experimental purity adjustment enabled; assumptions unverified'
                : 'Quote-size conversion only; purity adjustment off'}
              . Missing observations break the line. {excluded} untraded
              observations excluded from traded-price lines; {missing} traded
              observations have missing prices.
            </p>
            <details className="history-details">
              <summary>View accessible price history table</summary>
              <div className="table-scroll">
                <table>
                  <caption>
                    Returned fixed-expiry observations, including untraded and
                    missing values
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Product</th>
                      <th scope="col">Expiry</th>
                      <th scope="col">Normalized close</th>
                      <th scope="col">Trade / quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pricesData.series.flatMap((series) =>
                      series.history.map((point) => (
                        <tr
                          key={`${series.product}-${point.expiry_date}-${point.trade_date}`}
                        >
                          <td>{point.trade_date}</td>
                          <td>{series.product}</td>
                          <td>{point.expiry_date}</td>
                          <td>
                            {point.close_p10_999 === null
                              ? 'Unavailable'
                              : currency.format(point.close_p10_999)}
                          </td>
                          <td>
                            {point.has_trade ? 'Traded' : 'No trade'}
                            {point.quality_reason &&
                              ` · ${humanize(point.quality_reason)}`}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : !prices.loading && !prices.error ? (
          <div className="empty-state">
            No traded fixed-expiry history available. {pricesData?.message}
            {pricesData?.series.map((s) => (
              <p key={s.product}>
                {s.product}: {humanize(s.selection_reason)}
              </p>
            ))}
          </div>
        ) : null}
      </section>
      <section
        className="panel expiries-panel"
        aria-labelledby="expiry-heading"
      >
        <div className="section-heading">
          <div>
            <h2 id="expiry-heading">Upcoming expiries</h2>
            <p className="section-description">
              Calendar days remaining as of{' '}
              {overviewData?.data_as_of ?? 'the historical observation date'}.
            </p>
          </div>
          <SourceLabel response={overview.response} />
        </div>
        {overview.loading && !overviewData ? (
          <div
            className="skeleton"
            role="status"
            aria-label="Loading expiries"
          />
        ) : overviewData?.upcoming_expiries.length ? (
          <>
            <p className="mobile-scroll-hint">
              Scroll horizontally for liquidity details; vertically for all
              expiries.
            </p>
            <div
              className="expiry-scroll"
              tabIndex={0}
              aria-label="Upcoming expiry list"
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Expiry</th>
                    <th scope="col">Days left</th>
                    <th scope="col">Volume</th>
                    <th scope="col">Liquidity quality</th>
                  </tr>
                </thead>
                <tbody>
                  {overviewData.upcoming_expiries.map((item) => (
                    <tr key={`${item.product}-${item.expiry_date}`}>
                      <td className="table-product">{item.product}</td>
                      <td>{formatDate(item.expiry_date)}</td>
                      <td>
                        {item.days_to_expiry}
                        <span className="muted"> d</span>
                      </td>
                      <td>
                        {item.volume_grams === null
                          ? 'Unavailable'
                          : `${number.format(item.volume_grams)} g`}
                      </td>
                      <td>
                        <span
                          className={`quality-pill ${item.quality_reason ? 'caution' : ''}`}
                        >
                          {item.quality_reason
                            ? humanize(item.quality_reason)
                            : item.has_trade
                              ? 'Traded observation'
                              : 'No trade'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : !overview.loading ? (
          <p className="empty-state">
            {overview.error
              ? 'Expiry list unavailable because the Overview request failed. Retry References above.'
              : 'No upcoming expiries in the returned data.'}
          </p>
        ) : null}
      </section>
    </div>
  )
}
import CrowLoader from '@/components/CrowLoader'
