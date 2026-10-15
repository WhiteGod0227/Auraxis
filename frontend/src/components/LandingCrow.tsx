import { useEffect, useRef, useState } from 'react'
import CrowMascot from './CrowMascot'
import type { CrowPose } from './CrowMascot'
import '@/styles/landing-crow.css'

const scenes: Record<string, { pose: CrowPose; reaction: string }> = {
  hero: { pose: 'gold', reaction: '' },
  problem: { pose: 'thinking', reaction: '?' },
  'how-it-works': { pose: 'building', reaction: '' },
  'maturity-comparison': { pose: 'balancing', reaction: '' },
  'explore-dashboard': { pose: 'pointing', reaction: '' },
  'honest-results': { pose: 'concerned', reaction: '…' },
  limitations: { pose: 'guarding', reaction: '' },
}

export default function LandingCrow() {
  const anchor = useRef<HTMLDivElement>(null)
  const bird = useRef<HTMLDivElement>(null)
  const [scene, setScene] = useState('hero')
  const [flying, setFlying] = useState(false)

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let flight: Animation | undefined
    let destination = ''
    const update = () => {
      frame = 0
      const node = bird.current
      if (!anchor.current || !node) return
      const rect = anchor.current.getBoundingClientRect()
      let current = 'hero'
      for (const id of Object.keys(scenes).slice(1)) {
        if (
          (document.getElementById(id)?.getBoundingClientRect().top ??
            Infinity) <
          window.innerHeight * 0.58
        )
          current = id
      }
      setScene(current)
      const docked = window.scrollY > 48 && !motion.matches
      node.dataset.facing = docked ? 'left' : 'right'
      if (!docked) {
        flight?.cancel()
        flight = undefined
        destination = ''
        node.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) scale(1)`
        node.style.visibility = 'visible'
        setFlying(false)
        return
      }
      const size = window.innerWidth < 700 ? 68 : 92
      const scale = size / 154
      const x = window.innerWidth - size - 28
      const y = window.innerHeight - size - (window.innerWidth < 700 ? 28 : 22)
      const key = `${current}:${x}:${y}`
      if (key === destination) return
      destination = key
      const start = node.getBoundingClientRect()
      const startScale = start.width / 154
      flight?.cancel()
      const end = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
      node.style.visibility = 'visible'
      node.style.transform = end
      setFlying(true)
      // A complete timed flight, independent of whether scrolling pauses.
      flight = node.animate(
        [
          {
            transform: `translate3d(${start.left}px, ${start.top}px, 0) scale(${startScale})`,
          },
          {
            transform: `translate3d(${(start.left + x) / 2}px, ${Math.max(60, Math.min(start.top, y) - 100)}px, 0) scale(${(startScale + scale) / 2})`,
            offset: 0.48,
          },
          { transform: end },
        ],
        { duration: 1100, easing: 'cubic-bezier(.22,.61,.36,1)' },
      )
      flight.onfinish = () => {
        setFlying(false)
        flight = undefined
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    schedule()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    motion.addEventListener('change', schedule)
    return () => {
      cancelAnimationFrame(frame)
      flight?.cancel()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      motion.removeEventListener('change', schedule)
    }
  }, [])

  return (
    <>
      <div className="landing-crow-anchor" ref={anchor} aria-hidden="true" />
      <div
        ref={bird}
        className={`landing-crow scene-${scene} ${flying ? 'is-flying' : ''}`}
        aria-hidden="true"
      >
        <div className="landing-crow-character">
          <CrowMascot pose={scenes[scene].pose} size="hero" />
        </div>
        {scenes[scene].reaction && (
          <span className="crow-reaction">{scenes[scene].reaction}</span>
        )}
      </div>
    </>
  )
}
