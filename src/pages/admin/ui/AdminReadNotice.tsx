import { useState, type ReactElement } from 'react'
import { PageError } from '../../../components/PageError'

export interface AdminReadQuery {
  data: unknown
  error: unknown
  isPending: boolean
  isFetching: boolean
  refetch: () => Promise<unknown>
}

/** Persistent recovery for failed reads, without replacing cached content. */
export function AdminReadNotice({ queries }: { queries: readonly AdminReadQuery[] }): ReactElement | null {
  const [retrying, setRetrying] = useState(false)
  const failed = queries.filter(query => query.error)
  if (!failed.length && !retrying) return null
  return <PageError retrying={retrying || failed.some(query => query.isFetching)} onRetry={() => {
    setRetrying(true)
    void Promise.allSettled(failed.map(query => query.refetch())).finally(() => setRetrying(false))
  }} />
}
