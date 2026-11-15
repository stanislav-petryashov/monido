// The one table-clearing loop: the wipe and the load/seed of the demo family both empty the family's tables with it.
import type { DatabaseSync } from 'node:sqlite'

/** An SQL identifier, quoted (the names come from the schema, never from a request). */
export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`

/** The predicate of every row of `spending_categories` but the reserved loan_payment category (not family data: a fresh install has it). */
export const NOT_RESERVED_CATEGORY = "kind <> 'loan_payment'"

/** The ordinary tables of a `PRAGMA table_list` answer but SQLite's own and `skip`, sorted. */
export function familyTables(listed: readonly Record<string, unknown>[], skip: ReadonlySet<string>): string[] {
  return listed
    .filter(r => r.type === 'table')
    .map(r => String(r.name))
    .filter(t => !/^sqlite_/.test(t) && !skip.has(t))
    .sort()
}

/**
 * Empties every ordinary table of `main` but `keep` and SQLite's own, inside the caller's open transaction. The reserved
 * loan_payment category always stays; with `users` kept, their members stay; with `keepCurrency`, that currencies row stays
 * with inflation = 0. Returns the tables emptied, sorted.
 */
export function clearFamilyTables(sqlite: DatabaseSync, keep: readonly string[], opts: { keepCurrency?: string } = {}): string[] {
  const kept = new Set<string>(keep)
  const tables = familyTables(sqlite.prepare('PRAGMA main.table_list').all(), kept)
  // a foreign key is checked once, at COMMIT, whatever order the tables are emptied in
  sqlite.exec('PRAGMA defer_foreign_keys = ON')
  for (const table of tables) {
    if (table === 'members' && kept.has('users')) sqlite.exec('DELETE FROM main.members WHERE name NOT IN (SELECT member FROM main.users)')
    // the reserved loan_payments category is not family data: a fresh install has it
    else if (table === 'spending_categories') sqlite.exec(`DELETE FROM main.spending_categories WHERE ${NOT_RESERVED_CATEGORY}`)
    else if (table === 'currencies' && opts.keepCurrency !== undefined) sqlite.prepare('DELETE FROM main.currencies WHERE code IS NOT ?').run(opts.keepCurrency)
    else sqlite.exec(`DELETE FROM main.${quoteIdent(table)}`)
  }
  // the inflation figure goes with `parameters`: the kept currency carries no inflation flag, as on a fresh install
  if (opts.keepCurrency !== undefined && tables.includes('currencies')) sqlite.exec('UPDATE main.currencies SET inflation = 0')
  return tables
}
