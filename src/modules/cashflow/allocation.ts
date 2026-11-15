// The Cash flow module's own read of an account's lines for the cap checks of other write paths (the rows API, the
// month close). Domain and the Database type only: no import of ./spending.ts, which imports server/rows.ts and
// server/monthClose.ts — the callers of these checks (an import cycle).
import type { CategoryFlow, CategoryKind, SpendingCategory } from '../../domain/types'
import type { Database } from '../../server/db'

/** The lines of a month (`YYYY-MM`), each with its account and its category. */
export async function linesOfMonth(db: Database, month: string): Promise<{ bank: string; member: string; categoryId: number; amount: number; category: SpendingCategory }[]> {
  const rows = (await db.prepare(`SELECT l.bank, l.member, l.category_id, l.amount, c.name, c.kind, c.flow, c.one_off
    FROM flow_lines l JOIN spending_categories c ON c.id = l.category_id WHERE substr(l.date, 1, 7) = ? ORDER BY l.rowid`).bind(month).all()).results
  return rows.map(r => ({
    bank: String(r.bank), member: String(r.member), categoryId: Number(r.category_id), amount: Number(r.amount),
    category: { id: Number(r.category_id), name: String(r.name), kind: String(r.kind) as CategoryKind, flow: String(r.flow) as CategoryFlow, oneOff: Number(r.one_off) === 1 },
  }))
}
