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
    'de-DE': () => import('../locales/planning/de-DE.json').then(m => m.default),
    'es-ES': () => import('../locales/planning/es-ES.json').then(m => m.default),
    'fr-FR': () => import('../locales/planning/fr-FR.json').then(m => m.default),
    'pt-BR': () => import('../locales/planning/pt-BR.json').then(m => m.default),
    'zh-CN': () => import('../locales/planning/zh-CN.json').then(m => m.default),
  },
  analysis: {
    'en-US': () => import('../locales/analysis/en-US.json').then(m => m.default),
    'ru-RU': () => import('../locales/analysis/ru-RU.json').then(m => m.default),
    'de-DE': () => import('../locales/analysis/de-DE.json').then(m => m.default),
    'es-ES': () => import('../locales/analysis/es-ES.json').then(m => m.default),
    'fr-FR': () => import('../locales/analysis/fr-FR.json').then(m => m.default),
    'pt-BR': () => import('../locales/analysis/pt-BR.json').then(m => m.default),
    'zh-CN': () => import('../locales/analysis/zh-CN.json').then(m => m.default),
  },
  advisor: {
    'en-US': () => import('../locales/advisor/en-US.json').then(m => m.default),
    'ru-RU': () => import('../locales/advisor/ru-RU.json').then(m => m.default),
    'de-DE': () => import('../locales/advisor/de-DE.json').then(m => m.default),
    'es-ES': () => import('../locales/advisor/es-ES.json').then(m => m.default),
    'fr-FR': () => import('../locales/advisor/fr-FR.json').then(m => m.default),
    'pt-BR': () => import('../locales/advisor/pt-BR.json').then(m => m.default),
    'zh-CN': () => import('../locales/advisor/zh-CN.json').then(m => m.default),
  },
  // the Records and Settings screens (`data.*`), loaded with DataPage, which frames every one of them (AppShell)
  records: {
    'en-US': () => import('../locales/records/en-US.json').then(m => m.default),
    'ru-RU': () => import('../locales/records/ru-RU.json').then(m => m.default),
    'de-DE': () => import('../locales/records/de-DE.json').then(m => m.default),
    'es-ES': () => import('../locales/records/es-ES.json').then(m => m.default),
    'fr-FR': () => import('../locales/records/fr-FR.json').then(m => m.default),
    'pt-BR': () => import('../locales/records/pt-BR.json').then(m => m.default),
    'zh-CN': () => import('../locales/records/zh-CN.json').then(m => m.default),
  },
}

/** Every chunk: the server's bot texts (familyT) merge them all, the tests' Russian `ru` too */
export const LOCALE_CHUNKS = /* @__PURE__ */ Object.keys(LOADERS) as LocaleChunk[]

export function loadChunkMessages(chunk: LocaleChunk, lang: Language): Promise<Messages> {
  return LOADERS[chunk][lang]()
}
