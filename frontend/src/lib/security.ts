import { env } from './env'
import { session } from './auth'

export interface SecurityStatus {
  mfa_enabled: boolean
  recovery_codes_remaining: number
  email_verified: false
  email_delivery_configured: false
}
export interface SecurityResult {
  message?: string
  secret?: string
  otpauth_uri?: string
  recovery_codes?: string[]
}
export async function securityRequest(
  path = '',
  body?: Record<string, string>,
  publicRequest = false,
): Promise<SecurityResult & Partial<SecurityStatus>> {
  const epoch = session.getSnapshot().epoch
  let response: Response
  try {
    response = await fetch(
      `${env.apiBaseUrl.replace(/\/$/, '')}/api/auth/security${path}`,
      {
        method: body ? 'POST' : 'GET',
        credentials: publicRequest ? 'omit' : 'include',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      },
    )
  } catch {
    throw new Error(
      'Security settings require the backend. Retry when connected.',
    )
  }
  if (!publicRequest && session.getSnapshot().epoch !== epoch)
    throw new Error('Account changed. Reload security settings.')
  const value = await response.json().catch(() => null)
  if (!publicRequest && session.getSnapshot().epoch !== epoch)
    throw new Error('Account changed. Reload security settings.')
  if (!response.ok)
    throw new Error(
      typeof value?.detail === 'string'
        ? value.detail
        : 'Security request failed.',
    )
  if (!value || typeof value !== 'object')
    throw new Error('Invalid security response.')
  if (
    !body &&
    (typeof value.mfa_enabled !== 'boolean' ||
      !Number.isInteger(value.recovery_codes_remaining) ||
      value.recovery_codes_remaining < 0 ||
      value.recovery_codes_remaining > 8)
  )
    throw new Error('Invalid security status.')
  if (
    value.recovery_codes &&
    (!Array.isArray(value.recovery_codes) ||
      value.recovery_codes.length !== 8 ||
      !value.recovery_codes.every(
        (code: unknown) =>
          typeof code === 'string' && /^[0-9a-f]{32}$/.test(code),
      ))
  )
    throw new Error('Invalid recovery code response.')
  if (
    path === '/mfa/setup' &&
    (typeof value.secret !== 'string' || !/^[A-Z2-7]{32}$/.test(value.secret))
  )
    throw new Error('Invalid authenticator setup response.')
  return value
}
