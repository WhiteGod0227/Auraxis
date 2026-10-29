import type { ReactNode } from 'react'
import type { Source } from '@/lib/types'
import SourceBadge from './SourceBadge'
import { formatDate } from '@/lib/format'

export default function DataContext({
  date,
  source,
  experimental,
  children,
}: {
  date: string | null | undefined
  source: Source
  experimental?: boolean
  children?: ReactNode
}) {
  return (
    <div className="research-context">
      <span className="data-asof">As of {formatDate(date ?? null)}</span>
      <SourceBadge source={source} />
      {experimental && (
        <strong className="experimental-notice">
          Experimental purity adjustment · unverified
        </strong>
      )}
      {children}
    </div>
  )
}
