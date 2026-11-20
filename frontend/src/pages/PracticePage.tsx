import { useEffect, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Seg } from '@/components/OverviewWidgets'
import { GapChip } from '@/components/ui'
import { productColor } from '@/lib/chartTheme'
import { pairLabel, pairParts, shortDate, signedPct } from '@/lib/insight'
import {
  demoMoney,
  newRequestId,
  practiceApi,
  refreshPractice,
  sideLabel,
  signedDemo,
  usePractice,
} from '@/lib/practice'
import type {
  LeaderboardEntry,
  PracticeKind,
  PracticePosition,
  PracticeSide,
  PracticeSummary,
} from '@/lib/practice'
import '@/styles/dashboard.css'
import '@/styles/practice.css'

const GUIDE_KEY = 'auraxis.practice.guide.dismissed'
const rupee = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const inr = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value < 0 ? '−' : ''}₹${rupee.format(Math.abs(value))}`
    : '—'
const toneOf = (value: number | null | undefined) =>
  typeof value === 'number' && value !== 0
    ? value > 0
      ? 'up'
      : 'down'
    : 'neutral'
const when = (iso: string | undefined) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata',
      })
    : '—'

function readGuide() {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1'
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------------ */

function Guide({ onClose }: { onClose: () => void }) {
  return (
    <section className="ui-card pr-guide" aria-labelledby="guide-title">
      <div className="pr-guide-head">
        <div>
          <p className="kicker">New here?</p>
          <h2 id="guide-title">Practise in three steps</h2>
        </div>
        <button type="button" className="pr-link" onClick={onClose}>
          Got it
        </button>
      </div>
      <ol className="pr-steps">
        <li>
          <b>1</b>
          <div>
            <strong>Pick a gap</strong>
            <p>
              The Overview's Pair check shows which gaps are unusual today. Or
              simply pick a product to buy or sell.
            </p>
          </div>
        </li>
        <li>
          <b>2</b>
          <div>
            <strong>Place a practice trade</strong>
            <p>
              Choose a size in grams. It fills at the live MCX price, with the
              same costs as the backtest.
            </p>
          </div>
        </li>
        <li>
          <b>3</b>
          <div>
            <strong>Watch it and close</strong>
            <p>
              Profit or loss updates every 30 seconds. Close whenever you like
              while the market is open.
            </p>
          </div>
        </li>
      </ol>
      <p className="pr-fineprint">
        Demo money (◎) has no cash value. It can't be bought, withdrawn or sent
        to anyone.
      </p>
    </section>
  )
}

function SignedOut() {
  return (
    <section className="ui-card pr-signedout">
      <p className="kicker">Practice trading</p>
      <h2>Learn with ◎ 10,00,000 of demo money</h2>
      <p>
        Practise on real MCX gold prices without risking anything. Every new
        account starts with ◎ 10,00,000 — demo money with no cash value.
      </p>
      <ul>
        <li>Trade the gap between two gold products, or one product alone</li>
        <li>Profit and loss update live while MCX is open</li>
        <li>Reset any time and start again</li>
      </ul>
      <Link className="ui-button primary" to="/login?returnTo=/app/practice">
        Log in to start
      </Link>
    </section>
  )
}

/* ------------------------------------------------------------------------ */

function Ticket({ summary }: { summary: PracticeSummary }) {
  const [params] = useSearchParams()
  const requestedPair = params.get('pair')
  const requestedSide = params.get('side')
  const pairs = summary.instruments.pairs
  const products = summary.instruments.products
  const [kind, setKind] = useState<PracticeKind>('pair')
  const [pair, setPair] = useState(
    pairs.find((p) => p.pair === requestedPair)?.pair ??
      pairs[0]?.pair ??
      'GOLDTEN-GOLDPETAL',
  )
  const [product, setProduct] = useState('GOLDTEN')
  const selectedPair = pairs.find((p) => p.pair === pair)
  const selectedProduct = products.find((p) => p.product === product)
  const [pairSide, setPairSide] = useState<PracticeSide | null>(
    requestedSide === 'rise' || requestedSide === 'fall' ? requestedSide : null,
  )
  const [productSide, setProductSide] = useState<PracticeSide>('buy')
  const side: PracticeSide =
    kind === 'pair'
      ? (pairSide ?? selectedPair?.suggested ?? 'fall')
      : productSide
  const lot =
    kind === 'pair' ? (selectedPair?.lot ?? 1) : (selectedProduct?.lot ?? 1)
  const [grams, setGrams] = useState(0)
  const size = grams > 0 ? grams : Math.max(lot, Math.ceil(100 / lot) * lot)
  const gramsId = useId()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{
    tone: 'ok' | 'error'
    text: string
  }>()

  const prices =
    kind === 'pair'
      ? [selectedPair?.price_a, selectedPair?.price_b]
      : [selectedProduct?.price]
  const known = prices.every((p) => typeof p === 'number')
  const legNotional = (price: number | null | undefined) =>
    typeof price === 'number' ? (size * price) / 10 : 0
  const gross = prices.reduce<number>((sum, p) => sum + legNotional(p), 0)
  const margin = (gross * summary.limits.margin_pct) / 100
  const cost = (gross * summary.limits.cost_bps) / 10_000
  const tradable =
    kind === 'pair' ? selectedPair?.tradable : selectedProduct?.tradable
  const sizeError =
    size % lot !== 0
      ? `Use a multiple of ${lot} g.`
      : size > summary.limits.max_grams
        ? `Maximum ${rupee.format(summary.limits.max_grams)} g per trade.`
        : known && margin + cost > summary.available
          ? 'Not enough demo money for this size.'
          : null
  const blocked = !summary.market.can_trade
    ? summary.market.reason
    : !tradable
      ? 'A contract in this trade has not traded yet today.'
      : sizeError

  const place = async () => {
    setBusy(true)
    setMessage(undefined)
    try {
      await practiceApi.order({
        request_id: newRequestId(),
        kind,
        instrument: kind === 'pair' ? pair : product,
        side,
        grams: size,
      })
      setMessage({
        tone: 'ok',
        text: `Practice trade placed: ${sideLabel(kind, side)} · ${size} g ${kind === 'pair' ? pairLabel(pair) : product}.`,
      })
      await refreshPractice()
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Trade failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  const [a, b] = pairParts(pair)
  return (
    <section className="ui-card pk pr-ticket" aria-labelledby="ticket-title">
      <div className="pr-ticket-tabs" role="tablist" aria-label="Trade type">
        {(['pair', 'product'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={kind === value}
            onClick={() => {
              setKind(value)
              setGrams(0)
            }}
          >
            {value === 'pair' ? 'Pair' : 'Product'}
          </button>
        ))}
      </div>
      <h2 id="ticket-title" className="sr-only">
        New practice trade
      </h2>

      {kind === 'pair' ? (
        <>
          <label className="pk-label" htmlFor={`${gramsId}-pair`}>
            Pair
          </label>
          <div className="pk-select">
            <select
              id={`${gramsId}-pair`}
              value={pair}
              onChange={(event) => {
                setPair(event.target.value)
                setPairSide(null)
                setGrams(0)
              }}
            >
              {pairs.map((p) => (
                <option key={p.pair} value={p.pair}>
                  {pairLabel(p.pair)}
                </option>
              ))}
            </select>
          </div>
          <div className="pr-gap">
            <div>
              <span>Gap now</span>
              <strong>{inr(selectedPair?.gap)}</strong>
            </div>
            <GapChip z={selectedPair?.z} />
          </div>
          <Seg
            label="Direction"
            value={side}
            onChange={(value) => setPairSide(value)}
            options={[
              { value: 'fall', label: 'Gap to fall' },
              { value: 'rise', label: 'Gap to rise' },
            ]}
          />
          <p className="pr-explain">
            {side === 'fall'
              ? `Sells ${a} and buys ${b}. Profits if the gap falls.`
              : `Buys ${a} and sells ${b}. Profits if the gap rises.`}
            {selectedPair?.suggested
              ? ` Unusual gaps tend to move back toward usual, so the suggestion is “${sideLabel('pair', selectedPair.suggested)}”.`
              : ''}
          </p>
        </>
      ) : (
        <>
          <label className="pk-label" htmlFor={`${gramsId}-product`}>
            Product
          </label>
          <div className="pk-select">
            <select
              id={`${gramsId}-product`}
              value={product}
              onChange={(event) => {
                setProduct(event.target.value)
                setGrams(0)
              }}
            >
              {products.map((p) => (
                <option key={p.product} value={p.product}>
                  {p.product}
                  {p.expiry ? ` · exp ${shortDate(p.expiry)}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="pr-gap">
            <div>
              <span>Price per 10 g</span>
              <strong>{inr(selectedProduct?.price)}</strong>
            </div>
          </div>
          <Seg
            label="Direction"
            value={side}
            onChange={(value) => setProductSide(value)}
            options={[
              { value: 'buy', label: 'Buy' },
              { value: 'sell', label: 'Sell' },
            ]}
          />
          <p className="pr-explain">
            {side === 'buy'
              ? 'Profits if the price rises.'
              : 'Profits if the price falls.'}
          </p>
        </>
      )}

      <label className="pk-label" htmlFor={gramsId}>
        Size (grams)
      </label>
      <div className="pr-size">
        <button
          type="button"
          aria-label="Smaller"
          onClick={() => setGrams(Math.max(lot, size - lot))}
        >
          −
        </button>
        <input
          id={gramsId}
          type="number"
          inputMode="numeric"
          min={lot}
          step={lot}
          max={summary.limits.max_grams}
          value={size}
          onChange={(event) =>
            setGrams(Math.max(0, Number(event.target.value)))
          }
        />
        <button
          type="button"
          aria-label="Larger"
          onClick={() =>
            setGrams(Math.min(summary.limits.max_grams, size + lot))
          }
        >
          +
        </button>
      </div>
      <div className="pr-quick" role="group" aria-label="Quick sizes">
        {[1, 5, 10, 50].map((n) => {
          const value = Math.max(lot, Math.ceil((n * 10) / lot) * lot)
          return (
            <button key={n} type="button" onClick={() => setGrams(value)}>
              {value} g
            </button>
          )
        })}
      </div>

      <dl className="pk-rows">
        <div>
          <dt>Trade value</dt>
          <dd>{known ? demoMoney(gross) : '—'}</dd>
        </div>
        <div>
          <dt>Margin held ({summary.limits.margin_pct}%)</dt>
          <dd>{known ? demoMoney(margin) : '—'}</dd>
        </div>
        <div>
          <dt>Entry cost</dt>
          <dd>{known ? demoMoney(cost, true) : '—'}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{demoMoney(summary.available)}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="ui-button primary pk-cta"
        disabled={busy || Boolean(blocked)}
        onClick={place}
      >
        {busy ? 'Placing…' : 'Place practice trade'}
      </button>
      {blocked && <p className="pr-blocked">{blocked}</p>}
      {message && (
        <p className={`pr-message is-${message.tone}`} role="status">
          {message.text}
        </p>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------------ */

function InstrumentCell({ row }: { row: PracticePosition }) {
  const legs =
    row.kind === 'pair' ? pairParts(row.instrument) : [row.instrument]
  return (
    <td className="ov-pair-cell">
      <span className="pr-legs" aria-hidden="true">
        {legs.map((leg) => (
          <i key={leg} style={{ background: productColor(leg) }} />
        ))}
      </span>
      {row.kind === 'pair' ? pairLabel(row.instrument) : row.instrument}
      <span>
        {sideLabel(row.kind, row.side)} · {row.grams} g · exp{' '}
        {shortDate(row.expiry)}
      </span>
    </td>
  )
}

function OpenTrades({
  summary,
  onNotice,
}: {
  summary: PracticeSummary
  onNotice: (text: string, tone: 'ok' | 'error') => void
}) {
  const [closing, setClosing] = useState<number | null>(null)
  const close = async (row: PracticePosition) => {
    setClosing(row.id)
    try {
      const result = await practiceApi.close(row.id)
      onNotice(
        `Closed ${row.kind === 'pair' ? pairLabel(row.instrument) : row.instrument}: ${signedDemo(result.net, true)} after costs.`,
        'ok',
      )
      await refreshPractice()
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : 'Close failed.',
        'error',
      )
    } finally {
      setClosing(null)
    }
  }
  return (
    <section className="ui-card" aria-labelledby="open-title">
      <div className="ui-card-head">
        <h2 id="open-title">Open trades</h2>
        <p>
          {summary.positions.length} of {summary.limits.max_open} · updates
          every 30 s
        </p>
      </div>
      {summary.positions.length ? (
        <div className="ui-table-scroll">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Trade</th>
                <th className="num">Entry</th>
                <th className="num">Now</th>
                <th className="num">Profit / loss</th>
                <th className="num hide-sm">If closed now</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {summary.positions.map((row) => {
                const entry =
                  row.kind === 'pair'
                    ? row.entry_a - (row.entry_b ?? 0)
                    : row.entry_a
                const now =
                  row.kind === 'pair'
                    ? (row.mark_a ?? 0) - (row.mark_b ?? 0)
                    : row.mark_a
                return (
                  <tr key={row.id}>
                    <InstrumentCell row={row} />
                    <td className="num">
                      {row.kind === 'pair' ? 'gap ' : ''}
                      {inr(entry)}
                    </td>
                    <td className="num">
                      {row.kind === 'pair' ? 'gap ' : ''}
                      {inr(now)}
                      {row.mark_source !== 'live' && (
                        <small className="pr-stale"> last close</small>
                      )}
                    </td>
                    <td className={`num tone-${toneOf(row.open_pnl)}`}>
                      {signedDemo(row.open_pnl)}
                    </td>
                    <td
                      className={`num hide-sm tone-${toneOf(row.net_if_closed)}`}
                    >
                      {signedDemo(row.net_if_closed)}
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="pr-close"
                        disabled={
                          closing === row.id || !summary.market.can_trade
                        }
                        title={
                          summary.market.can_trade
                            ? 'Close at the live price'
                            : summary.market.reason
                        }
                        onClick={() => close(row)}
                      >
                        {closing === row.id ? '…' : 'Close'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ui-muted-note pr-empty">
          No open trades. Use the ticket to place your first practice trade.
        </p>
      )}
    </section>
  )
}

function History({ summary }: { summary: PracticeSummary }) {
  if (!summary.history.length) return null
  return (
    <section className="ui-card" aria-labelledby="history-title">
      <div className="ui-card-head">
        <h2 id="history-title">History</h2>
        <p>Last {summary.history.length} closed trades · after costs</p>
      </div>
      <div className="ui-table-scroll">
        <table className="ui-table">
          <thead>
            <tr>
              <th>Trade</th>
              <th className="hide-sm">Closed</th>
              <th className="num hide-sm">Costs</th>
              <th className="num">Result</th>
            </tr>
          </thead>
          <tbody>
            {summary.history.map((row) => (
              <tr key={row.id}>
                <InstrumentCell row={row} />
                <td className="hide-sm">
                  {when(row.closed_at)}
                  {row.close_reason === 'expired' && (
                    <small className="pr-stale"> · expired</small>
                  )}
                </td>
                <td className="num hide-sm">
                  {demoMoney(
                    (row.entry_cost ?? 0) + (row.exit_cost ?? 0),
                    true,
                  )}
                </td>
                <td className={`num tone-${toneOf(row.net)}`}>
                  {signedDemo(row.net, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------------ */

function Leaderboard({ summary }: { summary: PracticeSummary }) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null)
  const [you, setYou] = useState<LeaderboardEntry | null>(null)
  const [name, setName] = useState(summary.profile.display_name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const nameId = useId()
  const joined = summary.profile.leaderboard
  const closedTrades = summary.stats.trades

  useEffect(() => {
    let active = true
    practiceApi
      .leaderboard()
      .then((result) => {
        if (!active) return
        setEntries(result.entries)
        setYou(result.you)
      })
      .catch(() => active && setEntries([]))
    return () => {
      active = false
    }
  }, [joined, closedTrades])

  const save = async (leaderboard: boolean) => {
    setBusy(true)
    setError(undefined)
    try {
      await practiceApi.profile({
        leaderboard,
        display_name: name.trim() || null,
      })
      await refreshPractice()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ui-card" aria-labelledby="board-title">
      <div className="ui-card-head">
        <h2 id="board-title">Leaderboard</h2>
        <p>Return on demo money · opt-in</p>
      </div>
      {entries === null ? (
        <p className="ui-muted-note">Loading…</p>
      ) : entries.length ? (
        <ol className="pr-board">
          {[...entries, ...(you ? [you] : [])].map((entry) => (
            <li
              key={`${entry.rank}-${entry.name}`}
              className={entry.you ? 'is-you' : ''}
            >
              <b>{entry.rank}</b>
              <span>
                {entry.name}
                {entry.you ? ' (you)' : ''}
              </span>
              <small>{entry.trades} trades</small>
              <strong className={`tone-${toneOf(entry.return_pct)}`}>
                {signedPct(entry.return_pct)}
              </strong>
            </li>
          ))}
        </ol>
      ) : (
        <p className="ui-muted-note">
          No one has joined yet. Players appear after their first closed trade.
        </p>
      )}
      <div className="pr-join">
        {joined ? (
          <>
            <p>
              You appear as <strong>{summary.profile.display_name}</strong>.
            </p>
            <button
              type="button"
              className="pr-link"
              disabled={busy}
              onClick={() => save(false)}
            >
              Leave leaderboard
            </button>
          </>
        ) : (
          <>
            <label htmlFor={nameId}>Display name (shown to others)</label>
            <div className="pr-join-row">
              <input
                id={nameId}
                value={name}
                maxLength={24}
                placeholder="e.g. GoldWatcher"
                onChange={(event) => setName(event.target.value)}
              />
              <button
                type="button"
                className="ui-button"
                disabled={busy || name.trim().length < 3}
                onClick={() => save(true)}
              >
                Join
              </button>
            </div>
            <small>
              3–24 letters, numbers, spaces, dots, dashes or underscores. Only
              this name and your return are shown.
            </small>
          </>
        )}
        {error && <p className="pr-message is-error">{error}</p>}
      </div>
    </section>
  )
}

function Achievements({ summary }: { summary: PracticeSummary }) {
  const earned = summary.achievements.filter((a) => a.earned_at).length
  return (
    <section className="ui-card" aria-labelledby="ach-title">
      <div className="ui-card-head">
        <h2 id="ach-title">Achievements</h2>
        <p>
          {earned} of {summary.achievements.length}
        </p>
      </div>
      <ul className="pr-badges">
        {summary.achievements.map((item) => (
          <li key={item.code} className={item.earned_at ? 'is-earned' : ''}>
            <i aria-hidden="true">{item.earned_at ? '★' : '☆'}</i>
            <div>
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="pr-week">
        <h3>Last 7 days</h3>
        <dl>
          <div>
            <dt>Closed trades</dt>
            <dd>{summary.week.trades}</dd>
          </div>
          <div>
            <dt>Winners</dt>
            <dd>{summary.week.wins}</dd>
          </div>
          <div>
            <dt>Result</dt>
            <dd className={`tone-${toneOf(summary.week.realized)}`}>
              {signedDemo(summary.week.realized)}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------------ */

export function PracticePage() {
  const { status, summary, error } = usePractice()
  const [guideHidden, setGuideHidden] = useState(readGuide)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string }>()
  const [resetting, setResetting] = useState(false)

  const hideGuide = () => {
    setGuideHidden(true)
    try {
      localStorage.setItem(GUIDE_KEY, '1')
    } catch {
      /* storage unavailable */
    }
  }
  const reset = async () => {
    if (
      !window.confirm(
        'Reset demo money to ◎ 10,00,000? Open trades and history are cleared.',
      )
    )
      return
    setResetting(true)
    try {
      await practiceApi.reset()
      setNotice({ tone: 'ok', text: 'Demo money reset. Fresh start!' })
      await refreshPractice()
    } catch (e) {
      setNotice({
        tone: 'error',
        text: e instanceof Error ? e.message : 'Reset failed.',
      })
    } finally {
      setResetting(false)
    }
  }
  const showGuide = !guideHidden

  return (
    <div className="db pr-page">
      <header className="db-head">
        <div>
          <p className="kicker">Demo money · no cash value</p>
          <h1>Practice</h1>
        </div>
        {summary && (
          <div className="db-head-meta">
            <span
              className={`ov-source ${summary.market.can_trade ? 'is-live' : 'is-settled'}`}
            >
              <i aria-hidden="true" />
              <b>{summary.market.can_trade ? 'Open' : 'Closed'}</b>
              <span>
                {summary.market.can_trade
                  ? 'Trades fill at live prices'
                  : 'Trading resumes next session'}
              </span>
            </span>
            <button
              type="button"
              className="db-flag"
              disabled={resetting}
              onClick={reset}
            >
              Reset demo money
            </button>
          </div>
        )}
      </header>

      {status === 'signed-out' ? (
        <SignedOut />
      ) : !summary ? (
        status === 'error' ? (
          <div className="error-notice" role="alert">
            <span>{error}</span>
            <button className="button" onClick={() => refreshPractice()}>
              Retry
            </button>
          </div>
        ) : (
          <p className="ui-muted-note">Loading your demo account…</p>
        )
      ) : (
        <div className="db-grid">
          {showGuide && <Guide onClose={hideGuide} />}
          {notice && (
            <p
              className={`pr-message is-${notice.tone} pr-banner`}
              role="status"
            >
              {notice.text}
            </p>
          )}

          <dl className="db-stats ui-card pr-wallet">
            <div>
              <dt>Account value</dt>
              <dd className="db-stat-strong">{demoMoney(summary.equity)}</dd>
            </div>
            <div>
              <dt>Return</dt>
              <dd className={`tone-${toneOf(summary.return_pct)}`}>
                {signedPct(summary.return_pct)}
              </dd>
            </div>
            <div>
              <dt>Cash</dt>
              <dd>{demoMoney(summary.balance)}</dd>
            </div>
            <div>
              <dt>Open P&amp;L</dt>
              <dd className={`tone-${toneOf(summary.open_pnl)}`}>
                {signedDemo(summary.open_pnl)}
              </dd>
            </div>
            <div>
              <dt>Margin held</dt>
              <dd>{demoMoney(summary.margin_in_use)}</dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd>{demoMoney(summary.available)}</dd>
            </div>
            <div>
              <dt>Win rate</dt>
              <dd>
                {summary.stats.win_rate === null
                  ? '—'
                  : `${Math.round(summary.stats.win_rate)}% of ${summary.stats.trades}`}
              </dd>
            </div>
          </dl>

          <div className="db-main">
            <div className="pr-left">
              <OpenTrades
                summary={summary}
                onNotice={(text, tone) => setNotice({ text, tone })}
              />
              <History summary={summary} />
            </div>
            <Ticket summary={summary} />
          </div>

          <div className="db-bottom">
            <Achievements summary={summary} />
            <Leaderboard summary={summary} />
          </div>

          <p className="ov-live-note">
            Demo money (◎) is practice money with no cash value. It can't be
            bought, withdrawn or transferred. Prices are MCX last-traded prices;
            costs are {summary.limits.cost_bps} bps per leg each way, as in the
            backtest.
          </p>
        </div>
      )}
    </div>
  )
}
