import { formatTradeDate } from '@/lib/dataSource'
import { useDataSource } from '@/lib/useDataSource'
import '@/styles/data-source.css'

type DataSource = ReturnType<typeof useDataSource>

export function DataSourcePill({ source: data }: { source: DataSource }) {
  const { account, status, busy, notice, refresh, state } = data
  const latest = formatTradeDate(status?.latest_trade_date)
  const label =
    state === 'offline'
      ? 'Server offline'
      : state === 'empty'
        ? 'No data yet'
        : `Data to ${latest}`
  const source = status?.last_run
    ? 'Upstox'
    : status?.latest_trade_date
      ? 'MCX files'
      : ''

  return (
    <>
      <div className="data-source" data-state={state}>
        <span className="data-source-dot" aria-hidden="true" />
        <span
          className="data-source-label"
          title={source ? `Source: ${source}` : undefined}
        >
          {label}
        </span>
        {status?.configured && account.user && (
          <button
            type="button"
            className="data-source-refresh"
            onClick={refresh}
            disabled={busy || status.refreshing}
            aria-label="Refresh market data from Upstox"
            title="Refresh market data from Upstox"
          >
            <span className={busy ? 'spin' : ''} aria-hidden="true">
              ↻
            </span>
            <span className="data-source-refresh-text">
              {busy ? 'Refreshing…' : 'Refresh'}
            </span>
          </button>
        )}
      </div>
      {notice && (
        <p
          className={`data-source-notice ${notice.tone}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}
    </>
  )
}
