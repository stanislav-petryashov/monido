import type { Database } from './db'
import type { BotUpdate } from './bot/updates'
import { sendMessage } from './bot/telegram'
import { familyT } from './bot/texts'
import { findUser } from './users'
import { telegramGroups, telegramPreferences } from './familyTelegram'
import { sha256Hex } from './secrets'
import { commitMutation } from './mutations'
import { getSnapshot } from './snapshot'
import { GROUPING, type Translate } from '../i18n/core'
import { monthTitle } from '../i18n/dates'
import { isMonthChange } from '../domain/capitalChange'
import type { FinanceSnapshot } from '../domain/types'
import { changeText, milestoneText } from '../lib/milestoneText'

export async function handleFamilyTelegram(update: BotUpdate, { db, token, username, fetchImpl, now = new Date() }: {
  db: Database; token: string; username: string | null; fetchImpl?: typeof fetch; now?: Date
}): Promise<boolean> {
  if (update.kind !== 'message') return false
  const group = update.chatType === 'group' || update.chatType === 'supergroup'
  const command = /^\/(pair|help|summary)(?:@([\w]+))?(?:\s+([^\s]+))?$/.exec(update.text.trim())
  if (!command || (command[2] && command[2].toLowerCase() !== username?.toLowerCase()) || (group && !command[2])) return false
  if (!group && (update.chatType !== 'private' || update.chatId !== update.from.id)) return false
  const user = await findUser(db, { telegramId: update.from.id })
  if (!user) return true
  const { t, lang } = await familyT(db)
  if (command[1] === 'pair') {
    if (!group || !user.rights.manage || !command[3]) return true
    const paired = await commitMutation(db, async () => {
      const valid = await db.prepare('SELECT 1 FROM family_telegram_pairing WHERE id = 1 AND hash = ? AND expires_at > ?').bind(sha256Hex(command[3]), now.toISOString()).first()
      // Re-read the sender under the mutation's optimistic guard; rights may have changed during the reads.
      if (!valid || !(await findUser(db, { telegramId: update.from.id }))?.rights.manage) return { statements: [], result: false }
      return { statements: [
        db.prepare('INSERT INTO family_telegram_groups (chat_id, title, proposal_cursor) VALUES (?, ?, (SELECT COALESCE(MAX(id), 0) FROM change_log)) ON CONFLICT(chat_id) DO UPDATE SET title = excluded.title').bind(update.chatId, update.chatTitle ?? update.chatId),
        db.prepare('DELETE FROM family_telegram_pairing WHERE id = 1'),
      ], result: true }
    })
    await sendMessage(token, update.chatId, t(paired ? 'familyTelegram.bot.paired' : 'familyTelegram.bot.invalidPairing'), fetchImpl)
    return true
  }
  if (!(await telegramPreferences(db, user.id))?.conversation) return true
  if (group && !(await telegramGroups(db)).find(g => g.chatId === update.chatId)?.conversation) return true
  let text = t('familyTelegram.bot.help')
  if (command[1] === 'summary') {
    const snapshot = await getSnapshot(db, { download: false, now })
    const capital = snapshot.capital
    // a balance missing or without a rate leaves the totals it is part of unknown, as on Overview
    const coverage = capital && snapshot.capitalCoverage?.find(c => c.month === capital.date.slice(0, 7))
    const amount = (known: boolean | undefined, v: number) => (known ? new Intl.NumberFormat(lang, { maximumFractionDigits: 0, useGrouping: GROUPING }).format(v) : '—')
    text = capital ? t('familyTelegram.bot.summary', {
      date: snapshot.asOf.capitalDate, currency: snapshot.baseCurrency,
      assets: amount(coverage?.assetsKnown, capital.assets),
      liabilities: amount(capital.loans.every(l => l.balanceBase !== null), capital.liabilities),
      netWorth: amount(coverage?.capitalKnown, capital.netWorth),
    }) + monthLines(t, snapshot, v => amount(true, v)) : t('familyTelegram.bot.noData')
  }
  // Snapshot work yields: a disconnected chat or revoked sender must not receive its result.
  const currentUser = await findUser(db, { telegramId: update.from.id })
  if (!currentUser || !(await telegramPreferences(db, currentUser.id))?.conversation) return true
  if (group && !(await telegramGroups(db)).find(g => g.chatId === update.chatId)?.conversation) return true
  await sendMessage(token, update.chatId, text, fetchImpl)
  return true
}

/** The latest closed month after the balances: its change, what the family added apart from markets, its milestones; nothing for a gap */
function monthLines(t: Translate, s: FinanceSnapshot, fmt: (v: number) => string): string {
  const change = s.capitalChange?.at(-1)
  if (!change || !isMonthChange(change)) return ''
  // Intl writes a hyphen: the app's minus sign, as on screen
  const signedFmt = (v: number) => (v < 0 ? `−${fmt(-v)}` : fmt(v))
  const sign = (v: number) => (v > 0 ? `+${fmt(v)}` : signedFmt(v))
  const milestones = (s.milestones ?? []).filter(m => m.month === change.month && m.celebrated).sort((a, b) => Number(b.headline) - Number(a.headline))
  return ['', t('familyTelegram.bot.summaryChange', { month: monthTitle(t, change.month), change: sign(change.end - change.start) }),
    changeText(t, change, signedFmt), ...milestones.map(m => milestoneText(t, m, v => fmt(v)))].join('\n')
}
