import enUS from '../locales/en-US.json'

/** UI languages. Adding one: a file in src/locales/, its code here and a loader in LOADERS. */
export const LANGUAGES = ['en-US', 'ru-RU', 'de-DE', 'es-ES', 'fr-FR', 'pt-BR', 'zh-CN'] as const
export type Language = typeof LANGUAGES[number]
export const FALLBACK_LANGUAGE: Language = 'en-US'

type Messages = Record<string, unknown>

// English is bundled (it is the fallback); the rest load on demand, as a separate chunk on the client
const LOADERS: Record<Language, () => Promise<Messages>> = {
  'en-US': async () => enUS,
  'ru-RU': () => import('../locales/ru-RU.json').then(m => m.default),
  'de-DE': () => import('../locales/de-DE.json').then(m => m.default),
  'es-ES': () => import('../locales/es-ES.json').then(m => m.default),
  'fr-FR': () => import('../locales/fr-FR.json').then(m => m.default),
  'pt-BR': () => import('../locales/pt-BR.json').then(m => m.default),
  'zh-CN': () => import('../locales/zh-CN.json').then(m => m.default),
}

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v)
}

/** `v` when it is a UI language, else `fallback`. */
export const languageOr = (v: unknown, fallback: Language = FALLBACK_LANGUAGE): Language => (isLanguage(v) ? v : fallback)

const primary = (tag: string) => tag.split('-')[0].toLowerCase()

/**
 * The language for the browser's preferred tags, in their order: a tag matches exactly
 * (case aside) or by its primary subtag ('ru', 'ru-UA' → 'ru-RU'); tags without a locale are skipped.
 */
export function matchLanguage(tags: readonly string[]): Language | null {
  for (const tag of tags) {
    const exact = LANGUAGES.find(l => l.toLowerCase() === tag.toLowerCase())
    const byPrimary = LANGUAGES.find(l => primary(l) === primary(tag))
    const found = exact ?? byPrimary
    if (found) return found
  }
  return null
}

/** A language in its own name, from Intl ('Deutsch', '中文'): the menus need no other language's messages for it. */
export function languageName(lang: Language): string {
  const primary = lang.split('-')[0]
  const name = new Intl.DisplayNames(primary, { type: 'language' }).of(primary) ?? lang
  return name.charAt(0).toLocaleUpperCase(lang) + name.slice(1)
}

export function loadMessages(lang: Language): Promise<Messages> {
  return LOADERS[lang]()
}
