import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import CrowMascot from '@/components/CrowMascot'
import { auth } from '@/lib/auth'
import '@/styles/login.css'

export function LoginPage() {
  const [signup, setSignup] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const switchFace = () => {
    const nextFace = signup ? 'login-face' : 'signup-face'
    setSignup((value) => !value)
    setMessage('')
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
    try {
      const email = String(values.get('email') ?? '')
      const password = String(values.get('password') ?? '')
      if (signup)
        await auth.signup(String(values.get('name') ?? ''), email, password)
      else await auth.login(email, password)
      form.reset()
      navigate('/', { replace: true })
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to sign in. Please retry.',
      )
    } finally {
      const password = form.elements.namedItem('password')
      if (password instanceof HTMLInputElement) password.value = ''
      setBusy(false)
    }
  }
  return (
    <main className="auth-page">
      <Link className="auth-brand" to="/" aria-label="Auraxis home">
        <span aria-hidden="true">A</span> AURAXIS
      </Link>
      <div className="auth-mascot">
        <CrowMascot pose={signup ? 'gold' : 'guarding'} size="hero" />
      </div>
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
                    ? `Please enter your ${input.name}.`
                    : input.name === 'email'
                      ? 'Please enter a valid email address.'
                      : input.validationMessage,
                )
              }}
              method="post"
              aria-busy={busy}
              aria-describedby={message ? 'auth-error' : undefined}
            >
              <h1 className="form_details" tabIndex={-1}>
                {back ? 'Create account' : 'Welcome back'}
              </h1>
              <p className="auth-subtitle">
                {back
                  ? 'A little curiosity. A closer look at gold.'
                  : 'Your gold research, one place.'}
              </p>
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
                <input
                  className="input"
                  name="password"
                  type="password"
                  autoComplete={back ? 'new-password' : 'current-password'}
                  placeholder={back ? 'At least 8 characters' : 'Your password'}
                  minLength={back ? 8 : undefined}
                  required
                  maxLength={128}
                  disabled={busy}
                />
              </label>
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Please wait…' : back ? 'Create account' : 'Log in'}
              </button>
              {message && signup === back && (
                <p className="auth-message" id="auth-error" role="alert">
                  {message}
                </p>
              )}
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
              <p className="auth-preview-note">
                {back
                  ? 'Use 8–128 characters for your password.'
                  : 'Your account stays signed in on this browser until you sign out or the session expires.'}
              </p>
            </form>
          ))}
        </div>
      </div>
      <Link className="auth-demo-link" to="/app">
        Explore the demo without signing in <span aria-hidden="true">→</span>
      </Link>
    </main>
  )
}
