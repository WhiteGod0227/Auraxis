import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import Crow from './Crow'

interface Spot {
  x: number
  y: number
  size: number
  left: boolean
}

/** Drawn once at this size and scaled, so size changes animate smoothly. */
const BASE = 260

const reduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * The landing-page crow. It flies in, lands on the first `[data-perch]`
 * element and, as the reader scrolls, flies on an arc to perch on the next
 * one. Perch attributes: data-perch = horizontal anchor (0–1),
 * data-perch-size = crow size in px (default 150).
 */
export default function CrowGuide({
  root,
}: {
  root: RefObject<HTMLElement | null>
}) {
  const [spot, setSpot] = useState<Spot | null>(null)
  const [flying, setFlying] = useState(false)
  const active = useRef(-1)
  const timer = useRef(0)

  useEffect(() => {
    const host = root.current
    if (!host) return
    const perches = () =>
      Array.from(host.querySelectorAll<HTMLElement>('[data-perch]'))

    const spotFor = (index: number): Spot | null => {
      const target = perches()[index]
      if (!target) return null
      const base = host.getBoundingClientRect()
      const box = target.getBoundingClientRect()
      const wide = window.innerWidth > 720
      const size = Math.round(
        Number(target.dataset.perchSize || 150) * (wide ? 1 : 0.62),
      )
      const anchor = Number(target.dataset.perch || 0.8)
      const x = Math.min(
        Math.max(8, box.left - base.left + box.width * anchor - size / 2),
        base.width - size - 8,
      )
      // Feet (the bar's top, ~85% down the drawing) rest on the edge.
      const y = box.top - base.top - size * 0.86
      return { x, y, size, left: false }
    }

    const fly = (index: number, instant = false) => {
      const next = spotFor(index)
      if (!next) return
      setSpot((previous) => {
        if (previous && !instant) next.left = next.x < previous.x - 4
        return next
      })
      if (instant || reduced()) return
      setFlying(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setFlying(false), 1250)
    }

    const pick = () => {
      const list = perches()
      let index = 0
      list.forEach((element, i) => {
        if (element.getBoundingClientRect().top < window.innerHeight * 0.62)
          index = i
      })
      if (index !== active.current) {
        active.current = index
        fly(index)
      }
    }

    // Fly in from above the top-right corner.
    const start = window.setTimeout(() => {
      const base = host.getBoundingClientRect()
      setSpot({ x: base.width + 60, y: -260, size: 150, left: false })
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          active.current = -1
          pick()
        }),
      )
    }, 350)

    let frame = 0
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          pick()
        })
    }
    const onResize = () => {
      if (active.current >= 0) fly(active.current, true)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    document.fonts?.ready.then(onResize).catch(() => {})
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(timer.current)
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    }
  }, [root])

  if (!spot) return null
  return (
    <div
      className={`crow-guide ${flying ? 'is-flying' : ''} ${spot.left ? 'is-facing-left' : ''}`}
      style={{ transform: `translateX(${spot.x}px)` }}
      aria-hidden="true"
    >
      <div
        className="crow-guide-y"
        style={{ transform: `translateY(${spot.y}px)` }}
      >
        <div
          className="crow-guide-face"
          style={{
            transform: `translateX(${spot.left ? spot.size : 0}px) scale(${
              (spot.left ? -1 : 1) * (spot.size / BASE)
            }, ${spot.size / BASE})`,
          }}
        >
          <Crow
            size={BASE}
            mood={flying ? 'flying' : 'perched'}
            bar={!flying}
          />
        </div>
      </div>
    </div>
  )
}
