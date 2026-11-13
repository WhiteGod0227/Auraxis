import { setCrowCursor, useCrowCursor } from '@/lib/cursorPref'

/** Switches the crow mouse pointer on or off (remembered). */
export default function CursorToggle() {
  const on = useCrowCursor()
  return (
    <button
      type="button"
      className={`theme-toggle cursor-toggle ${on ? 'is-on' : ''}`}
      onClick={() => setCrowCursor(!on)}
      aria-pressed={on}
      aria-label={on ? 'Use the normal mouse pointer' : 'Use the crow pointer'}
      title={on ? 'Crow pointer: on' : 'Crow pointer: off'}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        {/* arrow pointer */}
        <path
          d="M5 3.5 L5 18 L9 14.2 L11.6 20 L14 19 L11.4 13.3 L17 13.3 Z"
          fill={on ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {!on && (
          <path
            d="M3 3 L21 21"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        )}
      </svg>
    </button>
  )
}
