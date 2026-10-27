import type { ReactNode } from 'react'
import type { Source } from '@/lib/types'
import SourceBadge from './SourceBadge'

export default function DataContext({
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
