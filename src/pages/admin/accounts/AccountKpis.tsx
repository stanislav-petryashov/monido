import { RecordKpis } from '../../../components/cards/RecordKpis'
import { useTranslation } from 'react-i18next'
import type { AccountStats } from '../../../domain/accountStats'
import { shiftMonth } from '../../../domain/dates'
import { fmtDayYear, fmtMonth, fmtPct } from '../../../lib/formatters'
import { signed } from '../../../lib/pageHelpers'
import { useMoney } from '../../../lib/privacy'

interface AccountKpisProps {
  stats: AccountStats
  /** The month the figures are of: the last closed one */
  month: string
  /** The account's currency */
  currency: string
  /**
   * The snapshot's side: the account's value in its currency (null — the account is not in it, or has no rate), the
   * snapshot's currency, its assets and the date of its rates
   */
  base: { valueBase: number | null; currency: string; assets: number; date: string } | null
}

/**
 * The KPI strip under the account's head: the balance at the month end (a foreign account also in the snapshot's
 * currency at its rate), the change over the month and over the year with % against the month compared, the share of
 * the assets. Every amount is masked in privacy mode.
 */
export function AccountKpis({ stats, month, currency, base }: AccountKpisProps) {
  const { t } = useTranslation()
  const masked = useMoney()
  const money = (v: number, cur = currency) => masked(v, cur)
  const since = (pct: number | null, ago: number) => {
    if (pct === null) return null
    const then = shiftMonth(month, -ago)
    return t('pages.accounts.kpi.since', { pct: fmtPct(pct, { sign: true }), month: t(`dates.monthOf.${Number(then.slice(5))}`), year: then.slice(0, 4) })
  }
  const change = (v: number | null) => (v === null ? '—' : signed(v, money))
  const foreign = base !== null && base.valueBase !== null && base.currency !== currency
  const cells = [
    {
      key: 'balance', label: t('pages.accounts.kpi.balance', { month: fmtMonth(month) }),
      value: stats.last === null ? '—' : money(stats.last),
      meta: foreign ? t('pages.accounts.kpi.atRate', { amount: money(base.valueBase!, base.currency), date: fmtDayYear(base.date) }) : t('pages.accounts.kpi.monthEnd'),
    },
    { key: 'month', label: t('pages.accounts.kpi.month'), value: change(stats.monthChange), meta: since(stats.monthPct, 1) },
    { key: 'year', label: t('pages.accounts.kpi.year'), value: change(stats.yearChange), meta: since(stats.yearPct, 12) },
    {
      key: 'share', label: t('pages.accounts.kpi.share'),
      value: base?.valueBase != null && base.assets > 0 ? fmtPct((base.valueBase / base.assets) * 100) : '—',
      meta: base && base.assets > 0 ? t('pages.accounts.kpi.ofAssets', { total: money(base.assets, base.currency) }) : null,
    },
  ]
  return (
    <RecordKpis label={t('pages.accounts.kpi.figures')} cells={cells} />
  )
}
