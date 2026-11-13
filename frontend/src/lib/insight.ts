/** Plain-language helpers that turn statistics into readable verdicts. */

export type GapTone = 'high' | 'low' | 'normal' | 'unknown'

export interface GapLevel {
  tone: GapTone
  /** Short chip text, e.g. "Unusually high". */
  chip: string
  /** Sentence fragment, e.g. "much higher than usual". */
  phrase: string
  strong: boolean
}

/** Classify a z-score: |z| ≥ 2 is unusual, ≥ 1 is notable. */
export function gapLevel(z: number | null | undefined): GapLevel {
  if (typeof z !== 'number' || !Number.isFinite(z))
    return {
      tone: 'unknown',
      chip: 'Not enough history',
      phrase: '',
      strong: false,
    }
  const size = Math.abs(z)
  if (size < 1)
    return {
      tone: 'normal',
      chip: 'Normal',
      phrase: 'within its usual range',
      strong: false,
    }
  const high = z > 0
  return size >= 2
    ? {
        tone: high ? 'high' : 'low',
        chip: high ? 'Unusually high' : 'Unusually low',
        phrase: high ? 'much higher than usual' : 'much lower than usual',
        strong: true,
      }
    : {
        tone: high ? 'high' : 'low',
        chip: high ? 'Above usual' : 'Below usual',
        phrase: high ? 'higher than usual' : 'lower than usual',
        strong: false,
      }
}

export const pairParts = (pair: string) => {
  const [a = pair, b = ''] = pair.split('-')
  return [a, b] as const
}
export const pairLabel = (pair: string) => pairParts(pair).join(' vs ')

const rupee0 = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})
const plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** ₹1,08,026 — whole rupees for headline numbers; "—" when missing. */
export function inr(value: number | null | undefined) {
  return finite(value) ? rupee0.format(value) : '—'
}
/** +₹1,259 / −₹268 */
export function signedInr(value: number | null | undefined) {
  if (!finite(value)) return '—'
  const text = rupee0.format(Math.abs(value))
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text
}
/** +1.18% / −0.25% */
export function signedPct(value: number | null | undefined, digits = 2) {
  if (!finite(value)) return '—'
  const text = `${Math.abs(value).toFixed(digits)}%`
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text
}
export function num(value: number | null | undefined) {
  return finite(value) ? plain.format(value) : '—'
}
/** 5,46,300 g → 546 kg */
export function grams(value: number | null | undefined) {
  if (!finite(value)) return '—'
  if (value >= 100000) return `${plain.format(Math.round(value / 1000))} kg`
  if (value >= 1000) return `${(value / 1000).toFixed(1)} kg`
  return `${plain.format(value)} g`
}
export function shortDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}
export function longDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
