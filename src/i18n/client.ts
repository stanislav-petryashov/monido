import { bootstrapLanguage } from '../lib/bootstrapLanguage'
import type { i18n as I18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { loadChunkMessages, type LocaleChunk } from './chunks'
import { createI18n } from './core'
import { FALLBACK_LANGUAGE, LANGUAGES, languageOr, loadMessages, matchLanguage, type Language } from './languages'

/** The browser instance; set by initClientI18n before the first render. */
export let i18n: I18n

function browserLanguage(): Language | null {
  return typeof navigator === 'undefined' ? null : matchLanguage(navigator.languages ?? [])
}

function markDocument(lang: Language) {
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}

/** What is merged into a language's `translation` namespace: its main file or a locale chunk (src/i18n/chunks.ts). */
type Part = 'main' | LocaleChunk

/** `<lang>/<part>` → its load: kept once it succeeds, dropped when it fails, so the next ask tries again. */
let loads = new Map<string, Promise<void>>()
/** The chunks the pages asked for (loadLocaleChunk): a language switch loads them for the new language first. */
let askedChunks = new Set<LocaleChunk>()
/** The language applyFamilyLanguage is switching to: a chunk asked for meanwhile is loaded for it as well. */
let switchingTo: Language | null = null
/** Counts the switches: only the latest one changes the language (an older one may finish later, waiting on a slow file). */
let switches = 0

/**
 * Language order before the server answers: `preferred` → this tab’s bootstrap carry → browser languages → English. The family's language comes with
 * /api/auth and is applied by `applyFamilyLanguage`; only a new-installation locale is carried in tab-local sessionStorage until Welcome.
 */
export async function initClientI18n(preferred?: Language): Promise<void> {
  const lang = preferred ?? bootstrapLanguage() ?? browserLanguage() ?? FALLBACK_LANGUAGE
  // a locale file that fails to load must not leave the app blank: fall back to English
  i18n = await createI18n(lang).catch(() => createI18n(FALLBACK_LANGUAGE))
  initReactI18next.init(i18n)
  // a new instance holds the main files of English and its language, and no chunk
  loads = new Map([...new Set([FALLBACK_LANGUAGE, currentLanguage()])].map(l => [`${l}/main`, Promise.resolve()]))
  askedChunks = new Set()
  switchingTo = null
  switches++ // a switch begun on the old instance must not apply
  markDocument(currentLanguage())
}

/**
 * Merges a part of the language's messages into the instance unless it is there. Deep and in any order: a chunk's keys are
 * not in the main files (tests/i18n/locales.test.ts), so a chunk that arrives before its language's main file is kept.
 */
function ensureLoaded(lang: Language, part: Part = 'main'): Promise<void> {
  const key = `${lang}/${part}`
  const known = loads.get(key)
  if (known) return known
  const instance = i18n
  const messages = part === 'main' ? loadMessages(lang) : loadChunkMessages(part, lang)
  // a copy: the deep merge writes into the bundle, and the imported module must stay as it is (core.ts, createI18n)
  const load = messages.then(m => { instance.addResourceBundle(lang, 'translation', structuredClone(m), true, true) })
  const registry = loads
  registry.set(key, load)
  load.catch(() => { if (registry.get(key) === load) registry.delete(key) })
  return load
}

/**
 * Loads a lazy page's texts (src/i18n/chunks.ts) for English and for the current language; a lazy route awaits it with the
 * page module (lazyWithChunks.ts), so the page never shows raw keys. Without the English chunk it rejects (lazyWithChunks
 * retries once, then the route's error boundary shows); a chunk of another language that fails to load leaves its texts in
 * English, the fallback. A failed load is forgotten either way: the next loadLocaleChunk, or a language switch, fetches it again.
 */
export async function loadLocaleChunk(chunk: LocaleChunk): Promise<void> {
  askedChunks.add(chunk)
  const others = new Set([currentLanguage(), switchingTo].filter((l): l is Language => l !== null && l !== FALLBACK_LANGUAGE))
  await Promise.all([ensureLoaded(FALLBACK_LANGUAGE, chunk), ...[...others].map(l => ensureLoaded(l, chunk).catch(() => {}))])
}

/**
 * Switches the UI language without a reload (the family's language from the server, or the demo sign-in menu); stores nothing.
 * The chunks already asked for are loaded for the new language first (one that fails stays in English). Switches may overlap
 * (the language menu does not wait): the latest one wins, and an older one that finishes later changes nothing.
 */
export async function applyFamilyLanguage(lang: Language): Promise<void> {
  const mine = ++switches
  switchingTo = lang
  try {
    // one round trip: the main file and the chunks at once (merged deep, in any order: ensureLoaded)
    await Promise.all([ensureLoaded(lang), ...[...askedChunks].map(chunk => ensureLoaded(lang, chunk).catch(() => {}))])
    if (mine !== switches) return
    await i18n.changeLanguage(lang)
  } finally {
    if (mine === switches) switchingTo = null
  }
  markDocument(currentLanguage())
}

/**
 * A key's text in every language, in the order of LANGUAGES (what a family may have typed in either). Loads the missing main
 * locale files only, not the chunks: the key must be in the main files.
 */
export async function textInEveryLanguage(key: string): Promise<string[]> {
  await Promise.all(LANGUAGES.map(l => ensureLoaded(l)))
  return LANGUAGES.map(l => i18n.getFixedT(l)(key))
}

/** Each language's own name (`language.name` of its main locale file), for the language menu. Loads the missing main files. */
export async function loadLanguageNames(): Promise<Record<Language, string>> {
  const names = await textInEveryLanguage('language.name')
  return Object.fromEntries(LANGUAGES.map((l, i) => [l, names[i]])) as Record<Language, string>
}

/** Translation outside components (formatters, API errors). */
export function t(key: string, params?: Record<string, unknown>): string {
  return i18n.t(key, params)
}

/**
 * The message of a server error code (`errors.<code>` with its params) in the UI language, or `fallback` when the code
 * has no message: unknown to this build, or a key that holds a group (`errors.reminders`), which is not a message.
 */
export function errorMessage(code: string, params: Record<string, unknown> | undefined, fallback: string): string {
  const key = `errors.${code}`
  // with the params: a plural message exists only as its forms (`_one`, `_other`), found through `count`
  return i18n.exists(key, { ...params, returnObjects: false }) ? i18n.t(key, params) : fallback
}

export function currentLanguage(): Language {
  const lang = i18n?.language
  return languageOr(lang)
}
