import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { session } from '@/lib/auth'
import { useAccount } from '@/lib/useAccount'
import { useWorkspace } from '@/lib/workspaceContext'
import { createExclusiveAction, workspaces } from '@/lib/workspaces'
import type { SaveResearch as SaveInput } from '@/lib/workspaces'

type Candidate = Omit<SaveInput, 'title' | 'notes'>
function SaveForm({
  candidate,
  draftChanged,
  selectionLabel,
}: {
  candidate?: Candidate
  draftChanged?: boolean
  selectionLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const lock = useRef(createExclusiveAction())
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const saveButton = useRef<HTMLButtonElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => saveButton.current?.focus())
  }
  return (
    <div className="research-save-action" data-open={open}>
      <button
        ref={saveButton}
        className="button"
        disabled={!candidate || busy}
        aria-expanded={open}
        aria-controls="research-save-form"
        title={!candidate ? 'Load a valid result before saving.' : undefined}
        onClick={() => {
          setOpen(!open)
          setMessage('')
        }}
      >
        Save research
      </button>
      {open && (
        <form
          id="research-save-form"
          className="research-form research-save-form panel"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) {
              event.stopPropagation()
              close()
            }
          }}
          onSubmit={async (event) => {
            event.preventDefault()
            if (lock.current.busy || !candidate) return
            if (!title.trim()) {
              setMessage('Enter a title.')
              return
            }
            await lock.current.run(async () => {
              setBusy(true)
              setMessage('')
              const epoch = session.getSnapshot().epoch
              try {
                await workspaces.create({
                  ...candidate,
                  title: title.trim(),
                  notes,
                })
                if (epoch !== session.getSnapshot().epoch) return
                setMessage('Research saved. Find it in My Research.')
                setTitle('')
                setNotes('')
              } catch (error) {
                if (epoch === session.getSnapshot().epoch)
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : 'Save failed. Retry.',
                  )
              } finally {
                setBusy(false)
                if (session.getSnapshot().epoch === epoch) {
                  requestAnimationFrame(() => titleInput.current?.focus())
                }
              }
            })
          }}
        >
          {selectionLabel && (
            <p className="context-note">
              <strong>{selectionLabel}</strong>
            </p>
          )}
          <p>
            Saves settings and notes; results are recalculated when reopened.
          </p>
          {draftChanged && (
            <p className="ts-warning">
              This saves the previous run’s applied settings, not your unsaved
              edits.
            </p>
          )}
          <label htmlFor="research-title">Title</label>
          <input
            ref={titleInput}
            id="research-title"
            maxLength={120}
            required
            autoFocus
            value={title}
            disabled={busy}
            aria-describedby="research-message"
            onChange={(e) => setTitle(e.target.value)}
          />
          <label htmlFor="research-notes">Notes (optional)</label>
          <textarea
            id="research-notes"
            maxLength={5000}
            value={notes}
            disabled={busy}
            aria-describedby="research-message"
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            className="button"
            disabled={busy || !candidate}
            type="submit"
          >
            {busy ? 'Saving…' : 'Save settings'}
          </button>
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <p id="research-message" role="status">
            {message}
          </p>
          {message === 'Research saved. Find it in My Research.' && (
            <Link to="/app/research">Open My Research</Link>
          )}
        </form>
      )}
    </div>
  )
}
export default function SaveResearch({
  candidate,
  draftChanged,
  currentContext,
  selectionLabel,
}: {
  candidate?: Candidate
  draftChanged?: boolean
  currentContext?: Candidate['saved_context']
  selectionLabel?: string
}) {
  const account = useAccount()
  const saved = useWorkspace()
  const location = useLocation()
  const context = currentContext ?? candidate?.saved_context
  const config = candidate?.configuration
  const mode = (value: { mode: string; value: string | null }) =>
    value.mode === 'latest' ? 'latest eligible contract' : value.value
  return (
    <section className="research-save" aria-label="Save research workspace">
      {saved && <p>Opened “{saved.title}”.</p>}
      {!account.checked ? (
        <span role="status">Checking account…</span>
      ) : account.error ? (
        <span role="alert">
          Account unavailable.{' '}
          <Link to="/app/profile">Reconnect to save research</Link>
        </span>
      ) : account.user ? (
        <SaveForm
          key={account.epoch}
          candidate={candidate}
          draftChanged={draftChanged}
          selectionLabel={selectionLabel}
        />
      ) : (
        <Link
          className="button"
          to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
        >
          Sign in to save research
        </Link>
      )}
      {(saved || config) && (
        <details className="research-reopen-details">
          <summary>Reopen details</summary>
          {saved && (
            <p>
              Saved data as of {saved.saved_context.data_as_of ?? 'unavailable'}{' '}
              ({saved.saved_context.source}); current result as of{' '}
              {context?.data_as_of ?? 'unavailable'} (
              {context?.source ?? 'not loaded'}). Results are recalculated or
              reloaded using currently available data; this is not a frozen
              numerical result.
            </p>
          )}
          {config && (
            <p>
              Reopen selection:{' '}
              {config.kind === 'term_structure'
                ? `curve date ${config.curve.date ?? 'latest available'}; curve ${mode(config.curve_expiry)}; roll-down ${mode(config.roll_expiry)}`
                : mode(config.expiry)}
              .
            </p>
          )}
        </details>
      )}
    </section>
  )
}
