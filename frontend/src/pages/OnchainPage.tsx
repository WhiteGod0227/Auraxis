import { lazy, Suspense, useEffect, useState } from 'react'
import { Seg } from '@/components/OverviewWidgets'
import { Skeleton } from '@/components/ui'
import { productColor } from '@/lib/chartTheme'
import { longDate, shortDate } from '@/lib/insight'
import { ago, useNow } from '@/lib/live'
import { onchainApi, shortAddress } from '@/lib/onchain'
import type { OnchainGold, OnchainHistory, OnchainToken } from '@/lib/onchain'
import '@/styles/dashboard.css'
import '@/styles/onchain.css'

const OnchainChart = lazy(() => import('@/components/OnchainChart'))
const PRODUCTS = ['GOLDM', 'GOLDTEN', 'GOLDGUINEA', 'GOLDPETAL'] as const
type Product = (typeof PRODUCTS)[number]
type TokenSymbol = 'PAXG' | 'XAUT'
const REFRESH_MS = 60_000

const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})
const inr = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value < 0 ? '−' : ''}₹${whole.format(Math.abs(value))}`
    : '—'
const signedInr = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value > 0 ? '+' : value < 0 ? '−' : ''}₹${whole.format(Math.abs(value))}`
    : '—'
const signedPct = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}%`
    : '—'
const toneOf = (value: number | null | undefined) =>
  typeof value === 'number' && value !== 0
    ? value > 0
      ? 'up'
      : 'down'
    : 'neutral'

function TokenCard({ token, duty }: { token: OnchainToken; duty: number }) {
  return (
    <article className="ui-card oc-token">
      <div className="oc-token-head">
        <span className="oc-token-mark" aria-hidden="true">
          {token.symbol.slice(0, 2)}
        </span>
        <div>
          <h2>{token.name}</h2>
          <p>
            {token.symbol} · issued by {token.issuer} · {token.chain}
          </p>
        </div>
      </div>
      <dl className="oc-token-figures">
        <div>
          <dt>Price per token (1 oz)</dt>
          <dd className="oc-strong">{inr(token.price_inr)}</dd>
          <small>
            {typeof token.price_usd === 'number'
              ? usd.format(token.price_usd)
              : '—'}
          </small>
        </div>
        <div>
          <dt>India parity / 10 g</dt>
          <dd className="oc-strong">{inr(token.parity_p10)}</dd>
          <small>incl. {duty}% import duty</small>
        </div>
        <div>
          <dt>On-chain supply</dt>
          <dd>
            {typeof token.supply_tokens === 'number'
              ? whole.format(token.supply_tokens)
              : '—'}{' '}
            <span>tokens</span>
          </dd>
          <small>
            {typeof token.supply_tonnes === 'number'
              ? `≈ ${token.supply_tonnes.toFixed(1)} tonnes of gold`
              : 'Reading from Ethereum…'}
          </small>
        </div>
      </dl>
      <a
        className="oc-contract"
        href={token.explorer_url}
        target="_blank"
        rel="noreferrer noopener"
      >
        <span>ERC-20 contract</span>
        <code>{shortAddress(token.contract)}</code>
        <span aria-hidden="true">↗</span>
      </a>
    </article>
  )
}

export function OnchainPage() {
  const [gold, setGold] = useState<OnchainGold | null>(null)
  const [error, setError] = useState<string>()
  const [product, setProduct] = useState<Product>('GOLDTEN')
  const [token, setToken] = useState<TokenSymbol>('PAXG')
  const [history, setHistory] = useState<OnchainHistory | null>(null)
  const [historyError, setHistoryError] = useState<string>()
  const now = useNow(5000)

  useEffect(() => {
    let timer: number | undefined
    const controller = new AbortController()
    const load = () =>
      onchainApi
        .gold(controller.signal)
        .then((value) => {
          setGold(value)
          setError(undefined)
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : 'Unavailable.')
        })
        .finally(() => {
          if (!controller.signal.aborted)
            timer = window.setTimeout(load, REFRESH_MS)
        })
    void load()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    onchainApi
      .history(product, controller.signal)
      .then((value) => {
        setHistory(value)
        setHistoryError(undefined)
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setHistoryError(e instanceof Error ? e.message : 'Unavailable.')
      })
    return () => controller.abort()
  }, [product])

  const gaps = (history?.points ?? [])
    .map((p) => {
      const parity = p[`${token}_parity`]
      const gap = p[`${token}_gap`]
      return parity && gap !== null ? (100 * gap) / parity : null
    })
    .filter((v): v is number => v !== null)
  const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null
  const firstDay = history?.points[0]?.date
  const lastDay = history?.points.at(-1)?.date
  // Only list "Duty change" when a change actually falls inside the chart.
  const dutyChangeShown = Boolean(
    firstDay &&
    lastDay &&
    gold?.duty_schedule.some((d) => d.start > firstDay && d.start <= lastDay),
  )

  return (
    <div className="db oc-page">
      <header className="db-head">
        <div>
          <p className="kicker">Web3 · read-only</p>
          <h1>On-chain gold</h1>
        </div>
        {gold && (
          <div className="db-head-meta">
            <span className="ov-source is-live">
              <i aria-hidden="true" />
              <b>Ethereum</b>
              <span>
                Updated {ago(gold.updated_at, now) ?? '—'} · duty{' '}
                {gold.duty_pct}%
              </span>
            </span>
          </div>
        )}
      </header>
      <p className="oc-intro">
        Tokenized gold lives on the Ethereum blockchain: each PAXG or XAUT token
        is one fine troy ounce held by its issuer, and trades around the clock.
        Converted to ₹ per 10 g with India's import duty, it shows whether MCX
        gold is dear or cheap against gold on-chain.
      </p>

      {error && !gold ? (
        <div className="error-notice" role="alert">
          <span>{error}</span>
        </div>
      ) : !gold ? (
        <div className="ui-stack">
          <Skeleton height={220} />
          <Skeleton height={260} />
        </div>
      ) : (
        <div className="db-grid">
          {gold.errors.length > 0 && (
            <p className="pr-message is-error" role="status">
              Some data is delayed: {gold.errors.join(' · ')}
            </p>
          )}
          <div className="oc-tokens">
            {gold.tokens.map((item) => (
              <TokenCard key={item.symbol} token={item} duty={gold.duty_pct} />
            ))}
          </div>

          <section className="ui-card" aria-labelledby="cmp-title">
            <div className="ui-card-head">
              <h2 id="cmp-title">MCX vs on-chain gold, now</h2>
              <p>₹ per 10 g · positive gap = MCX dearer</p>
            </div>
            <div className="ui-table-scroll">
              <table className="ui-table oc-table">
                <thead>
                  <tr>
                    <th>MCX product</th>
                    <th className="num">MCX</th>
                    {gold.tokens.map((t) => (
                      <th key={t.symbol} className="num">
                        vs {t.symbol}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gold.mcx.map((row, index) => (
                    <tr key={row.product}>
                      <td className="ov-pair-cell">
                        <span className="oc-dot-name">
                          <i
                            style={{
                              background: productColor(row.product, index),
                            }}
                          />
                          {row.product}
                        </span>
                        <span>
                          {row.source === 'live'
                            ? 'Live'
                            : `Settled ${shortDate(row.as_of)}`}
                          {row.expiry ? ` · exp ${shortDate(row.expiry)}` : ''}
                        </span>
                      </td>
                      <td className="num">{inr(row.price_p10)}</td>
                      {gold.tokens.map((t) => {
                        const c = gold.comparisons.find(
                          (item) =>
                            item.product === row.product &&
                            item.token === t.symbol,
                        )
                        return (
                          <td key={t.symbol} className="num">
                            <span className={`tone-${toneOf(c?.gap)}`}>
                              {signedInr(c?.gap)}
                            </span>
                            <small className="oc-pct">
                              {signedPct(c?.gap_pct)}
                            </small>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  {!gold.mcx.length && (
                    <tr>
                      <td colSpan={2 + gold.tokens.length}>
                        <span className="ui-muted-note">
                          No MCX prices loaded yet.
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ui-card db-chart" aria-labelledby="hist-title">
            <div className="db-toolbar">
              <div>
                <h2 id="hist-title" className="oc-h2">
                  Gap over the past year
                </h2>
                <p className="oc-sub">
                  Daily MCX settlement vs {token} parity · ₹ per 10 g
                </p>
              </div>
              <div className="db-toolbar-right">
                <Seg
                  label="MCX product"
                  value={product}
                  onChange={setProduct}
                  options={PRODUCTS.map((p) => ({
                    value: p,
                    label: p.replace(/^GOLD/, '') || 'GOLD',
                  }))}
                />
                <Seg
                  label="Token"
                  value={token}
                  onChange={setToken}
                  options={['PAXG', 'XAUT'] as const}
                />
              </div>
            </div>
            {historyError ? (
              <p className="ui-muted-note pc-empty">{historyError}</p>
            ) : history ? (
              <Suspense fallback={<Skeleton height={340} />}>
                <OnchainChart
                  points={history.points}
                  token={token}
                  dutyChanges={gold.duty_schedule}
                />
              </Suspense>
            ) : (
              <Skeleton height={340} />
            )}
            <div className="db-chart-legend">
              <span>
                <i style={{ background: 'var(--text-strong)' }} />
                MCX {product} settlement
              </span>
              <span>
                <i style={{ background: 'var(--aqua)' }} />
                {token} parity (incl. duty)
              </span>
              {dutyChangeShown && (
                <span>
                  <i style={{ background: 'var(--amber)' }} />
                  Duty change
                </span>
              )}
              <span className="db-chart-note">
                Average gap {signedPct(avg)}
                {lastDay
                  ? ` · ${shortDate(lastDay)} settle ${signedPct(gaps.at(-1))}`
                  : ''}
              </span>
            </div>
          </section>

          <section className="ui-card" aria-labelledby="assume-title">
            <div className="ui-card-head">
              <h2 id="assume-title">How this is calculated</h2>
              <p>Research only · nothing is bought or written on-chain</p>
            </div>
            <ul className="oc-assumptions">
              {gold.assumptions.map((text) => (
                <li key={text}>{text}</li>
              ))}
              <li>
                Duty schedule:{' '}
                {gold.duty_schedule
                  .map((d) => `${d.pct}% from ${longDate(d.start)}`)
                  .join(' · ')}
                .
              </li>
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}
