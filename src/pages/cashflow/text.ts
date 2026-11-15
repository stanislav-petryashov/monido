// The page's worded figures: the period's name and the finding, shared by the page and the title row
import { useTranslation } from 'react-i18next'
import type { FindingPart } from '../../domain/cashflowPeriod'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth, fmtPct } from '../../lib/formatters'
import { signed } from '../../lib/pageHelpers'

/** "July – September 2026", "September 2025 – September 2026", "September 2026" */
export function periodLabel(t: (key: string, params?: Record<string, unknown>) => string, months: string[]): string {
  const from = months[0], to = months[months.length - 1]
  if (!from || from === to) return from ? fmtMonth(from) : ''
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  return t('cashflowPage.period.range', { from: sameYear ? t(`dates.month.${Number(from.slice(5, 7))}`) : fmtMonth(from), to: fmtMonth(to) })
}

/** The params the domain gives as numbers, worded: amounts in money (masked in privacy mode), rates in percent */
const MONEY = ['net', 'amount']
const RATES = ['rate', 'usualRate']

/** A finding's sentences as one line of text */
export function useFindingText(parts: FindingPart[], months: string[]): string {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const label = periodLabel(t, months)
  const period = label.charAt(0).toLocaleUpperCase() + label.slice(1)
  return parts.map(p => t(p.key, Object.fromEntries([...Object.entries(p.params).map(([k, v]) => [k,
    typeof v !== 'number' ? v : MONEY.includes(k) ? fmt(v) : RATES.includes(k) ? fmtPct(v) : k === 'delta' ? signed(v, fmt) : v]), ['period', period]]))).join(' ')
}

