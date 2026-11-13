import { useEffect, useRef, useState } from 'react'
import Crow from './Crow'
import { useCrowCursor } from '@/lib/cursorPref'
import '@/styles/crow-cursor.css'

/** Drawn size of the cursor crow (px). */
const SIZE = 42
/** The crow is mirrored, then turned clockwise, so the beak points up-left. */
const ANGLE = 35
/** Beak tip in the 200-unit drawing, before mirroring. */
const BEAK = { x: 199, y: 83 }

/** Where the beak tip lands inside the SIZE×SIZE box after the pose transform. */
function tip() {
  const s = SIZE / 200
  // mirror horizontally about the centre, then rotate clockwise about it
  const vx = (200 - BEAK.x) * s - SIZE / 2
  const vy = BEAK.y * s - SIZE / 2
  const r = (ANGLE * Math.PI) / 180
  return {
    x: SIZE / 2 + vx * Math.cos(r) - vy * Math.sin(r),
    y: SIZE / 2 + vx * Math.sin(r) + vy * Math.cos(r),
  }
}
const TIP = tip()

const TEXT_TARGET =
  'textarea, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="color"])'
const CLICK_TARGET =
  'a, button, [role="button"], select, summary, label, .clickable, input, [tabindex]:not([tabindex="-1"])'

function supported() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return (
    window.matchMedia('(pointer: fine)').matches &&
    window.matchMedia('(hover: hover)').matches &&
    !window.matchMedia('(forced-colors: active)').matches
  )
}

/**
 * Replaces the mouse pointer with a small live crow whose beak tip is the
 * exact hotspot. Moves with the pointer each frame (no easing, so clicks land
 * where the beak points); only the eye, wing and body animate.
 */
export default function CrowCursor() {
  const [device] = useState(supported)
  const preferred = useCrowCursor()
  const enabled = device && preferred
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const root = document.documentElement
    root.classList.add('crow-cursor-on')

    let x = -200
    let y = -200
    let lastX = 0
    let lastY = 0
    let frame = 0
    let moveTimer = 0
    let idleTimer = 0
    const r = (ANGLE * Math.PI) / 180

    const render = () => {
      frame = 0
      el.style.transform = `translate3d(${x - TIP.x}px, ${y - TIP.y}px, 0)`
    }
    const set = (name: string, on: boolean) => el.classList.toggle(name, on)

    const onMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== 'mouse') {
        set('is-hidden', true)
        root.classList.remove('crow-cursor-on')
        return
      }
      root.classList.add('crow-cursor-on')
      x = event.clientX
      y = event.clientY
      const dx = x - lastX
      const dy = y - lastY
      lastX = x
      lastY = y
      const speed = Math.hypot(dx, dy)

      set('is-hidden', false)
      set('is-idle', false)
      if (speed > 16) {
        set('is-moving', true)
        window.clearTimeout(moveTimer)
        moveTimer = window.setTimeout(() => set('is-moving', false), 180)
      }
      if (speed > 1.5) {
        // Turn the movement into the crow's own frame so the eye looks ahead.
        const lx = -(dx * Math.cos(r) + dy * Math.sin(r)) / speed
        const ly = (-dx * Math.sin(r) + dy * Math.cos(r)) / speed
        el.style.setProperty('--lx', lx.toFixed(2))
        el.style.setProperty('--ly', ly.toFixed(2))
      }

      const target = event.target as Element | null
      const typing = Boolean(target?.closest?.(TEXT_TARGET))
      set('is-text', typing)
      root.classList.toggle('crow-cursor-text', typing)
      set('is-pointing', !typing && Boolean(target?.closest?.(CLICK_TARGET)))

      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => set('is-idle', true), 4500)
      if (!frame) frame = requestAnimationFrame(render)
    }
    const onDown = () => set('is-pressed', true)
    const onUp = () => set('is-pressed', false)
    const onLeave = (event: PointerEvent) => {
      if (!event.relatedTarget) set('is-hidden', true)
    }
    const onBlur = () => set('is-hidden', true)

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    document.addEventListener('pointerout', onLeave)
    window.addEventListener('blur', onBlur)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(moveTimer)
      window.clearTimeout(idleTimer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointerout', onLeave)
      window.removeEventListener('blur', onBlur)
      root.classList.remove('crow-cursor-on', 'crow-cursor-text')
    }
  }, [enabled])

  if (!enabled) return null
  return (
    <div
      ref={ref}
      className="crow-cursor is-hidden"
      aria-hidden="true"
      style={
        {
          '--tip-x': `${TIP.x}px`,
          '--tip-y': `${TIP.y}px`,
          '--pose': `${ANGLE}deg`,
          width: SIZE,
          height: SIZE,
        } as React.CSSProperties
      }
    >
      <div className="crow-cursor-press">
        <div className="crow-cursor-pose">
          <Crow size={SIZE} bar={false} mood="perched" watchCursor={false} />
        </div>
      </div>
    </div>
  )
}
