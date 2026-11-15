import { ProgressTrack } from '../../../../components/ui/ProgressTrack'
import { RecordKpis } from '../../../../components/cards/RecordKpis'
import { useTranslation } from 'react-i18next'
import { repaidShare, type EarlyPaymentsEffect, type ScheduleSummary } from '../../../../domain/loans'
import { fmtDayNumeric, fmtMonths, fmtPct } from '../../../../lib/formatters'
import { useMoney } from '../../../../lib/privacy'
import { useCents } from './money'

interface LoanKpisProps {
  currency: string
  principal: number
  /** Owed today (balanceToday); for a loan not issued yet its principal */
  balance: number
  notIssued: boolean
  /** Repaid — by its schedule or closed: the strip answers what it cost */
  repaidOn: string | null
  repaid: boolean
  /** Today, 'YYYY-MM-DD' */
  today: string
  /** The installment the balance is after; null — none yet */
  paidOn: string | null
  /** The loan's balance in the closed month's capital; null — none */
  capital: { month: string; balance: number } | null
  /** The next installment; null — none left */
  next: { date: string; payment: number; interest: number } | null
  summary: ScheduleSummary
  /** What the early payments did; null — none */
  effect: EarlyPaymentsEffect | null
  /** The early payments: how many and their sum */
  early: { count: number; total: number }
}

/**
 * The KPI strip under the loan's head — the balance today, the monthly payment with its interest, the last payment with
 * the payments left, the interest ahead with the total to pay; for a repaid loan the balance 0, the total paid and how
 * much earlier it was repaid — then the share repaid as a violet progress, the early payments' effect in neutral text
 * and the schedule's disclaimer.
 */
export function LoanKpis({ currency, principal, balance, notIssued, repaidOn, repaid, today, paidOn, capital, next, summary, effect, early }: LoanKpisProps) {
  const { t } = useTranslation()
  const masked = useMoney()
  const cents = useCents()
  const money = (v: number) => masked(v, currency)
  const month = (ym: string) => t(`dates.monthOf.${Number(ym.slice(5, 7))}`)
  const owed = repaid ? 0 : balance
  const share = repaidShare(owed, principal) ?? 0
  const cells = repaid ? [
    { key: 'balance', label: t('data.loans.kpi.balance'), value: money(0), meta: repaidOn ? t('data.loans.kpi.repaidOn', { date: fmtDayNumeric(repaidOn) }) : null },
    { key: 'payment', label: t('data.loans.kpi.paymentNone'), value: '—', meta: t('data.loans.kpi.noneLeft') },
    { key: 'paid', label: t('data.loans.kpi.totalPaid'), value: money(summary.totalPaid), meta: t('data.loans.kpi.ofInterest', { amount: money(summary.overpayment) }) },
    effect
      ? { key: 'earlier', label: t('data.loans.kpi.earlier'), value: fmtMonths(effect.monthsSaved), meta: t('data.loans.kpi.scheduledUntil', { date: fmtDayNumeric(effect.lastWithout) }) }
      : { key: 'last', label: t('data.loans.kpi.last'), value: fmtDayNumeric(summary.lastPayment), meta: null },
  ] : [
    {
      key: 'balance', label: notIssued ? t('data.loans.balanceAtIssue') : t('data.loans.kpi.balanceOn', { date: fmtDayNumeric(today) }), value: money(balance),
      meta: [paidOn && t('data.loans.kpi.afterPayment', { date: fmtDayNumeric(paidOn) }), capital && t('data.loans.kpi.inCapital', { month: month(capital.month), amount: money(capital.balance) })].filter(Boolean).join(' · ') || null,
    },
    {
      key: 'payment', label: t('data.loans.kpi.payment'), value: next ? cents(next.payment, currency) : '—',
      meta: next ? t('data.loans.kpi.paymentMeta', { date: fmtDayNumeric(next.date), interest: cents(next.interest, currency) }) : null,
    },
    { key: 'last', label: t('data.loans.kpi.last'), value: fmtDayNumeric(summary.lastPayment), meta: t('data.loans.kpi.left', { count: summary.paymentsLeft }) },
    { key: 'interest', label: t('data.loans.kpi.interest'), value: money(summary.interestLeft), meta: t('data.loans.kpi.toPay', { amount: money(summary.toPay) }) },
  ]
  return (
    <>
      <RecordKpis label={t('data.loans.kpi.figures')} cells={cells} className="ln-kpis" />
      <div className="ln-progress">
        <div className="progress-label">
          <span>{t('data.loans.kpi.progress', { repaid: money(principal - owed), principal: money(principal) })}</span>
          <b className="num">{fmtPct(share)}</b>
        </div>
        <ProgressTrack pct={share} size="tall" label={t('data.loans.kpi.progressLabel', { share: fmtPct(share) })} />
      </div>
      {effect && !repaid && (
        <p className="ln-effect">
          {t('data.loans.kpi.effect', { count: early.count, total: money(early.total), months: t('data.loans.kpi.months', { count: effect.monthsSaved }), interest: money(effect.interestSaved) })}{' '}
          <span className="ln-effect__mut">{t('data.loans.kpi.without', { date: fmtDayNumeric(effect.lastWithout) })}</span>
        </p>
      )}
      <p className="ln-calc">{t('modules.loans.calculatedNote')}</p>
    </>
  )
}
