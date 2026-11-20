import { useCallback, useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from '@/lib/useAccount'
import { base64ToBytes, download, proofsApi, statusLabel } from '@/lib/proofs'
import type { ProofBundle, ProofSummary, VerifyResult } from '@/lib/proofs'
import '@/styles/dashboard.css'
import '@/styles/proofs.css'

const when = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata',
      }) + ' IST'
    : '—'
const short = (hex: string | null | undefined) =>
  hex ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : '—'
const kindLabel = (kind: string) =>
  kind === 'practice_trade'
    ? 'Practice trade'
    : kind === 'research'
      ? 'Research note'
      : kind

function StatusChip({ status }: { status: ProofSummary['status'] }) {
  return (
    <span className={`pf-chip is-${status}`}>
      <i aria-hidden="true" />
      {statusLabel[status]}
    </span>
  )
}

function ProofDetail({ id }: { id: number }) {
  const [bundle, setBundle] = useState<ProofBundle | null>(null)
  const [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    proofsApi
      .get(id)
      .then((value) => active && setBundle(value))
      .catch(
        (e: unknown) =>
          active && setError(e instanceof Error ? e.message : 'Unavailable.'),
      )
    return () => {
      active = false
    }
  }, [id])
  if (error) return <p className="pr-message is-error">{error}</p>
  if (!bundle) return <p className="ui-muted-note">Loading proof…</p>
  const batch = bundle.batch
  return (
    <div className="pf-detail">
      <dl className="pf-facts">
        <div>
          <dt>Fingerprint (leaf)</dt>
          <dd>
            <code title={bundle.leaf}>{short(bundle.leaf)}</code>
          </dd>
        </div>
        <div>
          <dt>Merkle root</dt>
          <dd>
            <code title={bundle.root ?? ''}>{short(bundle.root)}</code>
          </dd>
        </div>
        <div>
          <dt>Batch</dt>
          <dd>
            {batch ? `#${batch.id} · sealed ${when(batch.created_at)}` : '—'}
          </dd>
        </div>
        <div>
          <dt>Bitcoin</dt>
          <dd>
            {batch?.bitcoin_height ? (
              <a
                href={`https://mempool.space/block/${batch.bitcoin_height}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Block {batch.bitcoin_height.toLocaleString('en-IN')} ·{' '}
                {when(batch.bitcoin_time)} ↗
              </a>
            ) : batch ? (
              'Submitted; usually confirms within a few hours'
            ) : (
              'Not sealed yet'
            )}
          </dd>
        </div>
        {batch?.evm && (
          <div>
            <dt>Also published on {batch.evm.network}</dt>
            <dd>
              <a
                href={batch.evm.tx_url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {batch.evm.status === 'confirmed'
                  ? `Block ${batch.evm.block?.toLocaleString('en-IN') ?? '—'} ↗`
                  : 'Pending ↗'}
              </a>
            </dd>
          </div>
        )}
      </dl>
      <div className="pf-downloads">
        <button
          type="button"
          className="ui-button"
          onClick={() =>
            download(
              `auraxis-proof-${bundle.record.id}.json`,
              JSON.stringify(bundle, null, 2),
              'application/json',
            )
          }
        >
          Download proof file
        </button>
        {batch?.ots_base64 && (
          <>
            <button
              type="button"
              className="ui-button"
              onClick={() =>
                download(
                  `auraxis-batch-${batch.id}.txt`,
                  batch.document,
                  'text/plain',
                )
              }
            >
              Stamped document (.txt)
            </button>
            <button
              type="button"
              className="ui-button"
              onClick={() =>
                download(
                  `auraxis-batch-${batch.id}.txt.ots`,
                  base64ToBytes(batch.ots_base64!),
                  'application/octet-stream',
                )
              }
            >
              Timestamp (.ots)
            </button>
          </>
        )}
      </div>
      {batch?.ots_base64 && (
        <p className="pf-hint">
          Independent check: upload the .txt and .ots files at{' '}
          <a
            href="https://opentimestamps.org"
            target="_blank"
            rel="noreferrer noopener"
          >
            opentimestamps.org
          </a>
          . The proof file links this record to the root named in the .txt.
        </p>
      )}
    </div>
  )
}

function MyProofs() {
  const { user, checked } = useAccount()
  const [data, setData] = useState<{
    batch_minutes: number
    proofs: ProofSummary[]
  } | null>(null)
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState<number | null>(null)

  const load = useCallback(() => {
    proofsApi
      .list()
      .then((value) => {
        setData(value)
        setError(undefined)
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Unavailable.'),
      )
  }, [])
  useEffect(() => {
    if (!user) return
    load()
    const timer = window.setInterval(load, 60_000)
    return () => window.clearInterval(timer)
  }, [user, load])

  if (checked && !user)
    return (
      <section className="ui-card pf-signedout">
        <h2>Your proofs</h2>
        <p>
          Log in to certify research notes and see proofs for your practice
          trades. Anyone can verify a shared proof below without an account.
        </p>
        <Link className="ui-button primary" to="/login?returnTo=/app/proofs">
          Log in
        </Link>
      </section>
    )
  return (
    <section className="ui-card" aria-labelledby="mine-title">
      <div className="ui-card-head">
        <h2 id="mine-title">Your proofs</h2>
        <p>
          {data
            ? `New records seal every ${Math.round(data.batch_minutes)} min`
            : ''}
        </p>
      </div>
      {error && <p className="pr-message is-error">{error}</p>}
      {!data ? (
        <p className="ui-muted-note">Loading…</p>
      ) : data.proofs.length ? (
        <ul className="pf-list">
          {data.proofs.map((proof) => (
            <li key={proof.id} className={open === proof.id ? 'is-open' : ''}>
              <button
                type="button"
                className="pf-row"
                aria-expanded={open === proof.id}
                onClick={() => setOpen(open === proof.id ? null : proof.id)}
              >
                <span className="pf-title">
                  <strong>{proof.title}</strong>
                  <small>
                    {kindLabel(proof.kind)} · certified {when(proof.created_at)}
                  </small>
                </span>
                <StatusChip status={proof.status} />
              </button>
              {open === proof.id && <ProofDetail id={proof.id} />}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ui-muted-note pr-empty">
          No proofs yet. Closed practice trades are certified automatically;
          research notes can be certified from{' '}
          <Link to="/app/research">Research</Link>.
        </p>
      )}
    </section>
  )
}

function Verifier() {
  const [text, setText] = useState('')
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const inputId = useId()

  const verify = async (body: string) => {
    setBusy(true)
    setError(undefined)
    setResult(null)
    try {
      setResult(await proofsApi.verify(body))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="ui-card" aria-labelledby="verify-title">
      <div className="ui-card-head">
        <h2 id="verify-title">Verify a proof</h2>
        <p>No login needed · nothing is stored</p>
      </div>
      <div className="pf-verify">
        <label className="pf-drop" htmlFor={inputId}>
          <input
            id={inputId}
            type="file"
            accept="application/json,.json"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              const body = await file.text()
              setText(body)
              void verify(body)
            }}
          />
          <strong>Choose a proof file</strong>
          <span>auraxis-proof-….json, or paste its contents below</span>
        </label>
        <textarea
          aria-label="Proof file contents"
          rows={5}
          value={text}
          placeholder='{"format": "auraxis-proof-v1", …}'
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="button"
          className="ui-button primary"
          disabled={busy || !text.trim()}
          onClick={() => void verify(text)}
        >
          {busy ? 'Verifying…' : 'Verify'}
        </button>
      </div>
      {error && <p className="pr-message is-error">{error}</p>}
      {result && (
        <div
          className={`pf-result ${result.valid ? 'is-valid' : 'is-invalid'}`}
        >
          <strong>
            {result.valid
              ? result.anchored
                ? 'Valid · anchored in Bitcoin'
                : 'Valid · Bitcoin confirmation pending'
              : 'Not valid'}
          </strong>
          <ul>
            {result.checks.map((check) => (
              <li key={check.name} className={check.ok ? 'ok' : 'no'}>
                <i aria-hidden="true">{check.ok ? '✓' : '✕'}</i>
                <span>
                  <b>{check.name}</b> — {check.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export function ProofsPage() {
  return (
    <div className="db pf-page">
      <header className="db-head">
        <div>
          <p className="kicker">Web3 · Bitcoin timestamps</p>
          <h1>Proof of research</h1>
        </div>
      </header>
      <p className="pf-intro">
        Prove that a research note or practice trade existed at a point in time
        and has not been changed since. Each record gets a secret-salted
        fingerprint; fingerprints are combined into one Merkle root that is
        timestamped in the Bitcoin blockchain through OpenTimestamps. Only the
        root leaves Auraxis.
      </p>
      <ol className="pf-steps">
        <li>
          <b>1</b>
          <span>
            <strong>Certify</strong>Practice trades are certified when they
            close; research notes with one click.
          </span>
        </li>
        <li>
          <b>2</b>
          <span>
            <strong>Seal</strong>New fingerprints are sealed into a Merkle root
            and sent to OpenTimestamps.
          </span>
        </li>
        <li>
          <b>3</b>
          <span>
            <strong>Anchor</strong>Within hours the root is committed to a
            Bitcoin block. Anyone can then verify the proof.
          </span>
        </li>
      </ol>
      <div className="db-grid">
        <MyProofs />
        <Verifier />
      </div>
    </div>
  )
}
