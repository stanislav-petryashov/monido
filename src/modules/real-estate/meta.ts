import type { ModuleMeta } from '../types'

export const realEstateMeta: ModuleMeta = {
  key: 'real_estate',
  tables: ['real_estate'],
  // a typed 20255 would draw a chart of eighteen thousand years; the oldest year is the row check's (rowCheck.ts)
  limits: { real_estate: { valuation_year: 2100 } },
}
