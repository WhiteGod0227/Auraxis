import { useCallback, useRef, useReducer } from 'react'
import { Link } from 'react-router-dom'
import { auth, refreshSession, session } from '@/lib/auth'
import { useAccount } from '@/lib/useAccount'
import { useResource } from '@/lib/useResource'
import {
  creationDate,
  validateName,
  initialNameEdit,
  nameEditor,
} from '@/lib/profile'
import type { ProfileUser } from '@/lib/profile'
import { createExclusiveAction } from '@/lib/workspaces'
import SignOutButton from '@/components/SignOutButton'

export function ProfileDetails({ profile }: { profile: ProfileUser }) {
  const { user } = useAccount()
  const name = user?.name ?? profile.name
  const [{ editing, draft, busy, error, success }, dispatch] = useReducer(
    nameEditor,
    name,
    initialNameEdit,
  )
  const action = useRef(createExclusiveAction())
  const editButton = useRef<HTMLButtonElement>(null)
  const focusEdit = () =>
    requestAnimationFrame(() => editButton.current?.focus())
  return (
    <section className="panel" aria-label="Account profile">
      <dl>
        <dt>Name</dt>
        <dd>{name}</dd>
        <dt>Registered email</dt>
        <dd>{profile.email}</dd>
        <dt>Account created</dt>
        <dd>{creationDate(profile.created_at)}</dd>
      </dl>
      {!editing ? (
        <button
          ref={editButton}
          className="button"
          onClick={() => {
            dispatch({ type: 'begin', value: name })
          }}
        >
          Edit name
        </button>
      ) : (
        <form
          className="research-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (action.current.busy) return
            const invalid = validateName(draft)
            dispatch({ type: 'error', value: invalid ?? '' })
            if (invalid) return
            await action.current.run(async () => {
              const epoch = session.getSnapshot().epoch
              dispatch({ type: 'pending' })
              try {
                await auth.updateName(draft.trim())
                if (session.getSnapshot().epoch !== epoch) return
                dispatch({ type: 'saved' })
                focusEdit()
              } catch (e) {
                if (session.getSnapshot().epoch === epoch)
                  dispatch({
                    type: 'error',
                    value:
                      (e instanceof Error ? e.message : 'Name update failed.') +
                      ' The previously loaded profile is shown. Reload to check server state before retrying.',
                  })
              } finally {
                dispatch({ type: 'finished' })
              }
            })
          }}
        >
          <label htmlFor="profile-name">Name (1–100 characters)</label>
          <input
            id="profile-name"
            autoComplete="name"
            autoFocus
            required
            disabled={busy}
            value={draft}
            aria-invalid={Boolean(error)}
            aria-describedby="profile-name-error profile-edit-help"
            onChange={(e) => {
              dispatch({ type: 'change', value: e.target.value })
            }}
          />
          <p id="profile-edit-help">
            Your display name changes; your email stays the same.
          </p>
          <p id="profile-name-error" role="alert">
            {error}
          </p>
          <div>
            <button className="button" disabled={busy} type="submit">
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              className="button"
              disabled={busy}
              type="button"
              onClick={() => {
                dispatch({ type: 'cancel', value: name })
                focusEdit()
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <p role="status">{success}</p>
      <p>
        <Link className="button" to="/app/research">
          My Research
        </Link>
      </p>
      <SignOutButton />
    </section>
  )
}
function LoadedProfile() {
  const resource = useResource(
    useCallback(
      async () => ({ data: await auth.profile(), source: 'API' as const }),
      [],
    ),
  )
  if (resource.loading) return <p role="status">Loading private profile…</p>
  if (resource.error)
    return (
      <section className="panel error-notice" role="alert">
        <p>{resource.error}</p>
        <button className="button" onClick={resource.retry}>
          Retry profile
        </button>
      </section>
    )
  return resource.response ? (
    <ProfileDetails profile={resource.response.data} />
  ) : null
}
export function ProfilePage() {
  const account = useAccount()
  return (
    <div className="overview-page profile-page">
      <div className="page-heading">
        <h1>My Profile</h1>
        <Link to="/app/security">Account security</Link>
      </div>
      {!account.checked ? (
        <p role="status">Checking account…</p>
      ) : account.user ? (
        <LoadedProfile key={account.epoch} />
      ) : (
        <section className="panel">
          {account.error ? (
            <div role="alert">
              <p>{account.error}</p>
              <button
                className="button"
                onClick={() => {
                  void refreshSession().catch(() => {})
                }}
              >
                Retry account
              </button>
            </div>
          ) : (
            <p>Sign in to view your private profile.</p>
          )}
          <Link to="/login?returnTo=%2Fapp%2Fprofile">Sign in</Link>
        </section>
      )}
    </div>
  )
}
