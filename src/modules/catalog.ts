// The module catalog: every module's facts in MODULE_KEYS order. Pure — read by the server and the browser.
import { advisorMeta } from './advisor/meta'
import { cashflowMeta } from './cashflow/meta'
import { claudePromptsMeta } from './claude-prompts/meta'
import { goalsMeta } from './goals/meta'
import { healthMeta } from './health/meta'
import { loansMeta } from './loans/meta'
import { realEstateMeta } from './real-estate/meta'
import { remindersMeta } from './reminders/meta'
import type { ModuleKey, ModuleMeta } from './types'

export const MODULES: readonly ModuleMeta[] = [
  cashflowMeta, loansMeta, realEstateMeta, goalsMeta, healthMeta, claudePromptsMeta, advisorMeta, remindersMeta,
]

export function moduleMeta(key: ModuleKey): ModuleMeta {
  return MODULES.find(m => m.key === key)!
}

/** The module a table belongs to; null for a core table. */
export function tableOwner(table: string): ModuleMeta | null {
  return MODULES.find(m => m.tables.includes(table)) ?? null
}
