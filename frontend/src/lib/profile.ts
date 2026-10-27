import type { AccountUser } from './auth'
export interface ProfileUser extends AccountUser {
  created_at: string | null
}
export interface NameEditState {
  editing: boolean
  draft: string
  busy: boolean
  error: string
  success: string
}
type NameEditAction =
  | { type: 'begin' | 'change' | 'cancel' | 'error'; value: string }
  | { type: 'pending' | 'saved' | 'finished' }
export const initialNameEdit = (name: string): NameEditState => ({
  editing: false,
  draft: name,
  busy: false,
  error: '',
  success: '',
})
export function nameEditor(
  state: NameEditState,
  action: NameEditAction,
): NameEditState {
  if (state.busy && ['begin', 'change', 'cancel'].includes(action.type))
    return state
  switch (action.type) {
    case 'begin':
      return { ...initialNameEdit(action.value), editing: true }
    case 'change':
      return { ...state, draft: action.value, error: '' }
    case 'cancel':
      return initialNameEdit(action.value)
    case 'error':
      return { ...state, error: action.value }
    case 'pending':
      return { ...state, busy: true, error: '', success: '' }
    case 'saved':
      return {
        ...state,
        busy: false,
        editing: false,
        error: '',
        success: 'Name updated.',
      }
    case 'finished':
      return { ...state, busy: false }
  }
}
export function validateName(value: string): string | undefined {
  if (
    /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value) ||
    [...value].some(
      (c) => /\p{Cf}/u.test(c) && !['\u200c', '\u200d'].includes(c),
    )
  )
    return 'Use a name without control characters.'
  const length = [...value.trim()].length
  if (length < 1 || length > 100) return 'Name must contain 1–100 characters.'
}
export function parseProfile(value: AccountUser): ProfileUser {
  const user = value as ProfileUser
  if (
    !Object.hasOwn(user, 'created_at') ||
    !(
      user.created_at === null ||
      (typeof user.created_at === 'string' &&
        /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(user.created_at) &&
        Number.isFinite(Date.parse(user.created_at)))
    )
  )
    throw new Error('Account server returned an invalid creation timestamp.')
  return user
}
export function creationDate(value: string | null) {
  return value === null
    ? 'Unavailable'
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date(value)) + ' UTC'
}
