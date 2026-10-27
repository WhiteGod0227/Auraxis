import DataContext from '@/components/DataContext'
import { useCallback, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { DashboardContext } from '@/layouts/AppLayout'
import { api } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { adjacentMonth, monthRange, chooseCoverageDate } from '@/lib/coverage'
import CoverageCalendar from '@/components/CoverageCalendar'
import CoverageDetails, {
  CoverageCountList,
  CoverageFiles,
} from '@/components/CoverageDetails'
import CrowLoader from '@/components/CrowLoader'

export function CalendarPage() {
  const { meta, coverageSelection, setCoverageSelection } =
    useOutletContext<DashboardContext>()
  const [inputError, setInputError] = useState('')
  const month =
    coverageSelection.month ??
    meta.response?.data.data_as_of?.slice(0, 7) ??
    (meta.loading ? null : new Date().toISOString().slice(0, 7))
  const product = coverageSelection.product
  const resource = useResource(
    useCallback(
      async (signal: AbortSignal) =>
        month
          ? api.coverage({ ...monthRange(month), product }, signal)
          : { data: null, source: 'API' as const },
      [month, product],
    ),
  )
  const response = resource.response
  const data = response?.data
  const selected = data
    ? chooseCoverageDate(data, coverageSelection.date)
    : undefined
  const day = data?.days.find((value) => value.date === selected)
  const products =
    data?.supported_products ??
    meta.response?.data.supported_products ??
    (product ? [product] : [])
  const previous = month ? adjacentMonth(month, -1) : null
  const next = month ? adjacentMonth(month, 1) : null
  const selectMonth = (value: string) => {
    try {
      monthRange(value)
    } catch {
      setInputError('Choose a valid month (years 0001–9999).')
      return
    }
    setInputError('')
    setCoverageSelection((current) => ({
      ...current,
      month: value,
      date: null,
    }))
  }
  return (
    <div className="overview-page coverage-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">LOADED HISTORICAL DATA</p>
          <h1>Data Coverage</h1>
          <p className="page-description">
            Observed availability, not an exchange trading calendar. Not loaded
            does not mean holiday.
          </p>
        </div>
      </div>
      <section
        className="panel coverage-controls"
        aria-label="Data coverage controls"
      >
        <button
          className="button"
          disabled={!previous}
          onClick={() => previous && selectMonth(previous)}
        >
          Previous month
        </button>
        <label>
          Month
          <input
            type="month"
            min="0001-01"
            max="9999-12"
            value={month ?? ''}
            onChange={(event) => selectMonth(event.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={!next}
          onClick={() => next && selectMonth(next)}
        >
          Next month
        </button>
        <label>
          Product
          <select
            value={product ?? 'all'}
            onChange={(event) =>
              setCoverageSelection((current) => ({
                ...current,
                month,
                product:
                  event.target.value === 'all' ? null : event.target.value,
                date: selected ?? current.date,
              }))
            }
          >
            <option value="all">All Products</option>
            {products.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {inputError && (
          <p className="error-notice" role="alert">
            {inputError}
          </p>
        )}
      </section>
      {(resource.loading || !month) && (
        <CrowLoader label="Loading historical data coverage…" />
      )}
      {meta.error && (
        <p className="error-notice">
          Historical metadata unavailable. Choose a month explicitly; coverage
          responses retain their own applied dates and source.{' '}
          <button className="button" onClick={meta.retry}>
            Retry metadata
          </button>
        </p>
      )}
      {resource.error && (
        <div className="error-notice" role="alert">
          <p>
            {resource.errorKind === 'offline-unavailable'
              ? 'This exact month/product is unavailable offline. No other month or product has been substituted.'
              : resource.error}
          </p>
          <button className="button" onClick={resource.retry}>
            Retry coverage
          </button>
        </div>
      )}
      {data && response && (
        <>
          <section
            className="panel"
            aria-label="Applied coverage configuration"
          >
            <DataContext date={data.data_as_of} source={response.source} />
            <details>
              <summary>Applied settings</summary>
              <p>
                {data.configuration.start} to {data.configuration.end} ·{' '}
                {data.configuration.product ?? 'All products'} · thin-volume
                threshold {data.min_volume_grams} g.
              </p>
              {response.generatedAt && (
                <p>Offline snapshot generated: {response.generatedAt} UTC.</p>
              )}
            </details>
            {!data.data_available ? (
              <p role="status">
                Empty market database: no stored observations. Any recorded
                ingestion diagnostics are shown independently.
              </p>
            ) : (
              !data.counts.observation_count && (
                <p role="status">
                  No data for the selected month/product. Other stored
                  dates/products may still have observations.
                </p>
              )
            )}
            <CoverageCountList counts={data.counts} />
            <p>Expected exchange coverage unavailable.</p>
            <details>
              <summary>Count definitions and limitations</summary>
              <dl>
                {Object.entries(data.definitions).map(([key, description]) => (
                  <div key={key}>
                    <dt>{key.replaceAll('_', ' ')}</dt>
                    <dd>{description}</dd>
                  </div>
                ))}
              </dl>
              <ul>
                {data.limitations.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </details>
          </section>
          <section
            className="panel coverage-month"
            aria-label="Monthly observed coverage"
          >
            <h2>{month}</h2>
            <p>
              Not loaded = no observations for this filter. Select a date for
              details.
            </p>
            <CoverageCalendar
              days={data.days}
              selected={selected}
              onSelect={(date) =>
                setCoverageSelection((current) => ({ ...current, month, date }))
              }
            />
          </section>
          {day && (
            <CoverageDetails
              day={day}
              product={data.configuration.product}
              filesAvailable={data.file_records_available}
            />
          )}
          <details className="panel" aria-label="Undated ingestion diagnostics">
            <summary>
              Undated import records ·{' '}
              {data.file_records_available
                ? data.undated_ingestion_count
                : 'Unavailable'}
            </summary>
            <p>
              Database-wide records with no persisted date. These are not
              assigned to the selected day or month and are not attributable to
              a product.
            </p>
            {!data.file_records_available ? (
              <p>File ingestion diagnostics unavailable.</p>
            ) : !data.undated_ingestion_count ? (
              <p>No undated ingestion records.</p>
            ) : (
              <>
                <p>
                  {data.undated_ingestions.length} of{' '}
                  {data.undated_ingestion_count} records shown
                  {data.undated_ingestions_truncated ? '; truncated' : ''}.
                  Maximum returned records: {data.ingestion_record_limit}.
                </p>
                <CoverageFiles
                  files={data.undated_ingestions}
                  label="Undated file ingestion records"
                />
              </>
            )}
          </details>
        </>
      )}
    </div>
  )
}
