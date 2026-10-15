import '@/styles/crow-mascot.css'

export type CrowPose =
  | 'gold'
  | 'walking'
  | 'running'
  | 'inspecting'
  | 'reading'
  | 'thinking'
  | 'building'
  | 'balancing'
  | 'pointing'
  | 'concerned'
  | 'guarding'

export default function CrowMascot({
  pose = 'walking',
  size = 'small',
}: {
  pose?: CrowPose
  size?: 'small' | 'hero'
}) {
  return (
    <div className={`crow-mascot crow-${pose} crow-${size}`} aria-hidden="true">
      <div className="crow-stage">
        <svg className="crow-flight-wing" viewBox="0 0 200 200">
          <path
            d="M87 108Q29 90 12 48L34 53 24 32 46 45 43 20Q86 44 101 91Z"
            fill="#1b2030"
            stroke="#30394d"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
        <svg className="crow-ground" viewBox="0 0 200 200">
          <ellipse cx="96" cy="186" rx="55" ry="7" fill="#000" opacity=".4" />
        </svg>
        <svg className="crow-leg-right" viewBox="0 0 200 200">
          <path
            d="M25 1 26 27 40 32 29 32 22 28"
            fill="none"
            stroke="#080a0e"
            strokeWidth="7"
            strokeLinecap="round"
          />
        </svg>
        <svg className="crow-body" viewBox="0 0 200 200">
          <path
            d="M45 107 40 132 62 126"
            fill="#191e2c"
            stroke="#080a0e"
            strokeWidth="2"
          />
          <path
            d="M64 57C39 68 32 88 36 112 38 127 48 130 52 135L57 136 62 143 70 143 76 150 87 148 94 152 103 146 112 149 120 142 130 141C144 125 151 108 149 89 147 67 132 55 111 52Z"
            fill="#191e2c"
            stroke="#080a0e"
            strokeWidth="3"
          />
          <path
            d="M70 92Q76 121 56 126"
            fill="none"
            stroke="#30394d"
            strokeWidth="3"
            strokeLinecap="round"
          />
          {pose === 'gold' && (
            <g>
              <path
                d="M100 85Q124 104 149 88"
                fill="none"
                stroke="#34455c"
                strokeWidth="12"
                strokeLinecap="round"
              />
              <path
                d="M127 70 157 70 168 88 119 88Z"
                fill="#f5b942"
                stroke="#fff0ac"
                strokeWidth="2"
              />
              <path
                d="M127 70 135 88M157 70 150 88"
                stroke="#b9781b"
                strokeWidth="2"
              />
              <path d="M145 55v8m-4-4h8" stroke="#ffe69b" strokeWidth="2" />
            </g>
          )}
          {pose === 'thinking' && (
            <g className="crow-gesture" fill="none" strokeLinecap="round">
              <path
                d="M87 109Q118 109 112 59"
                stroke="#34455c"
                strokeWidth="13"
              />
              <path
                d="M108 59 115 52m-3 7 10-2"
                stroke="#899cb5"
                strokeWidth="3"
              />
            </g>
          )}
          {pose === 'building' && (
            <g>
              <g fill="#f5b942" stroke="#ffe6a1" strokeWidth="2">
                <path d="m114 114 33 0 7 14h-47Z" />
                <path d="m121 98 24 0 6 13h-36Z" />
              </g>
              <g className="crow-building-wing">
                <path
                  d="M94 90Q119 63 143 70"
                  fill="none"
                  stroke="#34455c"
                  strokeWidth="12"
                  strokeLinecap="round"
                />
                <path
                  d="m132 59 23 0 6 12h-35Z"
                  fill="#f5b942"
                  stroke="#ffe6a1"
                  strokeWidth="2"
                />
              </g>
            </g>
          )}
          {pose === 'balancing' && (
            <g>
              <path
                d="M98 92 139 86"
                stroke="#34455c"
                strokeWidth="12"
                strokeLinecap="round"
              />
              <path d="M139 51v64" stroke="#d4aa67" strokeWidth="4" />
              <g
                className="crow-scales"
                stroke="#ffe6a1"
                fill="none"
                strokeWidth="2"
              >
                <path d="M113 61h52m-43 0-10 24h20l-10-24m35 0-10 24h20l-10-24" />
                <path d="M112 85q10 15 20 0m15 0q10 15 20 0" fill="#f5b942" />
              </g>
            </g>
          )}
          {pose === 'pointing' && (
            <g className="crow-pointing-wing">
              <path
                d="M91 91Q117 68 159 62L143 74 161 72 148 83Q123 85 108 104Z"
                fill="#34455c"
                stroke="#899cb5"
                strokeWidth="2"
              />
            </g>
          )}
          {pose === 'concerned' && (
            <g
              fill="none"
              stroke="#536782"
              strokeWidth="9"
              strokeLinecap="round"
            >
              <path d="M70 96 57 76M103 97 119 79" />
            </g>
          )}
          {pose === 'guarding' && (
            <g className="crow-shield">
              <path
                d="m115 65 26-9 26 9v28q-3 21-26 34-23-13-26-34Z"
                fill="#243249"
                stroke="#f5b942"
                strokeWidth="3"
              />
              <path
                d="M141 72v22m0 9v2"
                stroke="#ffe6a1"
                strokeWidth="5"
                strokeLinecap="round"
              />
            </g>
          )}
          {pose === 'inspecting' && (
            <g fill="none" strokeLinecap="round">
              <path d="M109 89 134 75" stroke="#34455c" strokeWidth="11" />
              <circle
                cx="145"
                cy="58"
                r="18"
                fill="#60a5fa22"
                stroke="#f5b942"
                strokeWidth="5"
              />
              <path d="M133 74 121 94" stroke="#d4aa67" strokeWidth="7" />
              <path d="M140 51 148 48" stroke="#e4edf9" strokeWidth="3" />
            </g>
          )}
          {pose === 'reading' && (
            <g>
              <path
                d="M107 77Q124 71 137 78 150 71 166 77V105Q150 100 137 108 121 100 107 105Z"
                fill="#ead7ab"
                stroke="#f5b942"
                strokeWidth="3"
              />
              <path
                d="M137 79v26M115 84h14m-14 7h14m16-7h13m-13 7h13"
                stroke="#755b30"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>
        <svg className="crow-leg-left" viewBox="0 0 200 200">
          <path
            d="M46 -2 40 23 48 29 39 29 35 25 39 9"
            fill="none"
            stroke="#191e2c"
            strokeWidth="7"
            strokeLinecap="round"
          />
        </svg>
        <svg className="crow-head" viewBox="0 0 200 200">
          <path
            d="M39 91C37 67 53 43 76 42 99 40 117 56 122 80L119 98 114 105 114 111 103 114 98 121 90 119 84 124 77 120 70 123 63 117 54 117 50 111 44 110 40 103Z"
            fill="#191e2c"
            stroke="#30394d"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="89" cy="86" r="7" fill="#fff" />
          <circle cx="113" cy="77" r="6.5" fill="#fff" />
          <path
            d="M108 85 139 98 107 95Z"
            fill="#080a0e"
            stroke="#30394d"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {(pose === 'thinking' || pose === 'concerned') && (
            <path
              d={pose === 'thinking' ? 'M80 70 96 73' : 'M80 75 95 69'}
              stroke="#b7c6da"
              strokeWidth="3"
              strokeLinecap="round"
            />
          )}
        </svg>
      </div>
    </div>
  )
}
