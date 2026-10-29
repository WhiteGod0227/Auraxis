import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from '@/lib/useAccount'
import { session } from '@/lib/auth'
import { useResource } from '@/lib/useResource'
import { accountAlerts, mergeAlertRules } from '@/lib/accountAlerts'
import type { AlertRule } from '@/lib/alerts'

function SignedInAlerts({
  browserRules,
  apply,
}: {
  browserRules: AlertRule[]
  apply: (rules: AlertRule[], message: string) => void
}) {
  const resource = useResource(
    useCallback(
      async () => ({ data: await accountAlerts.get(), source: 'API' as const }),
      [],
    ),
  )
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const data = resource.response?.data
  async function save(rules: AlertRule[]) {
    if (!data || lock.current) return
    lock.current = true
    setBusy(true)
    setMessage('')
    const epoch = session.getSnapshot().epoch
    try {
      await accountAlerts.replace(data.revision, rules)
      if (session.getSnapshot().epoch === epoch) {
        resource.retry()
        setMessage('Account rules saved.')
      }
    } catch (error) {
      if (session.getSnapshot().epoch === epoch)
        setMessage(
          (error instanceof Error ? error.message : 'Save failed.') +
            ' Reload account rules before retrying.',
        )
      resource.retry()
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <section
      className="panel alert-form"
      aria-label="Account alert synchronization"
    >
      <h2>Account alerts</h2>
      <p>
        Explicitly merge rules between this browser and your private account.
        Nothing syncs automatically; account rules are never used as an offline
        fallback.
      </p>
      {resource.loading && <p role="status">Loading account rules...</p>}
      {resource.error && <p role="alert">{resource.error}</p>}
      {data && (
        <>
          <p>{data.rules.length} saved account rules.</p>
          <ul>
            {data.rules.map((rule) => (
              <li key={rule.id}>
                {rule.pair}:{' '}
                {rule.metric === 'abs_z'
                  ? 'absolute z-score'
                  : 'absolute spread %'}{' '}
                &ge; {rule.threshold}; {rule.expiry ?? 'latest eligible expiry'}{' '}
                <button
                  className="button"
                  disabled={busy || resource.loading}
                  onClick={() =>
                    void save(data.rules.filter((r) => r.id !== rule.id))
                  }
                >
                  Remove account rule
                </button>
              </li>
            ))}
          </ul>
          <div className="alert-actions">
            <button
              className="button"
              disabled={busy || resource.loading || !browserRules.length}
              onClick={() => {
                try {
                  void save(mergeAlertRules(data.rules, browserRules))
                } catch (error) {
                  setMessage((error as Error).message)
                }
              }}
            >
              Merge browser rules into account
            </button>
            <button
              className="button"
              disabled={busy || resource.loading || !data.rules.length}
              onClick={() => {
                try {
                  apply(
                    mergeAlertRules(browserRules, data.rules),
                    'Account rules merged into this browser.',
                  )
                } catch (error) {
                  setMessage((error as Error).message)
                }
              }}
            >
              Use account rules in this browser
            </button>
          </div>
        </>
      )}
      <button
        className="button"
        disabled={busy || resource.loading}
        onClick={resource.retry}
      >
        Reload account rules
      </button>
      <p role="status">{message}</p>
    </section>
  )
}
export default function AccountAlerts(props: {
  browserRules: AlertRule[]
  apply: (rules: AlertRule[], message: string) => void
}) {
  const account = useAccount()
  return account.user ? (
    <SignedInAlerts key={account.epoch} {...props} />
  ) : (
    <p className="context-note">
      <Link to="/login?returnTo=%2Fapp%2Falerts">
        Sign in to sync alert rules across devices
      </Link>
      . Browser rules remain separate.
    </p>
  )
}
