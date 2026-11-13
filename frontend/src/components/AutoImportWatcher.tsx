import { useEffect, useRef, useState } from 'react'
import { fetchDataStatus } from '@/lib/dataSource'
import { DATA_CHANGED_EVENT } from '@/lib/useDataSource'
import { longDate } from '@/lib/insight'
import { usePresenter } from '@/lib/presenter'

const POLL_MS = 15000

/**
 * Notices files the backend auto-imported (from the watched Downloads folder)
 * and refreshes the page so every chart shows the new day. During demo mode it
 * only announces the import, so a presentation is never interrupted.
 */
export default function AutoImportWatcher() {
  const { active: presenting } = usePresenter()
  const presentingRef = useRef(presenting)
  const [message, setMessage] = useState<string>()

  useEffect(() => {
    presentingRef.current = presenting
  }, [presenting])

  useEffect(() => {
    let lastSeen: string | null | undefined
    let timer = 0
    let stopped = false
    const check = async () => {
      try {
        const status = await fetchDataStatus()
        const watch = status.watch
        if (!watch?.enabled) return // nothing to watch: stop polling
        const latest = watch.last_import_at
        if (lastSeen !== undefined && latest && latest !== lastSeen) {
          const days = watch.recent
            .filter(
              (event) => event.status === 'imported' && event.at === latest,
            )
            .map((event) => longDate(event.trade_date))
          const what = days.length ? days.join(', ') : 'new market data'
          window.dispatchEvent(new Event(DATA_CHANGED_EVENT))
          if (presentingRef.current) {
            setMessage(`Imported ${what}. Reload after the demo to see it.`)
          } else {
            setMessage(`Imported ${what} from your Downloads. Updating…`)
            window.setTimeout(() => window.location.reload(), 2200)
          }
        }
        lastSeen = latest
      } catch {
        /* backend offline: try again later */
      }
      if (!stopped) timer = window.setTimeout(check, POLL_MS)
    }
    void check()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [])

  if (!message) return null
  return (
    <p className="data-source-notice ok auto-import-toast" role="status">
      {message}
    </p>
  )
}
