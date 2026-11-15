// The bot's wording: every message is in the family language (app_settings), not in a person's own.
import type { Right, Rights } from '../../domain/api'
import { LOCALE_CHUNKS, loadChunkMessages } from '../../i18n/chunks'
import { createI18n, type Translate } from '../../i18n/core'
import { FALLBACK_LANGUAGE, type Language } from '../../i18n/languages'
import type { Database } from '../db'
import { readFamilySettings } from '../familySettings'

/** The bot's `t` of each language, built once: the locale files are fixed while the server runs */
const translators = new Map<Language, Promise<Translate>>()

/** A fresh instance in `language` with every locale chunk merged in (the advisor's cards are in the advisor chunk). */
async function build(language: Language): Promise<Translate> {
  const instance = await createI18n(language)
  // the bot's own formatter, kept out of the browser's bundle: `{{month, year}}` — 'YYYY-MM' → 'YYYY'
  instance.services.formatter?.add('year', (value: string) => String(value).slice(0, 4))
  for (const chunk of LOCALE_CHUNKS) {
    for (const lang of new Set([FALLBACK_LANGUAGE, language])) {
      // a copy: the deep merge keeps the objects it is given and writes into them later, and the chunk modules are shared
      instance.addResourceBundle(lang, 'translation', structuredClone(await loadChunkMessages(chunk, lang)), true, true)
    }
  }
  return instance.getFixedT(language)
}

/**
 * The bot's `t` in the family language, with the language itself (for numbers and money), read together: a render that
 * uses both cannot straddle a language switch. Every locale chunk is merged in: the server words texts of every page.
 */
export async function familyT(db: Database): Promise<{ t: Translate; lang: Language }> {
  const { language } = await readFamilySettings(db)
  let t = translators.get(language)
  if (!t) {
    t = build(language)
    translators.set(language, t)
    // a failed build is not kept: the next message tries again
    t.catch(() => translators.delete(language))
  }
  return { t: await t, lang: language }
}

const RIGHTS: readonly Right[] = ['edit', 'vote', 'manage']

/** "You can: view, enter data…" and, when something is missing, "You cannot: …" on the next line. */
export function rightsLines(t: Translate, rights: Rights): string {
  const can = [t('bot.rights.view'), ...RIGHTS.filter(r => rights[r]).map(r => t(`bot.rights.${r}`))]
  const cannot = RIGHTS.filter(r => !rights[r]).map(r => t(`bot.rights.${r}`))
  const lines = [t('bot.rights.can', { list: can.join(', ') })]
  if (cannot.length) lines.push(t('bot.rights.cannot', { list: cannot.join(', ') }))
  return lines.join('\n')
}
