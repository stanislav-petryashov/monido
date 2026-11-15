import { applyFamilyLanguage } from '../../src/i18n/client'
import { LOCALE_CHUNKS, loadChunkMessages } from '../../src/i18n/chunks'
import { createI18n, type Translate } from '../../src/i18n/core'
import type { Language } from '../../src/i18n/languages'

const russian = await createI18n('ru-RU')
// the locale chunks too (src/i18n/chunks.ts): a copy, since the deep merge writes into the bundle
for (const chunk of LOCALE_CHUNKS) russian.addResourceBundle('ru-RU', 'translation', structuredClone(await loadChunkMessages(chunk, 'ru-RU')), true, true)
const russianT = russian.getFixedT('ru-RU')

/** Russian text of a key from ru-RU.json or a chunk's ru-RU.json: tests compare with it instead of holding Cyrillic literals. */
export const ru: Translate = (key, params) => russianT(key, params)

/** Runs `fn` with the app in `lang`, then switches back to English (the test language). */
export async function withLanguage<T>(lang: Language, fn: () => T | Promise<T>): Promise<T> {
  await applyFamilyLanguage(lang)
  try {
    return await fn()
  } finally {
    await applyFamilyLanguage('en-US')
  }
}
