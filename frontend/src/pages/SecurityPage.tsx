import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from '@/lib/useAccount'
import { session } from '@/lib/auth'
import { useResource } from '@/lib/useResource'
import { securityRequest } from '@/lib/security'
import '@/styles/security.css'

function SecurityControls({
  signedOut,
}: {
  signedOut: (message: string) => void
}) {
  const resource = useResource(
    useCallback(
      async () => ({ data: await securityRequest(), source: 'API' as const }),
      [],
    ),
  )
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [secret, setSecret] = useState<string>()
  const [codes, setCodes] = useState<string[]>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  async function act(path: string) {
    if (lock.current || !password) return
    if (
      path === '/password' &&
      (newPassword.length < 8 ||
        newPassword.length > 128 ||
        !newPassword.trim())
    ) {
      setMessage('Choose a new password with 8–128 nonblank characters.')
      return
    }
    lock.current = true
    setBusy(true)
    setMessage('')
    setCodes(undefined)
    const epoch = session.getSnapshot().epoch
    try {
      const result = await securityRequest(path, {
        password,
        code,
        ...(path === '/password' ? { new_password: newPassword } : {}),
      })
      if (session.getSnapshot().epoch !== epoch) return
      setSecret(result.secret)
      setCodes(result.recovery_codes)
      setMessage(
        result.message ??
          'Setup key ready. Add it to your authenticator, then confirm using a current six-digit code.',
      )
      setCode('')
      if (path === '/password' || path === '/mfa/disable') {
        signedOut(result.message ?? 'Sign in again.')
        session.set(null)
      } else resource.retry()
    } catch (error) {
      if (session.getSnapshot().epoch === epoch)
        setMessage(
          error instanceof Error ? error.message : 'Security request failed.',
        )
    } finally {
      setBusy(false)
      lock.current = false
      if (path !== '/mfa/setup') {
        setPassword('')
        setNewPassword('')
      }
    }
  }
  const data = resource.response?.data
  return (
    <section
      className="panel security-panel"
      aria-label="Account security controls"
    >
      {resource.loading && <p role="status">Loading security settings...</p>}
      {resource.error && (
        <p role="alert">
          {resource.error}
          <button className="button" onClick={resource.retry}>
            Retry security settings
          </button>
        </p>
      )}
      {data && (
        <>
          <p>
            Authenticator MFA:{' '}
            <strong>{data.mfa_enabled ? 'Enabled' : 'Not enabled'}</strong>.
            Unused recovery codes: {data.recovery_codes_remaining}.
          </p>
          <p>
            Email ownership is not verified. Email verification/reset delivery
            is not configured.
          </p>
          <form className="research-form" onSubmit={(e) => e.preventDefault()}>
            <label htmlFor="security-password">Current password</label>
            <input
              id="security-password"
              type="password"
              autoComplete="current-password"
              value={password}
              maxLength={128}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
            />
            <label htmlFor="security-code">
              Authenticator or recovery code (if MFA is enabled)
            </label>
            <input
              id="security-code"
              autoComplete="one-time-code"
              value={code}
              maxLength={128}
              disabled={busy}
              onChange={(e) => setCode(e.target.value)}
            />
            <p>
              Authenticator codes expire every 30 seconds and cannot be reused.
              Wait for the next code if you just used one. Each recovery code
              works once.
            </p>
            <div className="security-actions">
              {!data.mfa_enabled ? (
                <button
                  className="button"
                  type="button"
                  disabled={busy || !password}
                  onClick={() => void act('/mfa/setup')}
                >
                  Set up authenticator
                </button>
              ) : (
                <button
                  className="button"
                  type="button"
                  disabled={busy || !password || !code}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Disable MFA, invalidate recovery codes and revoke all sessions?',
                      )
                    )
                      void act('/mfa/disable')
                  }}
                >
                  Disable MFA
                </button>
              )}
              <button
                className="button"
                type="button"
                disabled={busy || !password}
                onClick={() => {
                  if (
                    window.confirm(
                      'Generate eight new recovery codes? All previous codes will stop working.',
                    )
                  )
                    void act('/recovery-codes')
                }}
              >
                Generate recovery codes
              </button>
            </div>
            {secret && (
              <div className="security-secret">
                <p>
                  Add this manual key in your authenticator app (SHA-1, 6
                  digits, 30 seconds). It expires in 10 minutes.
                </p>
                <code>{secret}</code>
                <p>
                  Enter the app's six-digit code above and keep your current
                  password entered.
                </p>
                <button
                  className="button"
                  type="button"
                  disabled={busy || !password || !/^\d{6}$/.test(code)}
                  onClick={() => void act('/mfa/confirm')}
                >
                  Confirm authenticator
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() => setSecret(undefined)}
                >
                  Hide setup key
                </button>
              </div>
            )}
            <label htmlFor="security-new-password">New password</label>
            <input
              id="security-new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={newPassword}
              disabled={busy}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button
              className="button"
              type="button"
              disabled={busy || !password || !newPassword}
              onClick={() => void act('/password')}
            >
              Change password and sign out everywhere
            </button>
          </form>
        </>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      {codes && (
        <div className="security-secret">
          <strong>
            Save these codes privately now. They are displayed only once.
          </strong>
          <p>
            Keep them outside this browser and away from your password. They can
            reset your password or replace a second factor. Generating a new set
            invalidates this set.
          </p>
          <pre>{codes.join('\n')}</pre>
          <button className="button" onClick={() => setCodes(undefined)}>
            I saved the codes; hide them
          </button>
        </div>
      )}
    </section>
  )
}
export function SecurityPage() {
  const account = useAccount()
  const [message, setMessage] = useState('')
  return (
    <div className="overview-page security-page">
      <h1>Account security</h1>
      <p className="section-description">
        Manage your password, authenticator and offline recovery.
      </p>
      {message && <p role="status">{message}</p>}
      {!account.checked ? (
        <p role="status">Checking account...</p>
      ) : account.user ? (
        <SecurityControls key={account.epoch} signedOut={setMessage} />
      ) : (
        <p>
          <Link to="/login?returnTo=%2Fapp%2Fsecurity">
            Sign in to manage security
          </Link>
          .
        </p>
      )}
      <p>
        <Link to="/app/recover">
          Recover access using a saved recovery code
        </Link>
      </p>
    </div>
  )
}
export function RecoverPage() {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  return (
    <div className="overview-page security-page">
      <h1>Recover account</h1>
      <section className="panel security-panel">
        <p>
          Use a recovery code you previously saved. Email-based resets are not
          configured. If you have no code and cannot sign in, this self-service
          method cannot recover your account.
        </p>
        <form
          className="research-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (lock.current) return
            lock.current = true
            setBusy(true)
            setMessage('')
            const form = event.currentTarget
            const values = new FormData(form)
            try {
              const result = await securityRequest(
                '/recover',
                {
                  email: String(values.get('email')),
                  recovery_code: String(values.get('recovery_code')),
                  new_password: String(values.get('new_password')),
                },
                true,
              )
              setMessage(result.message ?? 'Password reset. Sign in again.')
              session.set(null)
              form.reset()
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : 'Recovery failed.',
              )
            } finally {
              setBusy(false)
              lock.current = false
              form
                .querySelectorAll<HTMLInputElement>('input:not([type=email])')
                .forEach((input) => {
                  input.value = ''
                })
            }
          }}
        >
          <label htmlFor="recover-email">Email</label>
          <input
            id="recover-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            disabled={busy}
          />
          <label htmlFor="recover-code">Unused recovery code</label>
          <input
            id="recover-code"
            name="recovery_code"
            autoComplete="off"
            required
            maxLength={128}
            disabled={busy}
          />
          <label htmlFor="recover-password">New password</label>
          <input
            id="recover-password"
            name="new_password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            disabled={busy}
          />
          <button className="button" disabled={busy}>
            Reset password
          </button>
        </form>
        <p role="status">{message}</p>
        <Link to="/login">Return to sign in</Link>
      </section>
    </div>
  )
}
