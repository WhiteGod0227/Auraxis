import { env } from './env'
import { createSessionStore } from './sessionStore'
import { parseProfile } from './profile'
import type { ProfileUser } from './profile'

let profileRevision = 0

export const session = createSessionStore()
const accountChannel =
  typeof window !== 'undefined' && 'BroadcastChannel' in window
    ? new BroadcastChannel('auraxis-account-change')
    : undefined
accountChannel?.addEventListener('message', () => {
  session.set(null)
  void refreshSession(true).catch(() => {})
})

export interface AccountUser {
  id: number
  name: string
  email: string
}
export class AuthError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<AccountUser | null> {
  const epoch = session.getSnapshot().epoch
  const revision = profileRevision
  let response: Response
  try {
    response = await fetch(
      `${env.apiBaseUrl.replace(/\/$/, '')}/api/auth/${path}`,
      {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      },
    )
  } catch {
    throw new AuthError(
      'Account server is unavailable. Check the backend and retry.',
    )
  }
  if (epoch !== session.getSnapshot().epoch)
    throw new AuthError('Account changed. Please retry.')
  if (response.status === 204) {
    session.set(null)
    accountChannel?.postMessage('changed')
    return null
  }
  const value = await response.json().catch(() => null)
  if (epoch !== session.getSnapshot().epoch)
    throw new AuthError('Account changed. Please retry.')
  if (method === 'GET' && revision !== profileRevision)
    throw new AuthError('Profile changed. Retry to load the latest name.', 409)
  if (response.status === 401) session.set(null)
  if (!response.ok)
    throw new AuthError(
      typeof value?.detail === 'string'
        ? value.detail
        : 'Account request failed. Please retry.',
      response.status,
    )
  const user = value?.user
  if (
    !user ||
    !Number.isInteger(user.id) ||
    typeof user.name !== 'string' ||
    typeof user.email !== 'string'
  )
    throw new AuthError('Account server returned an invalid response.')
  if (path === 'profile') parseProfile(user)
  if (path === 'profile' && method === 'PATCH') profileRevision++
  session.set(user)
  if (method !== 'GET') accountChannel?.postMessage('changed')
  return user
}
let checking: Promise<AccountUser | null> | undefined
export function refreshSession(force = false) {
  if (!checking || force) {
    const epoch = session.getSnapshot().epoch
    const task = auth
      .me()
      .catch((error) => {
        if (
          session.getSnapshot().epoch === epoch &&
          !(error instanceof AuthError && error.status === 409)
        )
          session.set(
            null,
            error instanceof AuthError && error.status === 401
              ? undefined
              : 'Account server is unavailable. Retry when connected.',
          )
        throw error
      })
      .finally(() => {
        if (checking === task) checking = undefined
      })
    checking = task
  }
  return checking
}
export const auth = {
  signup: (name: string, email: string, password: string) =>
    request('signup', 'POST', { name, email, password }),
  login: (email: string, password: string) =>
    request('login', 'POST', { email, password }),
  me: () => request('me'),
  profile: async () => {
    const epoch = session.getSnapshot().epoch
    try {
      return (await request('profile')) as ProfileUser
    } catch (error) {
      if (
        epoch === session.getSnapshot().epoch &&
        !(error instanceof AuthError && [401, 409].includes(error.status ?? 0))
      )
        session.set(
          null,
          'Profile could not be loaded. Retry when the backend is available.',
        )
      throw error
    }
  },
  updateName: async (name: string) =>
    (await request('profile', 'PATCH', { name })) as ProfileUser,
  logout: () => request('logout', 'POST'),
}
