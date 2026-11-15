// The Telegram texts, in the family language: the sender passes a `t` from createI18n(the family settings' language).
import type { Translate } from '../../i18n/core'
import { monthTitle } from '../../i18n/dates'

/** Up to this many months are listed in full; beyond — the first three and «and N more» */
const LIST_MAX = 6

/** The reminder text: which months are open and where to go. No amounts or account names in it. */
export function reminderText(t: Translate, openMonths: string[], appUrl: string | null): string {
  const titles = openMonths.map(ym => monthTitle(t, ym))
  const where = appUrl ? `${appUrl.replace(/\/+$/, '')}/close` : null
  const openApp = t('modules.reminders.message.openApp')
  if (titles.length === 1) {
    return `${t('modules.reminders.message.single', { month: titles[0] })}\n${where ? t('modules.reminders.message.closeAt', { url: where }) : openApp}`
  }
  const n = titles.length
  const list = n > LIST_MAX ? t('modules.reminders.message.more', { list: titles.slice(0, 3).join(', '), rest: n - 3 }) : titles.join(', ')
  // a plural key: in Russian the verb agrees with the number too (singular for 21, plural for 2)
  const head = t('modules.reminders.message.head', { count: n, list })
  return `${head}\n${where ? t('modules.reminders.message.closeFirstAt', { month: titles[0], url: where }) : openApp}`
}

/** The test message: checks the bot and the chat. */
export const testMessage = (t: Translate): string => t('modules.reminders.message.test')
