/**
 * Chart colours. Each product keeps one colour everywhere; values are CSS
 * variables (styles/studio.css) so dark and light themes each get a tuned
 * shade: pastel aqua, lavender, pink and amber on near-black, deeper versions
 * of the same hues on white. Products are always labelled by name as well.
 */
export const PALETTE = {
  slate: 'var(--c1)',
  copper: 'var(--c2)',
  jade: 'var(--c3)',
  garnet: 'var(--c4)',
  violet: 'var(--c5)',
  grey: 'var(--c6)',
}
export const PRODUCT_COLORS: Record<string, string> = {
  GOLDM: PALETTE.slate,
  GOLDTEN: PALETTE.copper,
  GOLDGUINEA: PALETTE.jade,
  GOLDPETAL: PALETTE.garnet,
}
export const productColor = (product: string, index = 0) =>
  PRODUCT_COLORS[product] ??
  Object.values(PALETTE)[index % Object.values(PALETTE).length]

/** Diverging "vs usual": below = aqua, normal = neutral grey, above = coral. */
export const LOW = 'var(--low)'
export const NORMAL = 'var(--normal)'
export const HIGH = 'var(--high)'
export const UP = 'var(--up)'
export const DOWN = 'var(--down)'

export const AXIS = 'var(--axis)'
export const GRID = 'var(--grid)'
export const SILVER = 'var(--text)'
export const MUTED_LINE = 'var(--c6)'
export const tooltipStyle = {
  background: 'var(--tooltip-bg)',
  border: '1px solid var(--tooltip-border)',
  borderRadius: 12,
  color: 'var(--text)',
  fontSize: 12,
  fontFamily: 'Inter, sans-serif',
  boxShadow: '0 12px 30px var(--shadow)',
}
export const legendStyle = {
  fontSize: 12,
  paddingTop: 10,
  color: 'var(--text-2)',
  fontFamily: 'Inter, sans-serif',
}
/** Shared animation props so every chart draws in the same way. */
export const draw = {
  isAnimationActive: true,
  animationDuration: 1100,
  animationEasing: 'ease-out' as const,
}
export const compactInr = (value: unknown) => {
  const n = Number(value)
  const size = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (size >= 100000) return `${sign}₹${(size / 100000).toFixed(2)}L`
  if (size >= 1000) return `${sign}₹${(size / 1000).toFixed(1)}k`
  return `${sign}₹${size.toFixed(0)}`
}
