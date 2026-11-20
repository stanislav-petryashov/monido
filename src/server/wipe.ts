// Delete all family data: Settings → Data → "Danger zone" (POST /api/wipe). The app opens afterwards as a fresh install
// that runs the first-run wizard again (the setup flag is cleared), still speaks the family language, keeps its currency, its Telegram link, the advisor's council settings, the downloaded rates and the users (with the members they point to).
// The advisor connector's OAuth clients and tokens are not kept: a wipe disconnects Claude for everyone.
import { transaction, type SqliteDatabase } from './db'
import { readFamilySettings } from './familySettings'
import type { Actor } from './http'
import { CHANGE_LOG_INSERT } from './rows'
import { clearFamilyTables } from './tables'

/**
 * The tables a wipe leaves as they are: the migration bookkeeping, the family settings (language, currency; the setup flag is deleted from them, so the wizard runs again), the reminder
 * settings (the Telegram link), the advisor's council settings (a fresh install has that row; the proposals go), the cache of downloaded market rates and the users with their rights
 * (the members they point to stay too). The setup view leaves them out of its hasData too (setup.ts).
 */
export const WIPE_KEEP = ['schema_migrations', 'app_settings', 'reminder_settings', 'advisor_settings', 'fx_rates', 'users', 'family_telegram_groups', 'user_identities'] as const

/**
 * Empties every table of `main` but WIPE_KEEP and SQLite's own, keeping the `currencies` row of the family currency (the
 * snapshot is drawn in it; its inflation flag is cleared, as the inflation figure goes with `parameters`), and journals the wipe (op 'wipe', table_name '*', row_id 0) — the journal it empties starts
 * again with that one entry, which cannot be reverted. One transaction: any failure leaves every table as it was.
 */
export async function wipeFamilyData(db: SqliteDatabase, actor: Actor, now: Date): Promise<void> {
  const { currency } = await readFamilySettings(db)
  const { sqlite } = db
  // from BEGIN to COMMIT nothing awaits: no other request on this connection gets inside the transaction
  transaction(sqlite, () => {
    clearFamilyTables(sqlite, WIPE_KEEP, { keepCurrency: currency })
    // the wizard runs again on the empty install; the other family settings stay
    sqlite.exec("DELETE FROM main.app_settings WHERE key = 'setup_state'")
    sqlite.prepare(`${CHANGE_LOG_INSERT} VALUES (?, ?, ?, '*', 0, 'wipe', NULL, NULL, NULL)`).run(now.toISOString(), actor.name, actor.source)
    sqlite.exec('UPDATE main.family_telegram_groups SET proposal_cursor = (SELECT COALESCE(MAX(id), 0) FROM main.change_log)')
  })
}
