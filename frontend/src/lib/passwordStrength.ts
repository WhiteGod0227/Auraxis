/** Rough strength estimate for feedback only; the server enforces 8–128. */
export function passwordStrength(value: string) {
  if (!value) return { score: 0, label: '' }
  let score = 0
  if (value.length >= 8) score++
  if (value.length >= 12) score++
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++
  if (/\d/.test(value)) score++
  if (/[^A-Za-z0-9]/.test(value)) score++
  if (value.length < 8) score = Math.min(score, 1)
  const capped = Math.min(score, 4)
  return {
    score: capped,
    label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][capped],
  }
}
