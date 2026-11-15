import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Freshness } from '../../components/layout/Freshness'
import type { LoanRow } from '../../domain/loans'
import { isoDate, monthOf } from '../../domain/dates'
import { fmtCurrency, fmtDayNumeric, fmtPct } from '../../lib/formatters'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import { useSnapshot } from '../../lib/useFinanceData'
import { tableQuery } from '../../pages/admin/adminQuery'
import { familyTotals, loanItems, withRowid, type StoredPayment } from '../../pages/admin/loans/figures'

/**
 * «N loans · owed on <today> · paid a month, % of the closed month's income»: the family totals of the open loans
 * (familyTotals), the share the snapshot's health gives (`debt_payment_ratio`). Freshness until there is an open loan.
 */
export function LoansSubtitleBody() {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const loans = useQuery(tableQuery<LoanRow>('loans')).data?.rows
  const payments = useQuery(tableQuery<StoredPayment>('loan_early_payments')).data?.rows
  const snapshot = useSnapshot().data
  const today = new Date()
  const totals = useMemo(() => (loans && payments ? familyTotals(loanItems(loans, withRowid(payments)), snapshot, new Date()) : null), [loans, payments, snapshot])
  if (!totals || totals.count === 0) return <Freshness />
  const money = (v: number | null) => (hidden ? PRIVACY_MASK : v === null || totals.currency === null ? '—' : fmtCurrency(v, totals.currency))
  const share = snapshot?.health?.metrics.debt_payment_ratio?.value
  const month = snapshot?.capital ? monthOf(snapshot.capital.date) : null
  return <>{t('modules.loans.subtitle', { count: totals.count, total: money(totals.balance), date: fmtDayNumeric(isoDate(today)), payment: money(totals.payment) })}
    {share != null && month && t('modules.loans.subtitleShare', { share: fmtPct(share), month: t(`dates.monthOf.${Number(month.slice(5, 7))}`) })}</>
}
