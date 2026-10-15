import { useEffect, useState } from 'react'
import { ClientError } from './api'
import type { ErrorKind } from './api'
import { currentResource } from './relativeValue'
import type { SourcedResponse } from './types'

export interface Resource<T> {
  response?: SourcedResponse<T>
  errorKind?: ErrorKind
  error?: string
  loading: boolean
  retry: () => void
}
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<SourcedResponse<T>>,
): Resource<T> {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    revision: number
    load?: typeof load
    response?: SourcedResponse<T>
    errorKind?: ErrorKind
    error?: string
  }>({ revision: -1 })
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    Promise.resolve()
      .then(() => load(controller.signal))
      .then((response) => {
        if (active && !controller.signal.aborted)
          setResult({ revision, load, response })
      })
      .catch((error) => {
        if (active && !controller.signal.aborted)
          setResult({
            revision,
            load,
            errorKind: error instanceof ClientError ? error.kind : undefined,
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load this dataset.',
          })
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [load, revision])
  return {
    response:
      result.revision === revision
        ? currentResource(result.load, load, result.response)
        : undefined,
    errorKind: currentResource(result.load, load, result.errorKind),
    error: result.load === load ? result.error : undefined,
    loading: result.revision !== revision || result.load !== load,
    retry: () => setRevision((value) => value + 1),
  }
}
