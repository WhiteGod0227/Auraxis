import { useEffect, useId, useRef } from 'react'
import '@/styles/crow.css'

export type CrowMood =
  | 'perched'
  | 'thinking'
  | 'celebrating'
  | 'inspecting'
  | 'guarding'
  | 'alert'
  | 'sleepy'
  | 'pecking'
  | 'flying'

/* ---------- Eye tracking: one shared pointer listener for every crow ---------- */
const watchers = new Set<SVGSVGElement>()
let pointer: { x: number; y: number } | null = null
let frame = 0

function updateEyes() {
  frame = 0
  if (!pointer) return
  for (const svg of watchers) {
    const box = svg.getBoundingClientRect()
    if (!box.width) continue
    // The eye sits at ~(150, 76) of the 200×200 viewBox.
    const ex = box.left + box.width * 0.75
    const ey = box.top + box.height * 0.38
    const dx = pointer.x - ex
    const dy = pointer.y - ey
    const length = Math.hypot(dx, dy) || 1
    const reach = Math.min(1, length / 240)
    const flip = svg.closest('.is-facing-left') ? -1 : 1
    svg.style.setProperty('--lx', ((dx / length) * reach * flip).toFixed(3))
    svg.style.setProperty('--ly', ((dy / length) * reach).toFixed(3))
  }
}

function onPointerMove(event: PointerEvent) {
  pointer = { x: event.clientX, y: event.clientY }
  if (!frame) frame = requestAnimationFrame(updateEyes)
}

function watch(svg: SVGSVGElement) {
  if (!watchers.size) window.addEventListener('pointermove', onPointerMove)
  watchers.add(svg)
  return () => {
    watchers.delete(svg)
    if (!watchers.size) window.removeEventListener('pointermove', onPointerMove)
  }
}

/**
 * Auraxis mascot: a black crow with silver edging, perched on a bullion bar.
 * Head, wing and pupil are separate parts so CSS can animate breathing,
 * blinking, head tilts, wing flaps and moods; the eye follows the cursor.
 * Decorative only (aria-hidden).
 */
