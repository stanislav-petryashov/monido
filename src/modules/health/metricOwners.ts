import type { HealthKey } from '../../domain/types'

/**
 * The page that owns each metric's trend and detail, with the section that shows it (`#id`):
 * a Financial health card links there.
 * null — Financial health is the owner itself (the emergency fund).
 */
export const METRIC_OWNER: Record<HealthKey, string | null> = {
  savings_rate: '/cashflow',
  fi_rate: '/cashflow#income',
  income_diversification: '/cashflow#income',
  debt_to_asset: '/loans',
  avg_debt_rate: '/loans',
  consumer_debt_months: '/loans',
  debt_payment_ratio: '/loans',
  real_growth_yoy: '/assets#history',
  emergency_months: null,
}
