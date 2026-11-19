// Writes the fictional family of src/demo/family.ts into an open, initialized database (seed script, screenshots, demo server).
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { transaction } from '../db'
import type { DemoFamily } from '../../demo/family'
import { clearFamilyTables } from '../tables'

/** The table each field of the family goes to. */
const TABLES: Record<keyof DemoFamily, string> = {
  members: 'members',
  users: 'users',
  currencies: 'currencies',
  assets: 'assets',
  accountTransfers: 'account_transfers',
  cashflow: 'monthly_cashflow',
  loans: 'loans',
  loanEarlyPayments: 'loan_early_payments',
  realEstate: 'real_estate',
  goals: 'goals',
  parameters: 'parameters',
  closedMonths: 'closed_months',
  fxRates: 'fx_rates',
  loanPayments: 'loan_payments',
  // before categorySpending: its foreign key
  spendingCategories: 'spending_categories',
  categorySpending: 'category_spending',
  // after the cash-flow rows and the categories it allocates and refers to
  flowLines: 'flow_lines',
}

/** What the load and the seed keep: legacy schema bookkeeping, every family setting (including auth_* rows), the reminder and council settings. */
export const LOAD_KEEP = ['schema_migrations', 'app_settings', 'reminder_settings', 'advisor_settings'] as const

/**
 * Inserts the rows of `family` into the open transaction of `sqlite`; the tables are expected empty.
 */
export function insertFamily(sqlite: DatabaseSync, family: DemoFamily): void {
  for (const [field, table] of Object.entries(TABLES) as [keyof DemoFamily, string][]) {
    for (const row of family[field]) {
      const columns = Object.keys(row)
      const values = Object.values(row) as SQLInputValue[]
      sqlite.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values)
    }
  }
}

/**
 * Replaces every financial table of the initialized database `db` with `family`, in one transaction.
 * Everything but LOAD_KEEP is emptied first; the setup is marked done and income and expenses are tracked.
 */
export function writeFamily(db: DatabaseSync, family: DemoFamily): void {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'app_settings'").get()) {
    throw new Error('Database is not initialized. Start the server once (npm run dev) and retry.')
  }
  transaction(db, () => {
    clearFamilyTables(db, LOAD_KEEP)
    insertFamily(db, family)
    db.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('setup_state', 'done')")
    // the fictional family has income and expenses: tracking is on, whatever the family had
    db.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '1')")
  }, { immediate: false })
}
