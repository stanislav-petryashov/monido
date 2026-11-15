import type { Language } from './languages'

/**
 * Locale chunks: the texts of lazily loaded pages, kept out of the main locale files so that the initial bundle does not
 * carry them. A chunk is `src/locales/<chunk>/<lang>.json`, with the same keys in the same `translation` namespace as the
 * main files; `loadLocaleChunk` (client.ts) merges it in. A new chunk: its name here, a file per language, a loader per language.
 */
export type LocaleChunk = 'advisor' | 'records' | 'analysis' | 'planning'

type Messages = Record<string, unknown>

// each one a separate chunk on the client, loaded with the page that needs it (lazyWithChunks.ts)
const LOADERS: Record<LocaleChunk, Record<Language, () => Promise<Messages>>> = {
  planning: {
    'en-US': () => import('../locales/planning/en-US.json').then(m => m.default),
    'ru-RU': () => import('../locales/planning/ru-RU.json').then(m => m.default),
  },
  analysis: {
    'en-US': () => import('../locales/analysis/en-US.json').then(m => m.default),
    'ru-RU': () => import('../locales/analysis/ru-RU.json').then(m => m.default),
  },
  advisor: {
    'en-US': () => import('../locales/advisor/en-US.json').then(m => m.default),
    'ru-RU': () => import('../locales/advisor/ru-RU.json').then(m => m.default),
  },
  // the Records and Settings screens (`data.*`), loaded with DataPage, which frames every one of them (AppShell)
  records: {
    'en-US': () => import('../locales/records/en-US.json').then(m => m.default),
    'ru-RU': () => import('../locales/records/ru-RU.json').then(m => m.default),
  },
}

/** Every chunk: the server's bot texts (familyT) merge them all, the tests' Russian `ru` too */
export const LOCALE_CHUNKS = /* @__PURE__ */ Object.keys(LOADERS) as LocaleChunk[]

export function loadChunkMessages(chunk: LocaleChunk, lang: Language): Promise<Messages> {
  return LOADERS[chunk][lang]()
}
