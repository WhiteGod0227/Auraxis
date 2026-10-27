import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { WorkspaceContext } from '@/lib/workspaceContext'
import { useAccount } from '@/lib/useAccount'
import { useResource } from '@/lib/useResource'
import { researchRoutes, workspaces } from '@/lib/workspaces'

function LoadedWorkspace({
  id,
  children,
}: {
  id: string
  children: ReactNode
}) {
  const { pathname } = useLocation()
  const resource = useResource(
    useCallback(
      async () => ({ data: await workspaces.get(id), source: 'API' as const }),
      [id],
    ),
  )
  if (resource.loading) return <p role="status">Loading private workspace…</p>
  if (resource.error)
    return (
      <section className="panel error-notice" role="alert">
        <p>{resource.error}</p>
        <button className="button" onClick={resource.retry}>
          Retry workspace
        </button>
        <Link to="/app/research">My Research</Link>
      </section>
    )
  const workspace = resource.response?.data
  if (!workspace || researchRoutes[workspace.configuration.kind] !== pathname)
    return (
      <p role="alert">
        This workspace belongs to another analysis page. Open it from My
        Research.
      </p>
    )
  return (
    <WorkspaceContext.Provider value={workspace}>
      {children}
    </WorkspaceContext.Provider>
  )
}
export default function WorkspaceBoundary({
  children,
}: {
  children: ReactNode
}) {
  const [params] = useSearchParams()
  const id = params.get('workspace')
  const { pathname, search } = useLocation()
  const account = useAccount()
  if (!id) return children
  if (!account.checked) return <p role="status">Checking account…</p>
  if (!account.user)
    return (
      <section className="panel">
        <p>
          Sign in to open private research. Public analytics remain available.
        </p>
        <Link to={`/login?returnTo=${encodeURIComponent(pathname + search)}`}>
          Sign in
        </Link>
      </section>
    )
  return (
    <LoadedWorkspace key={`${account.epoch}:${id}`} id={id}>
      {children}
    </LoadedWorkspace>
  )
}
