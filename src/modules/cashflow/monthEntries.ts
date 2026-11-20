// The cashflow module's own entries of a month: category lines of an account (flow_lines) or spending by category
// (category_spending). Either means the family recorded what the month's income and expenses were made of.
import type { MonthEntries } from '../monthEntries'

export const cashflowMonthEntries: MonthEntries = async (month, { db }) => {
  const like = `${month}-%`
  return (await db.prepare('SELECT 1 FROM flow_lines WHERE date LIKE ? UNION ALL SELECT 1 FROM category_spending WHERE date LIKE ? LIMIT 1').bind(like, like).first()) != null
}
