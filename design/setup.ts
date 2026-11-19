// The catalog's data and language: a query cache seeded with a fictional family, every locale chunk loaded
import { QueryClient } from '@tanstack/react-query'
import { LOCALE_CHUNKS } from '../src/i18n/chunks'
import { initClientI18n, loadLocaleChunk } from '../src/i18n/client'
import type { Language } from '../src/i18n/languages'
import { snapshotQueryKey } from '../src/lib/useFinanceData'
import { makeSnapshot } from '../tests/helpers/snapshot'

/** A client whose cache already holds what the shared elements read; nothing is ever refetched */
export function designClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(snapshotQueryKey(null), makeSnapshot())
  client.setQueryData(['admin', 'availability'], { assessments: [] })
  return client
}

/** The language and every locale chunk, before the first render (no raw keys on the page) */
export async function initDesignI18n(lang: Language): Promise<void> {
  await initClientI18n(lang)
  await Promise.all(LOCALE_CHUNKS.map(chunk => loadLocaleChunk(chunk)))
}
