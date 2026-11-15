import type { ModuleMeta } from '../types'

export const cashflowMeta: ModuleMeta = {
  key: 'cashflow',
  tables: ['monthly_cashflow', 'category_spending', 'flow_lines', 'spending_categories', 'manual_mandatory_spending'],
}
