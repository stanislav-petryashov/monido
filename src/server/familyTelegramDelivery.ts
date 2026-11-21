import { errorType, logEvent } from './log'
import type { Database } from './db'
import type { ModuleEnv } from './config'
import { isBlocked } from './bot/telegram'
import { sendToFamilyChat } from './familyTelegram'
import { familyT } from './bot/texts'

/** Uses journaled proposal events; groups get a read-only notice, never another person's vote buttons. */
export async function deliverGroupProposals(db: Database, env: ModuleEnv, fetchImpl?: typeof fetch): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return
  const { results: groups } = await db.prepare('SELECT chat_id, proposal_cursor FROM family_telegram_groups WHERE proposals = 1').all<{ chat_id: string; proposal_cursor: number }>()
  if (!groups.length) return
  const { t } = await familyT(db)
  for (const group of groups) {
    // one notice per proposal, with its status now: several journal rows of one proposal (a vote, a deadline, the
    // decision) would otherwise repeat the same line; the cursor moves to its newest row
    const { results: events } = await db.prepare(`SELECT MAX(c.id) AS id, p.id AS proposal_id, p.status, v.title FROM change_log c
      JOIN proposals p ON p.id = c.row_id JOIN proposal_versions v ON v.proposal_id = p.id AND v.number = p.version
      WHERE c.table_name = 'proposals' AND c.id > ? GROUP BY p.id ORDER BY MAX(c.id) LIMIT 50`).bind(group.proposal_cursor).all<{ id: number; proposal_id: number; status: string; title: string }>()
    let chatId = group.chat_id
    for (const event of events) {
      // Recheck opt-out and disconnection before each queued event.
      if (!await db.prepare('SELECT 1 FROM family_telegram_groups WHERE chat_id = ? AND proposals = 1').bind(chatId).first()) break
      try {
        const link = env.APP_URL ? `${env.APP_URL.replace(/\/$/, '')}/advisor` : ''
        chatId = await sendToFamilyChat(db, env.TELEGRAM_BOT_TOKEN, chatId, t('familyTelegram.bot.proposal', { title: event.title, status: t(`familyTelegram.bot.status.${event.status}`), link }), fetchImpl)
        await db.prepare('UPDATE family_telegram_groups SET proposal_cursor = ? WHERE chat_id = ? AND proposals = 1').bind(event.id, chatId).run()
      } catch (err) {
        // the bot was removed from the group (or the chat is gone): its notices stop, rather than every run trying
        // again and posting the whole backlog once the bot is back
        if (isBlocked(err)) await db.prepare('UPDATE family_telegram_groups SET proposals = 0 WHERE chat_id = ?').bind(chatId).run()
        // No token-bearing error text; the next delivery run retries from the stored cursor.
        logEvent('ERROR', 'monido.telegram.proposal_delivery_failed', 'Telegram group proposal delivery failed', { 'error.type': errorType(err) })
        break
      }
    }
  }
}
