// Family-wide settings (UI language, display currency, income and expenses tracking) kept in app_settings; every device reads the same values.
import type { Database, PreparedStatement } from './db'
import { projectCurrencies, readFamilyCurrency } from './familyCurrency'
import { readTrackFlows } from './data'
import { InputError, plainObject, type Actor } from './http'
import { logStatement, nextRowid, tableColumns, type Column } from './rows'
import { isLanguage, languageOr } from '../i18n/languages'
import type { FamilySettings } from '../domain/api'

import { isDateFormat } from '../domain/dateFormat'

export { projectCurrencies }

async function stored(db: Database, key: string): Promise<string | undefined> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value
}

/** The stored settings; a missing or invalid value falls back (English; the currency through `pickCurrency`). */
export async function readFamilySettings(db: Database): Promise<FamilySettings> {
  const [language, currency, trackFlows] = await Promise.all([stored(db, 'language'), readFamilyCurrency(db), readTrackFlows(db)])
  const dateFormat = await stored(db, 'date_format')
  return { language: languageOr(language), currency, trackFlows, dateFormat: isDateFormat(dateFormat) ? dateFormat : 'dmy' }
}

/**
 * The statements that set the app_settings row `key` to `value` and journal it (an update or an insert with an explicit rowid, the
 * before-image {key, value}); null when the row already holds `value`. `taken`: rowids this caller's earlier inserts of the same batch will use.
 */
export async function upsertSetting(
  db: Database, actor: Actor, key: string, value: string, { columns, ts = new Date().toISOString(), taken = 0 }: { columns?: Column[]; ts?: string; taken?: number } = {},
): Promise<{ statements: PreparedStatement[]; inserted: boolean } | null> {
  const before = await db.prepare('SELECT rowid, key, value FROM app_settings WHERE key = ?').bind(key).first<{ rowid: number; key: string; value: string }>()
  if (before?.value === value) return null
  const afterColumns = columns ?? await tableColumns(db, 'app_settings')
  const rowid = before ? Number(before.rowid) : await nextRowid(db, 'app_settings') + taken
  return {
    inserted: !before,
    statements: [
      before
        ? db.prepare('UPDATE app_settings SET value = ? WHERE rowid = ?').bind(value, rowid)
        : db.prepare('INSERT INTO app_settings (rowid, key, value) VALUES (?, ?, ?)').bind(rowid, key, value),
      logStatement(db, actor, {
        table: 'app_settings', rowid, op: before ? 'update' : 'insert', ts, afterColumns,
        before: before ? { key: before.key, value: before.value } : null,
      }),
    ],
  }
}

/** Saves the given keys, each with a change_log entry (so the journal shows and can revert it); returns the settings after. */
export async function saveFamilySetting(db: Database, patch: Partial<FamilySettings>, actor: Actor): Promise<FamilySettings> {
  plainObject(patch)
  if (patch.dateFormat !== undefined && !isDateFormat(patch.dateFormat)) throw new InputError('invalid_value', 400, { column: 'dateFormat' })
  if (patch.language !== undefined && !isLanguage(patch.language)) throw new InputError('invalid_language', 400)
  if (patch.currency !== undefined && !(typeof patch.currency === 'string' && (await projectCurrencies(db)).includes(patch.currency))) {
    throw new InputError('unknown_currency', 400)
  }
  if (patch.trackFlows !== undefined && typeof patch.trackFlows !== 'boolean') throw new InputError('invalid_value', 400, { column: 'trackFlows' })
  const columns = await tableColumns(db, 'app_settings')
  const ts = new Date().toISOString()
  const statements: PreparedStatement[] = []
  let inserts = 0
  const values: [string, string | undefined][] = [
    ['language', patch.language], ['currency', patch.currency], ['date_format', patch.dateFormat],
    ['track_flows', patch.trackFlows === undefined ? undefined : patch.trackFlows ? '1' : '0'],
  ]
  for (const [key, value] of values) {
    if (value === undefined) continue
    const write = await upsertSetting(db, actor, key, value, { columns, ts, taken: inserts })
    if (!write) continue
    statements.push(...write.statements)
    if (write.inserted) inserts++
  }
  if (statements.length > 0) await db.batch(statements)
  return readFamilySettings(db)
}
