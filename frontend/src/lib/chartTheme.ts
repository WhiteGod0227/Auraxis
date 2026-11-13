/**
 * Chart colours on a charcoal surface. Data is the only place colour appears;
 * each product keeps one colour everywhere. Refined jewel tones (slate, copper,
 * jade, garnet), validated on #151518 for lightness, chroma, contrast and
 * colour-blind separation; products are always labelled by name as well.
 */
export const PALETTE = {
  slate: '#5E97D0',
  copper: '#CA723C',
  jade: '#359B75',
  garnet: '#B4446E',
  violet: '#8B6FD6',
  grey: '#9A9AA2',
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

/** Diverging "vs usual": below = slate, normal = neutral grey, above = copper. */
export const LOW = PALETTE.slate
export const NORMAL = '#8E8E96'
export const HIGH = PALETTE.copper
export const UP = '#4FAE8A'
export const DOWN = '#D9705F'

export const AXIS = 'var(--axis)'
export const GRID = 'var(--grid)'
export const SILVER = 'var(--text)'
export const MUTED_LINE = '#9A9AA2'
export const tooltipStyle = {
  background: 'var(--tooltip-bg)',
  border: '1px solid var(--tooltip-border)',
  borderRadius: 12,
  color: 'var(--text)',
  fontSize: 12,
  fontFamily: 'Montserrat, sans-serif',
  boxShadow: '0 12px 30px var(--shadow)',
}
export const legendStyle = {
  fontSize: 12,
  paddingTop: 10,
  color: 'var(--text-2)',
  fontFamily: 'Montserrat, sans-serif',
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