export default function Crow({
  mood = 'perched',
  size = 120,
  bar = true,
  animated = true,
  watchCursor = animated,
  className = '',
}: {
  mood?: CrowMood
  size?: number
  bar?: boolean
  animated?: boolean
  watchCursor?: boolean
  className?: string
}) {
  const uid = useId().replace(/:/g, '')
  const g = (name: string) => `${name}-${uid}`
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = ref.current
    if (!svg || !watchCursor) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    return watch(svg)
  }, [watchCursor])

  return (
    <svg
      ref={ref}
      className={`crow mood-${mood} ${animated ? 'is-animated' : ''} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={g('silver')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.45" stopColor="#D9D9DE" />
          <stop offset="0.75" stopColor="#A9A9B0" />
          <stop offset="1" stopColor="#5E5E66" />
        </linearGradient>
        <linearGradient id={g('ingot')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F4F4F6" />
          <stop offset="0.5" stopColor="#C4C4CA" />
          <stop offset="1" stopColor="#7C7C84" />
        </linearGradient>
        {/* User-space so the head and body shade as one piece. */}
        <linearGradient
          id={g('body')}
          gradientUnits="userSpaceOnUse"
          x1="78"
          y1="58"
          x2="148"
          y2="166"
        >
          <stop offset="0" stopColor="#2A2A2F" />
          <stop offset="0.55" stopColor="#141417" />
          <stop offset="1" stopColor="#070708" />
        </linearGradient>
        <linearGradient id={g('wing')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1E1E22" />
          <stop offset="1" stopColor="#0A0A0B" />
        </linearGradient>
        <radialGradient id={g('halo')} cx="0.5" cy="0.55" r="0.5">
          <stop offset="0" stopColor="#D9D9DE" stopOpacity="0.18" />
          <stop offset="1" stopColor="#D9D9DE" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle
        className="crow-halo"
        cx="108"
        cy="112"
        r="92"
        fill={`url(#${g('halo')})`}
      />

      {bar && (
        <g className="crow-ingot">
          <path
            d="M52 170 L148 170 L160 190 L40 190 Z"
            fill={`url(#${g('ingot')})`}
          />
          <path
            d="M52 170 L148 170 L152 176 L48 176 Z"
            fill="#FFFFFF"
            opacity="0.55"
          />
          <path
            d="M62 180 L138 180"
            stroke="#5E5E66"
            strokeWidth="1.2"
            opacity="0.5"
          />
          <text
            x="100"
            y="187"
            textAnchor="middle"
            fontSize="7"
            fontFamily="serif"
            fill="#3A3A40"
            letterSpacing="2"
          >
            999.9
          </text>
        </g>
      )}

      <g className="crow-bird">
        {/* tail */}
        <path
          className="crow-tail"
          d="M76 154 L22 178 L44 160 L16 166 L42 150 L20 150 L62 140 Z"
          fill={`url(#${g('wing')})`}
          stroke={`url(#${g('silver')})`}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        {/* legs */}
        <g className="crow-legs">
          <path
            d="M104 156 L102 171 M122 152 L124 171"
            stroke={`url(#${g('silver')})`}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M96 171 L108 171 M118 171 L130 171"
            stroke={`url(#${g('silver')})`}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>
        <g className="crow-torso">
          {/* body fill (no stroke) and its outline, leaving the neck open */}
          <path
            d="M70 158 C52 138 56 108 78 94 C90 86 102 84 112 87 C122 104 140 109 151 106 C151 127 140 147 120 158 C106 166 86 168 70 158 Z"
            fill={`url(#${g('body')})`}
          />
          <path
            d="M112 87 C102 84 90 86 78 94 C56 108 52 138 70 158 C86 168 106 166 120 158 C140 147 151 127 151 106"
            fill="none"
            stroke={`url(#${g('silver')})`}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* chest sheen */}
          <path
            d="M150 108 C146 128 136 144 120 154"
            fill="none"
            stroke="#D9D9DE"
            strokeOpacity="0.35"
            strokeWidth="3"
            strokeLinecap="round"
          />
          {/* wing */}
          <g className="crow-wing">
            <path
              d="M82 108 C98 98 126 102 140 118 C128 140 104 152 80 148 C92 136 92 120 82 108 Z"
              fill={`url(#${g('wing')})`}
              stroke={`url(#${g('silver')})`}
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M92 118 C106 116 120 120 128 128 M90 128 C102 128 114 132 120 138 M88 138 C98 140 106 142 110 146"
              fill="none"
              stroke="#D9D9DE"
              strokeOpacity="0.55"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </g>
        </g>
        {/* head: overlaps the neck so small tilts never open a gap */}
        <g className="crow-head">
          <path
            d="M112 87 C114 70 126 59 144 58 C158 58 168 64 170 76 C171 92 162 102 151 106 C142 116 118 112 108 92 Z"
            fill={`url(#${g('body')})`}
          />
          <path
            d="M112 87 C114 70 126 59 144 58 C158 58 168 64 170 76 C171 92 162 102 151 106"
            fill="none"
            stroke={`url(#${g('silver')})`}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* beak */}
          <path
            d="M165 68 C178 69 192 74 199 83 C194 85 188 86 182 86 C176 88 170 90 165 91 Z"
            fill={`url(#${g('silver')})`}
          />
          <path
            d="M166 80 C176 80 186 82 196 84"
            fill="none"
            stroke="#3A3A40"
            strokeWidth="1.1"
          />
          {/* eye */}
          <g className="crow-eye">
            <circle cx="150" cy="76" r="6.5" fill="#E6E6EA" />
            <g className="crow-pupil">
              <circle cx="151.5" cy="76.5" r="3.2" fill="#0A0A0B" />
              <circle cx="153" cy="74.5" r="1.2" fill="#FFFFFF" />
            </g>
          </g>
          {/* monocle (perched / inspecting / guarding) */}
          <g className="crow-monocle">
            <circle
              cx="150"
              cy="76"
              r="11"
              fill="none"
              stroke={`url(#${g('silver')})`}
              strokeWidth="2.4"
            />
            <path
              d="M158 85 C164 98 162 110 155 120"
              fill="none"
              stroke="#D9D9DE"
              strokeWidth="1"
              strokeDasharray="2 2.5"
            />
          </g>
        </g>
      </g>

      {/* mood accessories */}
      <g className="crow-thinking">
        <circle cx="168" cy="44" r="3" fill="#D9D9DE" />
        <circle cx="178" cy="32" r="4.2" fill="#D9D9DE" />
        <circle cx="190" cy="18" r="5.6" fill="#D9D9DE" />
      </g>
      <g
        className="crow-sleep"
        fill="#D9D9DE"
        fontFamily="Montserrat, sans-serif"
      >
        <text className="z z1" x="168" y="52" fontSize="13" fontWeight="600">
          z
        </text>
        <text className="z z2" x="180" y="36" fontSize="16" fontWeight="600">
          z
        </text>
        <text className="z z3" x="192" y="18" fontSize="19" fontWeight="600">
          z
        </text>
      </g>
      <g
        className="crow-alert"
        stroke="#D9D9DE"
        strokeWidth="2.4"
        strokeLinecap="round"
      >
        <path d="M172 52 L180 42" />
        <path d="M180 62 L192 58" />
        <path d="M162 46 L164 34" />
      </g>
      <g className="crow-sparkles" fill="#F4F4F6">
        <path
          className="spark s1"
          d="M40 60 l3 9 9 3 -9 3 -3 9 -3 -9 -9 -3 9 -3z"
        />
        <path
          className="spark s2"
          d="M176 120 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z"
        />
        <path
          className="spark s3"
          d="M120 26 l2.4 7 7 2.4 -7 2.4 -2.4 7 -2.4 -7 -7 -2.4 7 -2.4z"
        />
      </g>
    </svg>
  )
}
