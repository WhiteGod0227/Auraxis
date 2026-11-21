import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Crow from '@/components/Crow'
import { AuthError, auth, authProviders } from '@/lib/auth'
import { safeReturn } from '@/lib/workspaces'
import { passwordStrength } from '@/lib/passwordStrength'
import { useLive } from '@/lib/live'
import '@/styles/login.css'
import '@/styles/auth-split.css'

interface GoogleId {
  initialize: (options: {
    client_id: string
    callback: (response: { credential?: string }) => void
    ux_mode?: 'popup'
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
  }) => void
  renderButton: (element: HTMLElement, options: Record<string, unknown>) => void
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } }
  }
}

let googleScript: Promise<GoogleId> | undefined
function loadGoogle(): Promise<GoogleId> {
  googleScript ??= new Promise<GoogleId>((resolve, reject) => {
    const ready = () => {
      const id = window.google?.accounts?.id
      if (id) resolve(id)
      else reject(new Error('Google sign-in failed to load.'))
    }
    if (window.google?.accounts?.id) return ready()
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = ready
    script.onerror = () => {
      googleScript = undefined
      reject(new Error('Google sign-in failed to load.'))
    }
    document.head.appendChild(script)
  })
  return googleScript
}

function PasswordInput({
  name,
  autoComplete,
  placeholder,
  minLength,
  disabled,
  onChange,
}: {
  name: string
  autoComplete: string
  placeholder: string
  minLength?: number
  disabled: boolean
  onChange?: (value: string) => void
}) {
  const [visible, setVisible] = useState(false)
  return (
    <span className="password-wrap">
      <input
        className="input"
        name={name}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        required
        maxLength={128}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        disabled={disabled}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </span>
  )
}

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** Small live MCX price strip for the brand panel; hidden until data arrives. */
function AuthTicker() {
  const { snapshot } = useLive()
  const rows = (snapshot?.references ?? []).filter(
    (r) => r.available && r.price_p10 != null,
  )
  if (!snapshot || !rows.length) return null
  const live = snapshot.state === 'live'
  return (
    <div className="auth-ticker" aria-label="MCX gold prices">
      <p className="auth-ticker-head">
        <span className={live ? 'is-live' : ''}>
          <i aria-hidden="true" />
          {live ? 'Live' : 'Last session'}
        </span>
        per 10 g
      </p>
      <ul>
        {rows.slice(0, 4).map((r) => (
          <li key={r.product}>
            <span>{r.product}</span>
            <strong>₹{inr.format(r.price_p10 as number)}</strong>
            {r.change_pct != null && (
              <small className={r.change_pct < 0 ? 'is-down' : 'is-up'}>
                {r.change_pct > 0 ? '+' : ''}
                {r.change_pct.toFixed(2)}%
              </small>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

const POINTS = [
  ['Compare', 'All four MCX gold contracts on one scale, per 10 g.'],
  ['Practise', 'Trade unusual gaps with demo money — no risk, no card.'],
  ['Prove', 'Timestamp your research on Bitcoin, verifiable by anyone.'],
] as const

type Pending =
  | { kind: 'password'; email: string; password: string }
  | { kind: 'google'; credential: string }

export function LoginPage() {
  const [params] = useSearchParams()
  const [signup, setSignup] = useState(() => params.get('mode') === 'signup')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [strength, setStrength] = useState(passwordStrength(''))
  const [googleClientId, setGoogleClientId] = useState<string | null>(null)
  const googleRefs = useRef<(HTMLDivElement | null)[]>([])
  const navigate = useNavigate()
  const finish = () =>
    navigate(safeReturn(params.get('returnTo')), { replace: true })

  const fail = (error: unknown, next?: Pending) => {
    if (error instanceof AuthError && error.step === 'mfa' && next) {
      setPending(next)
      setMessage('')
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('input[name="otp"]')?.focus(),
      )
      return
    }
    setMessage(
      error instanceof Error
        ? error.message
        : 'Unable to sign in. Please retry.',
    )
  }

  // Google Identity Services button, only when the backend has a client ID.
  const onGoogle = useRef<(credential: string) => void>(() => {})
  useEffect(() => {
    onGoogle.current = async (credential: string) => {
      setBusy(true)
      setMessage('')
      try {
        await auth.google(credential)
        finish()
      } catch (error) {
        fail(error, { kind: 'google', credential })
      } finally {
        setBusy(false)
      }
    }
  })
  useEffect(() => {
    let active = true
    void authProviders().then(({ googleClientId: id }) => {
      if (active) setGoogleClientId(id)
    })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (!googleClientId || pending) return
    let active = true
    loadGoogle()
      .then((google) => {
        if (!active) return
        google.initialize({
          client_id: googleClientId,
          callback: ({ credential }) => {
            if (credential) void onGoogle.current(credential)
          },
          ux_mode: 'popup',
          cancel_on_tap_outside: true,
        })
        for (const element of googleRefs.current)
          if (element) {
            element.replaceChildren()
            google.renderButton(element, {
              theme: 'filled_black',
              size: 'large',
              shape: 'pill',
              text: 'continue_with',
              width: 245,
            })
          }
      })
      .catch(() => {
        if (active) setGoogleClientId(null)
      })
    return () => {
      active = false
    }
  }, [googleClientId, pending])

  const switchFace = () => {
    const nextFace = signup ? 'login-face' : 'signup-face'
    setSignup((value) => !value)
    setMessage('')
    setPending(null)
    requestAnimationFrame(() => {
      document.getElementById(nextFace)?.querySelector('h1')?.focus()
    })
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setBusy(true)
    setMessage('')
    let next: Pending | undefined
    try {
      if (pending) {
        const otp = String(values.get('otp') ?? '').trim()
        if (pending.kind === 'google')
          await auth.google(pending.credential, otp)
        else await auth.login(pending.email, pending.password, otp)
      } else {
        const email = String(values.get('email') ?? '')
        const password = String(values.get('password') ?? '')
        if (signup)
          await auth.signup(String(values.get('name') ?? ''), email, password)
        else {
          next = { kind: 'password', email, password }
          await auth.login(email, password)
        }
      }
      form.reset()
      setPending(null)
      finish()
    } catch (error) {
      fail(error, next)
    } finally {
      const password = form.elements.namedItem('password')
      if (password instanceof HTMLInputElement) password.value = ''
      setBusy(false)
    }
  }

  const googleBlock = (index: number): ReactNode =>
    googleClientId ? (
      <>
        <div
          className="google-button"
          ref={(element) => {
            googleRefs.current[index] = element
          }}
        />
        <div className="auth-divider" role="separator">
          <span>or with email</span>
        </div>
      </>
    ) : null

  return (
    <main className="auth-page auth-split">
      <aside className="auth-aside">
        <Link className="auth-logo" to="/" aria-label="Auraxis home">
          <Crow size={30} bar={false} mood="guarding" animated={false} />
          <span>Auraxis</span>
        </Link>
        <div className="auth-pitch">
          <p className="auth-kicker">MCX gold research</p>
          <h2>Four gold contracts. One clear picture.</h2>
          <AuthTicker />
          <ul className="auth-points">
            {POINTS.map(([title, text]) => (
              <li key={title}>
                <b>{title}</b>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="auth-aside-crow" aria-hidden="true">
          <Crow
            mood={pending ? 'guarding' : signup ? 'celebrating' : 'perched'}
            size={120}
          />
        </div>
        <p className="auth-fine">Research tool · not investment advice</p>
      </aside>
      <section className="auth-main">
        <div className="auth-container container">
          <div className={`auth-form form ${signup ? 'is-signup' : ''}`}>
            {[false, true].map((back) => (
              <form
                key={String(back)}
                id={back ? 'signup-face' : 'login-face'}
                className={back ? 'form_back' : 'form_front'}
                aria-label={back ? 'Create account' : 'Login'}
                aria-hidden={signup !== back}
                inert={signup !== back}
                onSubmit={submit}
                onInvalid={(event) => {
                  const input = event.target
                  if (!(input instanceof HTMLInputElement)) return
                  setMessage(
                    input.validity.valueMissing
                      ? `Please enter your ${input.name === 'otp' ? 'code' : input.name}.`
                      : input.name === 'email'
                        ? 'Please enter a valid email address.'
                        : input.validationMessage,
                  )
                }}
                method="post"
                aria-busy={busy}
                aria-describedby={message ? 'auth-error' : undefined}
              >
                {!back && pending ? (
                  <>
                    <h1 className="form_details" tabIndex={-1}>
                      Two-step verification
                    </h1>
                    <p className="auth-subtitle">
                      Enter the 6-digit code from your authenticator app, or one
                      of your saved recovery codes.
                    </p>
                    <label className="auth-field">
                      Verification code
                      <input
                        className="input otp-input"
                        name="otp"
                        autoComplete="one-time-code"
                        inputMode="text"
                        placeholder="123 456"
                        required
                        maxLength={128}
                        disabled={busy}
                      />
                    </label>
                    <button className="btn" type="submit" disabled={busy}>
                      {busy ? 'Verifying…' : 'Verify and continue'}
                    </button>
                    <button
                      className="auth-link-button"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setPending(null)
                        setMessage('')
                      }}
                    >
                      ← Use a different account
                    </button>
                  </>
                ) : (
                  <>
                    <h1 className="form_details" tabIndex={-1}>
                      {back ? 'Create your account' : 'Welcome back'}
                    </h1>
                    <p className="auth-subtitle">
                      {back
                        ? 'Save research, sync alerts and refresh live MCX data.'
                        : 'Your gold research, one place.'}
                    </p>
                    {googleBlock(back ? 1 : 0)}
                    {back && (
                      <label className="auth-field">
                        Name
                        <input
                          className="input"
                          name="name"
                          autoComplete="name"
                          placeholder="Your name"
                          required
                          maxLength={100}
                          disabled={busy}
                        />
                      </label>
                    )}
                    <label className="auth-field">
                      Email
                      <input
                        className="input"
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        required
                        maxLength={254}
                        disabled={busy}
                      />
                    </label>
                    <label className="auth-field">
                      Password
                      <PasswordInput
                        name="password"
                        autoComplete={
                          back ? 'new-password' : 'current-password'
                        }
                        placeholder={
                          back ? 'At least 8 characters' : 'Your password'
                        }
                        minLength={back ? 8 : undefined}
                        disabled={busy}
                        onChange={
                          back
                            ? (value) => setStrength(passwordStrength(value))
                            : undefined
                        }
                      />
                      {back && strength.label && (
                        <span
                          className="strength"
                          data-score={strength.score}
                          aria-live="polite"
                        >
                          <span className="strength-bars" aria-hidden="true">
                            {[1, 2, 3, 4].map((bar) => (
                              <span
                                key={bar}
                                className={bar <= strength.score ? 'on' : ''}
                              />
                            ))}
                          </span>
                          {strength.label}
                        </span>
                      )}
                    </label>
                    <button className="btn" type="submit" disabled={busy}>
                      {busy
                        ? 'Please wait…'
                        : back
                          ? 'Create account'
                          : 'Log in'}
                    </button>
                    <p className="switch">
                      {back ? 'Already have an account?' : 'New to Auraxis?'}{' '}
                      <button
                        className="signup_tog"
                        type="button"
                        onClick={switchFace}
                        aria-controls={back ? 'login-face' : 'signup-face'}
                        disabled={busy}
                      >
                        {back ? 'Log in' : 'Sign up'}
                      </button>
                    </p>
                  </>
                )}
                {message && signup === back && (
                  <p className="auth-message" id="auth-error" role="alert">
                    {message}
                  </p>
                )}
              </form>
            ))}
          </div>
        </div>
        <nav className="auth-links" aria-label="Other options">
          <div className="auth-or" role="separator">
            <span>or</span>
          </div>
          <Link className="auth-explore" to="/app">
            Explore without signing in <span aria-hidden="true">→</span>
          </Link>
          <p>
            Free and read-only — no account needed.{' '}
            <Link to="/app/recover">Forgot password?</Link>
          </p>
        </nav>
      </section>
    </main>
  )
}
