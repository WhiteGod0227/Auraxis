import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from '@/lib/useAccount'
import { useResource } from '@/lib/useResource'
import { workspaceRoute, workspaces } from '@/lib/workspaces'
import type { Workspace, WorkspaceList } from '@/lib/workspaces'
import { session } from '@/lib/auth'

const typeLabels = {
  relative_value: 'Relative Value',
  term_structure: 'Term Structure',
  backtest: 'Backtest',
}
export function WorkspaceEditor({
  workspace,
  refresh,
}: {
  workspace: Workspace
  refresh: () => void
}) {
  const [title, setTitle] = useState(workspace.title)
  const [notes, setNotes] = useState(workspace.notes)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const mutate = async (remove: boolean) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    const epoch = session.getSnapshot().epoch
    try {
      if (remove) await workspaces.delete(workspace.id, workspace.revision)
      else
        await workspaces.update(
          workspace.id,
          workspace.revision,
          title.trim(),
          notes,
        )
      if (epoch === session.getSnapshot().epoch) refresh()
    } catch (e) {
      if (epoch === session.getSnapshot().epoch)
        setError(e instanceof Error ? e.message : 'Request failed. Retry.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const titleId = `title-${workspace.id}`
  const notesId = `notes-${workspace.id}`
  const errorId = `error-${workspace.id}`
  return (
    <article className="panel research-item">
      <h2>{workspace.title}</h2>
      <p>{typeLabels[workspace.configuration.kind]}</p>
      <Link className="button" to={workspaceRoute(workspace)}>
        Open research
      </Link>
      <details>
        <summary>Rename / edit notes</summary>
        <p>
          Updated {new Date(workspace.updated_at).toLocaleString()} · Revision{' '}
          {workspace.revision}. Saved data date:{' '}
          {workspace.saved_context.data_as_of ?? 'unavailable'}.
        </p>
        <form
          className="research-form"
          onSubmit={(e) => {
            e.preventDefault()
            void mutate(false)
          }}
        >
          <label htmlFor={titleId}>Title</label>
          <input
            id={titleId}
            required
            maxLength={120}
            value={title}
            disabled={busy}
            aria-describedby={errorId}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label htmlFor={notesId}>Personal notes (plain text)</label>
          <textarea
            id={notesId}
            maxLength={5000}
            value={notes}
            disabled={busy}
            aria-describedby={errorId}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button className="button" disabled={busy}>
            Save title and notes
          </button>
        </form>
        <details>
          <summary>
            Saved configuration (version {workspace.configuration_version})
          </summary>
          <pre>{JSON.stringify(workspace.configuration, null, 2)}</pre>
        </details>
      </details>
      <button
        ref={deleteButton}
        className="button"
        disabled={busy}
        onClick={() => setConfirm(!confirm)}
      >
        Delete research
      </button>
      {confirm && (
        <div role="group" aria-label={`Confirm deletion of ${workspace.title}`}>
          <p>Delete “{workspace.title}”? This cannot be undone.</p>
          <button
            className="button"
            disabled={busy}
            onClick={() => void mutate(true)}
          >
            Confirm delete
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              setConfirm(false)
              requestAnimationFrame(() => deleteButton.current?.focus())
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {busy && <p role="status">Saving change…</p>}
      <p id={errorId} role="alert">
        {error}
      </p>
      {error && (
        <button className="button" onClick={refresh}>
          Reload latest workspaces (discards unsaved edits)
        </button>
      )}
    </article>
  )
}
export function ResearchResults({
  data,
  offset,
  onPage,
  refresh,
}: {
  data: WorkspaceList
  offset: number
  onPage: (offset: number) => void
  refresh: () => void
}) {
  return (
    <>
      {!data.items.length && (
        <div className="empty-state">
          <p>
            {data.total === 0
              ? 'No saved research yet.'
              : 'No saved research on this page.'}
          </p>
          <Link className="button" to="/app/relative-value">
            Explore Relative Value
          </Link>
        </div>
      )}
      {data.items.map((w) => (
        <WorkspaceEditor
          key={`${w.id}:${w.revision}`}
          workspace={w}
          refresh={refresh}
        />
      ))}
      {(data.total > data.limit || offset > 0) && (
        <nav aria-label="Research pagination">
          <button
            className="button"
            disabled={offset === 0}
            onClick={() => onPage(offset - 20)}
          >
            Previous
          </button>
          <span> Page {offset / 20 + 1} </span>
          <button
            className="button"
            disabled={offset + 20 >= data.total || offset >= 10000}
            onClick={() => onPage(offset + 20)}
          >
            Next
          </button>
        </nav>
      )}
    </>
  )
}
function ResearchList() {
  const [offset, setOffset] = useState(0)
  const resource = useResource(
    useCallback(
      async () => ({
        data: await workspaces.list(offset),
        source: 'API' as const,
      }),
      [offset],
    ),
  )
  const data = resource.response?.data
  return (
    <>
      <details className="research-help">
        <summary>About saved research</summary>
        <p>Saves settings and notes; results are recalculated when reopened.</p>
      </details>
      {resource.loading && <p role="status">Loading My Research…</p>}
      {resource.error && (
        <div role="alert">
          <p>{resource.error}</p>
          <button className="button" onClick={resource.retry}>
            Reload workspaces
          </button>
        </div>
      )}
      {data && (
        <>
          <ResearchResults
            data={data}
            offset={offset}
            onPage={setOffset}
            refresh={resource.retry}
          />
        </>
      )}
    </>
  )
}
export function ResearchPage() {
  const account = useAccount()
  return (
    <div className="overview-page">
      <div className="page-heading">
        <h1>My Research</h1>
      </div>
      {!account.checked ? (
        <p role="status">Checking account…</p>
      ) : account.user ? (
        <ResearchList key={account.epoch} />
      ) : (
        <section className="panel">
          <p>Sign in to view your saved research.</p>
          <Link to="/login?returnTo=%2Fapp%2Fresearch">Sign in</Link>
        </section>
      )}
    </div>
  )
}
