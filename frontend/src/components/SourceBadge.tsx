import type { Source } from '@/lib/types'

export default function SourceBadge({ source }: { source: Source }) {
  if (source === 'API') return null

  return (
    <span
      className={`source-badge${source === 'Offline snapshot' ? 'offline' : ''}`}
      aria-label={`Data source: ${source}`}
    >
      {source}
    </span>
  )
}
