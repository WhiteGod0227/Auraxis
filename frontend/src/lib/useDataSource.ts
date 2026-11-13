import { useCallback, useEffect, useState } from 'react'
import { useAccount } from './useAccount'
import {
  fetchDataStatus,
  formatTradeDate,
  refreshMarketData,
} from './dataSource'
import type { DataSourceStatus } from './dataSource'

/** Fired after market data changes (for example, a CSV import). */
export const DATA_CHANGED_EVENT = 'auraxis:data-changed'

export type Freshness = 'fresh' | 'stale' | 'empty' | 'offline'

function freshness(
  status: DataSourceStatus | null,
  failed: boolean,
): Freshness {
  if (failed) return 'offline'
  if (!status?.latest_trade_date) return 'empty'
  const latest = new Date(`${status.latest_trade_date}T00:00:00`).getTime()
  const age = (Date.now() - latest) / 86_400_000
  // Weekends and exchange holidays: allow up to four calendar days.
  return age <= 4 ? 'fresh' : 'stale'
}

/** Shared data-source state for the top-bar pill and the setup guide. */
export function useDataSource() {
  const account = useAccount()
  const [status, setStatus] = useState<DataSourceStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string }>()

  const load = useCallback(
    (signal?: AbortSignal) =>
      fetchDataStatus(signal).then(
        (value) => {
          setStatus(value)
          setFailed(false)
        },
        () => {
          if (!signal?.aborted) setFailed(true)
        },
      ),
    [],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const changed = () => void load()
    window.addEventListener(DATA_CHANGED_EVENT, changed)
    return () => {
      controller.abort()
      window.removeEventListener(DATA_CHANGED_EVENT, changed)
    }
  }, [load])

  const refresh = async () => {
    setBusy(true)
    setNotice(undefined)
    try {
      const result = await refreshMarketData()
      const latest = formatTradeDate(result.latest_trade_date)
      setNotice({
        tone: result.rows > 0 ? 'ok' : 'error',
        text:
          result.rows > 0
            ? `Imported ${result.rows.toLocaleString('en-IN')} rows${latest ? ` · latest ${latest}` : ''}. Reloading…`
            : `No new rows returned. ${result.message}`,
      })
      await load()
      if (result.rows > 0)
        window.setTimeout(() => window.location.reload(), 900)
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Refresh failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  return {
    account,
    status,
    busy,
    notice,
    refresh,
    state: freshness(status, failed),
  }
}
