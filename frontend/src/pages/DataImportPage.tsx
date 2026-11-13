import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from '@/lib/useAccount'
import Crow from '@/components/Crow'
import { DATA_CHANGED_EVENT, useDataSource } from '@/lib/useDataSource'
import { formatTradeDate, uploadBhavcopy } from '@/lib/dataSource'
import type { UploadOutcome } from '@/lib/dataSource'
import '@/styles/data-import.css'

interface Item {
  id: number
  file: File
  state: 'queued' | 'uploading' | 'done' | 'failed'
  result?: UploadOutcome
  error?: string
}

const STATUS_TEXT: Record<UploadOutcome['status'], string> = {
  ok: 'Imported',
  date_mismatch: 'Dates inside the file differ from its name',
  error: 'Could not read this file',
  no_gold_rows: 'No gold futures rows in this file',
}

let nextId = 1

export function DataImportPage() {
  const account = useAccount()
  const watch = useDataSource().status?.watch
  const [items, setItems] = useState<Item[]>([])
  const [running, setRunning] = useState(false)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const update = (id: number, patch: Partial<Item>) =>
    setItems((list) =>
      list.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )

  const start = async (files: File[]) => {
    const csv = files.filter((file) => /\.csv$/i.test(file.name))
    const rejected = files.filter((file) => !/\.csv$/i.test(file.name))
    const queued: Item[] = csv
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((file) => ({ id: nextId++, file, state: 'queued' }))
    const skipped: Item[] = rejected.map((file) => ({
      id: nextId++,
      file,
      state: 'failed',
      error: 'Not a .csv file',
    }))
    setItems((list) => [...skipped, ...queued, ...list])
    if (!queued.length) return
    setRunning(true)
    // Sequential uploads keep SQLite writes simple and progress readable.
    for (const item of queued) {
      update(item.id, { state: 'uploading' })
      try {
        const result = await uploadBhavcopy(item.file)
        update(item.id, {
          state: result.status === 'ok' ? 'done' : 'failed',
          result,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Upload failed.'
        update(item.id, { state: 'failed', error: message })
        if (/Log in|unreachable/.test(message)) break
      }
    }
    setRunning(false)
    window.dispatchEvent(new Event(DATA_CHANGED_EVENT))
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    if (!running && account.user)
      void start(Array.from(event.dataTransfer.files))
  }

  const done = items.filter((item) => item.state === 'done')
  const failed = items.filter((item) => item.state === 'failed')
  const rows = done.reduce(
    (sum, item) => sum + (item.result?.rows_kept ?? 0),
    0,
  )
  const dates = done
    .map((item) => item.result?.trade_date)
    .filter((value): value is string => Boolean(value))
    .sort()
  const finished = !running && items.length > 0

  return (
    <div className="overview-page data-import-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MCX BHAVCOPY · NO BROKER ACCOUNT NEEDED</p>
          <h1>Import Data</h1>
          <p className="page-description">
            Load official daily MCX files to power every chart, comparison and
            backtest.
          </p>
        </div>
      </div>

      <section className="panel import-steps" aria-labelledby="import-how">
        <h2 id="import-how">How to get the files</h2>
        <ol>
          <li>
            Open the{' '}
            <a
              href="https://www.mcxindia.com/market-data/bhavcopy"
              target="_blank"
              rel="noreferrer"
            >
              MCX Bhavcopy page
            </a>{' '}
            in your browser.
          </li>
          <li>
            Pick a trading date, click <strong>Show</strong>, then export it as{' '}
            <strong>CSV</strong>. Repeat for each day you want (the last 3–6
            months works well).
          </li>
          <li>
            {watch?.enabled ? (
              <>
                That’s it — files saved to your Downloads are imported
                automatically. You can also drop them below.
              </>
            ) : (
              <>
                Drop all the downloaded{' '}
                <code>BhavCopyDateWise_DDMMYYYY.csv</code> files below.
                Re-uploading a day is safe; it replaces that day.
              </>
            )}
          </li>
        </ol>
      </section>

      {watch?.enabled && (
        <section className="panel import-watch" aria-labelledby="import-watch">
          <div className="import-watch-head">
            <span className="import-watch-dot" aria-hidden="true" />
            <div>
              <h2 id="import-watch">Auto-import is on</h2>
              <p>
                Any MCX Bhavcopy saved to <code>{watch.folder}</code> is
                imported within seconds, named by the trade date inside the
                file. Re-downloads are skipped.
              </p>
            </div>
          </div>
          {watch.recent.length > 0 && (
            <ul className="import-watch-list">
              {watch.recent.slice(0, 6).map((event) => (
                <li key={`${event.at}-${event.file_name}`}>
                  <span className={`import-watch-tag is-${event.status}`}>
                    {event.status === 'imported'
                      ? 'Imported'
                      : event.status === 'duplicate'
                        ? 'Already had'
                        : event.status === 'skipped'
                          ? 'Skipped'
                          : 'Failed'}
                  </span>
                  <strong>
                    {event.trade_date ? formatTradeDate(event.trade_date) : '—'}
                  </strong>
                  <span className="import-watch-file">{event.file_name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!account.user ? (
        <section className="panel import-login">
          <p>
            <Link to="/login?returnTo=%2Fapp%2Fimport">Log in</Link> to import
            market data.
          </p>
        </section>
      ) : (
        <section
          className={`panel import-drop ${dragging ? 'is-dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            if (!running) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          aria-busy={running}
        >
          <Crow
            size={110}
            mood={
              running
                ? 'pecking'
                : dragging
                  ? 'alert'
                  : items.some((item) => item.state === 'done')
                    ? 'celebrating'
                    : 'perched'
            }
          />
          <p className="import-drop-title">
            {running ? 'Importing…' : 'Drag & drop MCX CSV files here'}
          </p>
          <p className="import-drop-sub">or</p>
          <button
            type="button"
            className="button import-choose"
            disabled={running}
            onClick={() => input.current?.click()}
          >
            Choose files
          </button>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              void start(files)
            }}
          />
        </section>
      )}

      {items.length > 0 && (
        <section className="panel import-results" aria-live="polite">
          <div className="import-summary">
            <div>
              <strong>{done.length}</strong> imported
            </div>
            <div>
              <strong>{failed.length}</strong> failed
            </div>
            <div>
              <strong>{rows.toLocaleString('en-IN')}</strong> contract rows
            </div>
            {dates.length > 0 && (
              <div>
                <strong>{formatTradeDate(dates[0])}</strong> →{' '}
                <strong>{formatTradeDate(dates[dates.length - 1])}</strong>
              </div>
            )}
            {finished && done.length > 0 && (
              <Link className="button import-view" to="/app" reloadDocument>
                View dashboard →
              </Link>
            )}
          </div>
          <ul className="import-list">
            {items.map((item) => (
              <li key={item.id} data-state={item.state}>
                <span className="import-dot" aria-hidden="true" />
                <span className="import-name">{item.file.name}</span>
                <span className="import-detail">
                  {item.state === 'queued' && 'Waiting…'}
                  {item.state === 'uploading' && 'Importing…'}
                  {item.state === 'done' &&
                    `${STATUS_TEXT.ok} · ${formatTradeDate(item.result?.trade_date)} · ${item.result?.rows_kept} rows`}
                  {item.state === 'failed' &&
                    (item.error ??
                      (item.result ? STATUS_TEXT[item.result.status] : ''))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
