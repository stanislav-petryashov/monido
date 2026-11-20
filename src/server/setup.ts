// The first-run setup flag (app_settings.setup_state) and what the wizard needs to know about the data.
import type { Database } from './db'
import { InputError, type Actor } from './http'
import { upsertSetting } from './familySettings'
import { openMonths, parseDraft } from '../domain/monthClose'
import type { SetupState, SetupView } from '../domain/api'
import { familyTables, NOT_RESERVED_CATEGORY, quoteIdent } from './tables'
import { WIPE_KEEP } from './wipe'

const KEY = 'setup_state'

/**
 * The tables the wipe and the test-data load both empty that are still not the family's records: the reference lists a fresh
 * install or the wizard's own steps fill (currencies, members, parameters), the journal of those writes and the advisor
 * connector's sign-ins. With WIPE_KEEP (the settings, downloaded rates and users) they are left out of hasData.
 */
const NOT_DATA = ['currencies', 'members', 'parameters', 'change_log', 'oauth_clients', 'oauth_tokens', 'month_draft_revisions', 'family_telegram_pairing', 'family_telegram_reminder_delivery', 'identity_invites'] as const

/**
 * Whether any table the test-data load would empty holds a family record: every ordinary table of the schema (as the load
 * and the wipe list them) but SQLite's own, WIPE_KEEP and NOT_DATA; the reserved loan_payment category does not count, as a
 * fresh install has it. The names come from the schema, never from a request.
 */
async function anyFamilyData(db: Database): Promise<boolean> {
  const skip = new Set<string>([...WIPE_KEEP, ...NOT_DATA])
  const tables = familyTables((await db.prepare('PRAGMA main.table_list').all<{ name: string; type: string }>()).results, skip)
  if (tables.length === 0) return false
  const probes = tables.map(t => `EXISTS (SELECT 1 FROM main.${quoteIdent(t)}${t === 'spending_categories' ? ` WHERE ${NOT_RESERVED_CATEGORY}` : ''})`)
  const row = await db.prepare(`SELECT (${probes.join(' OR ')}) AS n`).first<{ n: number }>()
  return Number(row?.n ?? 0) === 1
}

/** The stored flag; absent or any other value is 'pending'. */
export async function readSetupState(db: Database): Promise<SetupState> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(KEY).first<{ value: string }>()
  return row?.value === 'done' || row?.value === 'skipped' ? row.value : 'pending'
}

/** Writes 'done' or 'skipped' (anything else is 400 invalid_value) with one change_log entry, only when it differs. */
export async function saveSetupState(db: Database, state: unknown, actor: Actor): Promise<SetupView> {
  if (state !== 'done' && state !== 'skipped') throw new InputError('invalid_value', 400, { column: 'state' })
  const write = await upsertSetting(db, actor, KEY, state)
  if (write) await db.batch(write.statements)
  return setupView(db, new Date())
}

/**
 * The flag with two facts about the data: any family record the test-data load would replace (anyFamilyData: closed months
 * and month drafts included, so hasAccounts implies hasData); any account (an asset, or a row in the first open month's draft).
 */
export async function setupView(db: Database, now: Date): Promise<SetupView> {
  const state = await readSetupState(db)
  const [hasData, asset, closedMonths] = await Promise.all([
    anyFamilyData(db),
    db.prepare('SELECT 1 AS n FROM assets LIMIT 1').first(),
    db.prepare('SELECT month FROM closed_months').all<{ month: string }>(),
  ])
  let hasAccounts = asset !== null
  if (!hasAccounts) {
    const month = openMonths(closedMonths.results.map(r => String(r.month)), now)[0]
    const draft = month === undefined ? null : await db.prepare('SELECT payload FROM month_drafts WHERE month = ?').bind(month).first<{ payload: string }>()
    if (draft) {
      try { hasAccounts = parseDraft(JSON.parse(draft.payload)).rows.length > 0 } catch { /* an unreadable draft has no accounts */ }
    }
  }
  return { state, hasData, hasAccounts }
}
