import { Disclosure } from '../ui/Disclosure'
import { usePrivacy } from '../../lib/privacy'
import { WarningsBanner } from '../WarningsBanner'
import { isDistorting } from '../../lib/snapshotSelectors'
import { useTranslation } from 'react-i18next'
import type { FinanceSnapshot } from '../../domain/types'
import { fmtMonth } from '../../lib/formatters'
import { QuestionPanel } from './QuestionPanel'
import { Link } from '../ui/Link'

/** Compact questions reuse the snapshot; detailed calculations remain on their owning page. */
export function FinancialAnswers({ snapshot, page }: { snapshot: FinanceSnapshot; page: 'overview' | 'goals' | 'health' }) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  // which month: the closed one; its totals (`cashflow.closedMonth`) are null when a row has no rate
  const month = snapshot.asOf.closedMonth ?? undefined
  const income = snapshot.income.months.find(m => m.month === month)
  const expenses = snapshot.spending.months.find(m => m.month === month)
  const total = snapshot.cashflow.closedMonth
  const unallocatedIncome = income?.unallocatedBase ?? (income ? null : total?.income ?? null)
  const unallocatedExpense = expenses?.unallocatedBase ?? (expenses ? null : total?.expense ?? null)
  if (page === 'overview') {
    const warnings = snapshot.warnings.filter(w => !isDistorting(w) && w.code !== 'short_history')
    const needsAllocation = snapshot.trackFlows && ((unallocatedIncome ?? 0) > 0 || (unallocatedExpense ?? 0) > 0)
    if (!warnings.length && !needsAllocation) return null
    return <section id="data-quality" className="overview-data-quality">
      {hidden ? (warnings.length > 0 && <p className="note">{t('common.dataWarnings', { value: warnings.length })}</p>) : <WarningsBanner warnings={warnings} />}
      {needsAllocation && <p className="note">{month ? t('financialQuestions.recordedOptional', { month: fmtMonth(month) }) : t('financialQuestions.categoriesOptional')}{' '}
        <Link className="link-accent" to={month ? `/cashflow/categories?month=${month}` : "/cashflow/categories"}>{t('financialQuestions.categoriesLink')}</Link>
      </p>}
    </section>
  }
  return <QuestionPanel id="financial-answers"
    question={page === 'goals' ? t('financialQuestions.goalsQuestion') : undefined}
    answer={page === 'goals' ? (!snapshot.trackFlows || !month ? t('financialQuestions.goalsUnknown') : t('financialQuestions.goalsAnswer', { count: snapshot.goals.plan.allocations.filter(a => a.status === 'at_risk' || a.status === 'unreachable').length })) : undefined}>
    {page === 'goals' && <p className="note note--help">{t('financialQuestions.goalsNote')} <Link className="link-accent" to="/available-money">{t('financialQuestions.reserveLink')}</Link></p>}
    <Disclosure variant="inline" title={t('ux.calculationDetails')}>
      {page === 'health' && <p className="note note--help">{t('financialQuestions.healthNote')}</p>}
      <p className="note note--help">{t('financialQuestions.qualityNote', { capital: snapshot.asOf.capitalDate ? fmtMonth(snapshot.asOf.capitalDate.slice(0, 7)) : '—', flow: month ? fmtMonth(month) : '—' })}</p>
      <div className="financial-links">
        <Link className="link-accent" to="/available-money">{t('financialQuestions.reserveLink')}</Link>
        {snapshot.trackFlows && <Link className="link-accent" to="/cashflow#forecast">{t('financialQuestions.forecastLink')}</Link>}
      </div>
    </Disclosure>
  </QuestionPanel>
}
