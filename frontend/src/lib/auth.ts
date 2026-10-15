import { env } from './env'

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
  if (response.status === 204) return null
  const value = await response.json().catch(() => null)
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
  return user
}
export const auth = {
  signup: (name: string, email: string, password: string) =>
    request('signup', 'POST', { name, email, password }),
  login: (email: string, password: string) =>
    request('login', 'POST', { email, password }),
  me: () => request('me'),
  logout: () => request('logout', 'POST'),
}
