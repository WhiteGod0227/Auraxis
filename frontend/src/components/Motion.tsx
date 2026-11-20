import { useEffect, useRef, useState } from 'react'

const REVEAL = '.reveal, .ui-card, .ov-product'
const reduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * App-wide motion: scroll reveals for cards (staggered), the cursor spotlight
 * on cards, and the top scroll-progress bar. Mount once.
 */
export function MotionManager() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || reduced()) return
    const root = document.documentElement
    root.classList.add('motion-ready')
    const io = new IntersectionObserver(
      (entries) => {
        let order = 0
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const el = entry.target as HTMLElement
          el.style.transitionDelay = `${Math.min(order++, 6) * 70}ms`
          el.classList.add('in')
          io.unobserve(el)
          window.setTimeout(() => (el.style.transitionDelay = ''), 1200)
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
    )
    // Track per effect run (StrictMode mounts effects twice in development).
    const watched = new WeakSet<Element>()
    // Safety net: never leave content hidden. Anything not revealed by
    // scrolling shows on its own shortly after it mounts, and on print.
    let fallback = 0
    const revealAll = () =>
      document.querySelectorAll<HTMLElement>(REVEAL).forEach((el) => {
        if (el.classList.contains('in')) return
        el.classList.add('in')
        io.unobserve(el)
      })
    const scan = () => {
      let added = false
      document.querySelectorAll<HTMLElement>(REVEAL).forEach((el) => {
        if (el.classList.contains('in') || watched.has(el)) return
        watched.add(el)
        io.observe(el)
        added = true
      })
      if (added) {
        window.clearTimeout(fallback)
        fallback = window.setTimeout(revealAll, 2500)
      }
    }
    scan()
    window.addEventListener('beforeprint', revealAll)
    const mo = new MutationObserver(scan)
    mo.observe(document.body, { childList: true, subtree: true })

    const spotlight = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest?.(
        '.ui-card, .ov-product, .lp-feature',
      ) as HTMLElement | null
      if (!card) return
      const rect = card.getBoundingClientRect()
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`)
      card.style.setProperty('--my', `${event.clientY - rect.top}px`)
    }
    document.addEventListener('pointermove', spotlight, { passive: true })
    return () => {
      io.disconnect()
      mo.disconnect()
      window.clearTimeout(fallback)
      window.removeEventListener('beforeprint', revealAll)
      document.removeEventListener('pointermove', spotlight)
      root.classList.remove('motion-ready')
    }
  }, [])
  return <ScrollProgress />
}

function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const max =
          document.documentElement.scrollHeight - window.innerHeight || 1
        if (bar.current)
          bar.current.style.transform = `scaleX(${Math.min(1, window.scrollY / max)})`
      })
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      cancelAnimationFrame(frame)
    }
  }, [])
  return <div ref={bar} className="scroll-progress" aria-hidden="true" />
}

export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="grid-lines" />
    </div>
  )
}

/** Animates a number from its previous value to `value` (ease-out cubic). */
export function CountUp({
  value,
  format,
  duration = 1100,
}: {
  value: number | null | undefined
  format: (value: number) => string
  duration?: number
}) {
  const finite = typeof value === 'number' && Number.isFinite(value)
  const still = reduced()
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (!finite || still) return
    const start = performance.now()
    const begin = from.current
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(begin + (value - begin) * eased)
      if (t < 1) frame = requestAnimationFrame(tick)
      else from.current = value
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [finite, still, value, duration])
  return <>{finite ? format(still ? value : shown) : '—'}</>
}
