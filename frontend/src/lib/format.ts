export const number = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
})
export const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})
export function formatDate(value: string | null) {
  return value
    ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'Unavailable'
}
export function humanize(value: string) {
  return value.replaceAll('_', ' ')
}
