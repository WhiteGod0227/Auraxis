import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import CrowMascot from './CrowMascot'
import '@/styles/crow-loader.css'

const activeLoaders = new Map<symbol, string>()
const listeners = new Set<() => void>()
let previousOverflow = ''
let contentWasInert = false
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const snapshot = () => activeLoaders.keys().next().value
const notify = () => listeners.forEach((listener) => listener())

export default function CrowLoader({ label = 'Loading…' }: { label?: string }) {
  const [token] = useState(() => Symbol('crow-loading'))
  const visibleLoader = useSyncExternalStore(
    subscribe,
    snapshot,
    () => undefined,
  )
  useEffect(() => {
    const content = document.querySelector<HTMLElement>('.auraxis-content')
    if (activeLoaders.size === 0) {
      previousOverflow = document.body.style.overflow
      contentWasInert = content?.inert ?? false
      document.body.style.overflow = 'hidden'
      if (content) content.inert = true
    }
    activeLoaders.set(token, label)
    notify()
    return () => {
      activeLoaders.delete(token)
      if (activeLoaders.size === 0) {
        document.body.style.overflow = previousOverflow
        if (content) content.inert = contentWasInert
      }
      notify()
    }
  }, [token, label])
  if (visibleLoader !== token) return null
  return createPortal(
    <div className="crow-loading-state" role="status">
      <div className="crow-ripple-loader" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((ring) => (
          <span className="crow-ripple-box" key={ring} />
        ))}
        <div className="crow-ripple-logo">
            <CrowMascot pose="walking" />
        </div>
      </div>
      <span className="sr-only">{label}</span>
    </div>,
    document.body,
  )
}
