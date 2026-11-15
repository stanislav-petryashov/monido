import type { Database } from './db'
import type { ModuleEnv } from './config'
import { sendMessage } from './bot/telegram'
import { familyT } from './bot/texts'

/** Uses journaled proposal events; groups get a read-only notice, never another person's vote buttons. */
export async function deliverGroupProposals(db: Database, env: ModuleEnv, fetchImpl?: typeof fetch): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return
  const { results: groups } = await db.prepare('SELECT chat_id, proposal_cursor FROM family_telegram_groups WHERE proposals = 1').all<{ chat_id: string; proposal_cursor: number }>()
  if (!groups.length) return
  const { t } = await familyT(db)
  for (const group of groups) {
    const { results: events } = await db.prepare(`SELECT c.id, p.id AS proposal_id, p.status, v.title FROM change_log c
      JOIN proposals p ON p.id = c.row_id JOIN proposal_versions v ON v.proposal_id = p.id AND v.number = p.version
      WHERE c.table_name = 'proposals' AND c.id > ? ORDER BY c.id LIMIT 50`).bind(group.proposal_cursor).all<{ id: number; proposal_id: number; status: string; title: string }>()
    for (const event of events) {
      // Recheck opt-out and disconnection before each queued event.
      if (!await db.prepare('SELECT 1 FROM family_telegram_groups WHERE chat_id = ? AND proposals = 1').bind(group.chat_id).first()) break
      try {
        const link = env.APP_URL ? `${env.APP_URL.replace(/\/$/, '')}/advisor` : ''
        await sendMessage(env.TELEGRAM_BOT_TOKEN, group.chat_id, t('familyTelegram.bot.proposal', { title: event.title, status: t(`familyTelegram.bot.status.${event.status}`), link }), fetchImpl)
        await db.prepare('UPDATE family_telegram_groups SET proposal_cursor = ? WHERE chat_id = ? AND proposals = 1').bind(event.id, group.chat_id).run()
      } catch {
        // No token-bearing error text; the next delivery run retries from the stored cursor.
        console.error('[bot] group proposal delivery failed')
        break
      }
    }
  }
}
