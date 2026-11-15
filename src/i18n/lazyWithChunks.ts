import { lazy, type LazyExoticComponent } from 'react'
import type { LocaleChunk } from './chunks'
import { loadLocaleChunk } from './client'

/** What React's lazy() accepts as a page: any component (its own constraint, read from its type). */
type Page = Awaited<ReturnType<Parameters<typeof lazy>[0]>>['default']

/** The pause before the one retry: long enough for a dropped connection to come back. */
const RETRY_DELAY_MS = 500

/**
 * `lazy()` for a page whose texts are locale chunks (src/i18n/chunks.ts): the page module and its chunks load together, so
 * the page never renders raw keys. A failed load is tried once more after a short pause (a failed chunk is forgotten by
 * loadLocaleChunk, so the retry fetches it again). A second failure reaches the route's error boundary, and React keeps that
 * rejection: as with any lazy page, the route then needs a reload.
 */
export function lazyWithChunks<T extends Page>(load: () => Promise<{ default: T }>, ...chunks: LocaleChunk[]): LazyExoticComponent<T> {
  const loadAll = async () => {
    const [page] = await Promise.all([load(), Promise.all(chunks.map(chunk => loadLocaleChunk(chunk)))])
    return page
  }
  return lazy(() => loadAll().catch(() => new Promise<void>(resolve => setTimeout(resolve, RETRY_DELAY_MS)).then(loadAll)))
}
