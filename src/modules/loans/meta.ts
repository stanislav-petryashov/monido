import { MAX_TERM_MONTHS } from '../../domain/loans'
import type { ModuleMeta } from '../types'

export const loansMeta: ModuleMeta = {
  key: 'loans',
  tables: ['loans', 'loan_early_payments', 'loan_payments'],
  limits: { loans: { term_months: MAX_TERM_MONTHS } },
}
