// What the change journal may put back. Shared by the server's revert and the journal page's "Revert" button.

/** The Data-section tables: the rows the server writes through /api/admin/:table (src/server/rows.ts) */
export const DATA_TABLES = [
  'assets', 'monthly_cashflow', 'goals', 'parameters', 'real_estate', 'loans',
  'loan_early_payments', 'loan_payments', 'spending_categories', 'category_spending', 'flow_lines', 'manual_mandatory_spending', 'currencies', 'members', 'fx_manual_rates',
] as const

export const isDataTable = (t: string): boolean => (DATA_TABLES as readonly string[]).includes(t)

/**
 * A table whose journal entries can be reverted at all: a Data-section table or app_settings (the family settings). Any
 * other — the users, the advisor's council, an old module switch (`modules`, a table dropped by migration 0030), a
 * module's own settings such as `reminder_settings` — the server refuses (409 `not_revertible`), so the journal page
 * offers no "Revert" for it.
 */
export const isRevertibleTable = (t: string): boolean => isDataTable(t) || t === 'app_settings'

/** app_settings keys of the sign-in settings: never put back from the journal, never copied from a backup. */
export const AUTH_KEY_PREFIX = 'auth_'

/**
 * An app_settings entry of a sign-in setting (an `auth_*` key, read from the row before the change, else after it): the
 * server answers 409 `not_revertible` (putting an old password, mode or token back would be a takeover); no "Revert".
 */
export function isAuthSettingEntry(e: { table_name: string; before_json: string | null; after_json: string | null }): boolean {
  if (e.table_name !== 'app_settings') return false
  let row: unknown
  try { row = JSON.parse(e.before_json ?? e.after_json ?? 'null') } catch { return false }
  const key = row !== null && typeof row === 'object' ? (row as { key?: unknown }).key : undefined
  return typeof key === 'string' && key.startsWith(AUTH_KEY_PREFIX)
}
