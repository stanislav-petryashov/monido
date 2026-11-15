// Shared test-data loader for Settings and the first-run wizard (POST /api/demo-data).
import { buildFamily, demoFamilyLanguage, familyCurrency } from '../demo/family'
import type { DemoDataResult } from '../domain/api'
import { isoDate } from '../domain/dates'
import type { Language } from '../i18n/languages'
import type { SharedPasswordPlan } from './authSettings'
import { transaction, type SqliteDatabase } from './db'
import { insertFamily, LOAD_KEEP } from './demo/writeFamily'
import type { Actor } from './http'
import { CHANGE_LOG_INSERT } from './rows'
import { clearFamilyTables } from './tables'

/**
 * Replaces family data and applies the optional password plan atomically; a null plan preserves open access.
 * On failure all changes roll back, and the caller discards the plan.
 */
export function loadDemoData(db: SqliteDatabase, { language, actor, now, plan }: { language: Language; actor: Actor; now: Date; plan: SharedPasswordPlan | null }): DemoDataResult {
  const familyKey = demoFamilyLanguage(language)
  const family = buildFamily({ today: isoDate(now), family: familyKey })
  const currency = familyCurrency(family)
  const { sqlite } = db
  transaction(sqlite, () => {
    clearFamilyTables(sqlite, LOAD_KEEP)
    insertFamily(sqlite, family)
    const put = sqlite.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
    put.run('language', language)
    put.run('currency', currency)
    put.run('setup_state', 'done')
    // the fictional family has income and expenses: tracking is on, whatever the family had
    put.run('track_flows', '1')
    plan?.apply(sqlite)
    sqlite.prepare(`${CHANGE_LOG_INSERT} VALUES (?, ?, ?, '*', 0, 'demo_data', NULL, ?, NULL)`)
      .run(now.toISOString(), actor.name, actor.source, JSON.stringify({ family: familyKey }))
  })
  return { loaded: true, language, currency }
}
