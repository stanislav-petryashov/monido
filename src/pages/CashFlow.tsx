import { IconArrowLeft } from '@tabler/icons-react'
import { Trans, useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  cashflowPeriodView, categoriesSince, categorySeries, categorySources, unsplitAccounts, type CategoryRow,
} from '../domain/cashflowPeriod'
import { capitalMovements } from '../domain/financialAnalysis'
import { ForecastPanel } from '../components/finance/ForecastPanel'
import { PageError } from '../components/PageError'
import { Disclosure, DisclosureGroup } from '../components/ui/Disclosure'
import { Link } from '../components/ui/Link'
import { PageSkeleton } from '../components/ui/Skeleton'
import { assetRecordPaths } from '../lib/assetRecords'
import { useDashboard } from '../lib/dashboardState'
import { PHONE, useMedia } from '../lib/media'
import { useHashFocus } from '../lib/pageFocus'
import { useMoney } from '../lib/privacy'
import { useCan } from '../lib/rights'
import { useSnapshot } from '../lib/useFinanceData'
import { spendingQuery } from '../modules/cashflow/spendingWrites'
import '../styles/cashflow.css'
import { BandChart } from './cashflow/BandChart'
import { CapitalChange } from './cashflow/CapitalChange'
import { CategoryDetail } from './cashflow/CategoryDetail'
import { ExpensesCard } from './cashflow/ExpensesCard'
import { FlowKpis } from './cashflow/FlowKpis'
import { IncomeCard } from './cashflow/IncomeCard'
import { usePageState } from './cashflow/period'
import { PeriodControl } from './cashflow/PeriodControl'
import { periodLabel } from './cashflow/text'

/** 'YYYY-MM' → "April 2026" in the genitive the coverage lines need ("since April 2026") */
const sinceText = (t: (key: string) => string, ym: string | null) => (ym ? `${t(`dates.monthOf.${Number(ym.slice(5, 7))}`)} ${ym.slice(0, 4)}` : null)

/**
 * Income and expenses over one period the person picks (a month by default, the last closed one): the KPIs against the
 * usual month and the band chart, where the money went by kind and category (a category opens in place, on a phone on
 * its own screen), where it came from and who, what changed in net worth as a waterfall with the records that moved,
 * and the forecast as a closed row. The finding
 * and the "Split" action are in the title row (CashflowTitle.tsx). With tracking off the page is one notice.
 */
export function CashFlow() {
  const { t } = useTranslation()
  const { fmt, fmtCompact } = useDashboard()
  const money = useMoney()
  const canEdit = useCan('edit')
  const compact = useMedia(PHONE)
  const [state, setState] = usePageState()
  const snapshotQuery = useSnapshot()
  const snapshot = snapshotQuery.data
  const records = useQuery({ ...spendingQuery, enabled: !!snapshot?.trackFlows }).data
  useHashFocus(!!snapshot)

  if (snapshotQuery.isLoading) return <PageSkeleton />
  if (snapshotQuery.error || !snapshot) return <PageError onRetry={() => void snapshotQuery.refetch()} retrying={snapshotQuery.isFetching} />
  // the family does not track income and expenses (Settings → General): one quiet notice in place of the page
  if (!snapshot.trackFlows) return (
    <div className="card card--p insight">
      <h2 className="insight__title">{t('pages.cashflow.trackingOff')}</h2>
      <p className="insight__text"><Trans i18nKey="pages.cashflow.trackingOffText" components={{ settings: <Link to="/settings/general" className="link-accent" /> }} /></p>
    </div>
  )

  const view = cashflowPeriodView(snapshot, state.kind, state.month)
  if (!view) return <div className="card card--p"><p className="empty-note">{t('pages.cashflow.empty')}</p></div>

  const name = periodLabel(t, view.months)
  const splitTo = canEdit ? `/cashflow/categories?month=${view.end}` : null
  const pick = (m: string) => setState({ month: m === view.last ? null : m })
  const opened = view.expenses.rows.find(r => r.id === state.category) ?? null
  const titleOf = (r: CategoryRow) => (r.kind === 'loan_payment' ? t('modules.cashflow.spending.loanPayments') : r.name)
  const detail = (r: CategoryRow) => (
    <CategoryDetail row={r} name={titleOf(r)} series={categorySeries(snapshot.spending.months, r.id)} months={view.months} periodName={name}
      sources={records ? categorySources(records, r.id, view.end) : null} members={snapshot.members} editTo={splitTo} fmt={fmt} moneyIn={money} />
  )

  // a phone opens the category on its own screen, the way back to the page above it
  if (compact && opened) return (
    <div className="cf-page">
      <button type="button" className="btn btn--ghost cf-back" onClick={() => setState({ category: null })}>
        <IconArrowLeft size={16} stroke={2} aria-hidden="true" />{t('modules.cashflow.route')}
      </button>
      <section className="card card--p cf-card" aria-labelledby="cf-category">
        <div className="card-hd--row cf-card__head"><h2 className="card-hd" id="cf-category">{titleOf(opened)}</h2><span className="cf-meta">{name}</span></div>
        {detail(opened)}
      </section>
    </div>
  )

  // the records' moves are the closed month's: the snapshot has no per-record balances for earlier months
  const movements = view.months.length === 1 && view.end === view.last ? capitalMovements(snapshot) : null

  return (
    <div className="cf-page">
      <section className="card card--p" aria-label={t('modules.cashflow.route')}>
        <PeriodControl kind={state.kind} end={view.end} months={view.months} all={view.all} last={view.last}
          onKind={kind => setState({ kind, category: null })} onMonth={pick} />
        {view.flows && <FlowKpis flows={view.flows} usual={view.usual} first={view.months[0]} fmt={fmt} />}
        <BandChart months={view.chart} period={view.months} selected={view.end} onPick={pick} fmt={fmt} fmtCompact={fmtCompact} compact={compact} />
      </section>

      <div className="cf-grid">
        <ExpensesCard expenses={view.expenses} flows={view.flows} months={view.months} since={sinceText(t, categoriesSince(snapshot.spending.months))}
          accounts={records && view.months.length === 1 ? unsplitAccounts(records.accounts, view.end) : null}
          splitTo={splitTo} open={opened?.id ?? null} onToggle={id => setState({ category: id })} detail={detail} periodName={name} fmt={fmt} />
        {view.flows && <IncomeCard income={view.income} flows={view.flows} months={view.months} since={sinceText(t, categoriesSince(snapshot.income.months))}
          people={view.members} members={snapshot.members} splitTo={splitTo} fmt={fmt} />}
      </div>

      <CapitalChange bridge={view.bridge} movements={movements} periodName={name} recordPaths={assetRecordPaths()} fmt={fmt} />

      <DisclosureGroup>
        <Disclosure title={t('financialQuestions.forecast.question')} anchor="forecast"><ForecastPanel snapshot={snapshot} /></Disclosure>
      </DisclosureGroup>
    </div>
  )
}
