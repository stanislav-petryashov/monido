import { FinancialAnswers } from '../components/finance/FinancialAnswers'
import { createElement, useState } from 'react'
import ClosedMonthResult from '../components/finance/ClosedMonthResult'
import { Trans, useTranslation } from 'react-i18next'
import { PageError } from '../components/PageError'
import { Card } from '../components/ui/Card'
import { SectionLabel } from '../components/ui/SectionLabel'
import { Link } from '../components/ui/Link'
import { Notice } from '../components/ui/Notice'
import { PageSkeleton } from '../components/ui/Skeleton'
import { MONTH_RE, monthOf } from '../domain/dates'
import { partialCapitalMonths } from '../domain/overviewBlocks'
import { yearCells } from '../domain/yearCells'
import { useAuth } from '../lib/authState'
import { useCan, useCanRunSetup } from '../lib/rights'
import { useDashboard } from '../lib/dashboardState'
import { useClientModules } from '../modules/client'
import { useSnapshot } from '../lib/useFinanceData'
import { NetWorthBlock } from './overview/NetWorthBlock'
import { WhoseAssetsCard } from './overview/WhoseAssetsCard'
import { YearsComb } from './overview/YearsComb'
import '../styles/overview.css'

/** A notice with a bold title, a sentence and the button to act on it */
function OverviewNotice({ title, text, to, cta }: { title: string; text: string; to: string; cta: string }) {
  return (
    <Notice>
      <div className="notice__text">
        <h2 className="notice__title">{title}</h2>
        {text}
      </div>
      <Link to={to} className="btn btn--primary">{cta}</Link>
    </Notice>
  )
}

/**
 * The home page: the years comb, the net-worth block for the month picked on it (the last one with balances at first), the
 * modules' key figures, a card per other page, then the answers. What needs doing is on the menu's second floor and in
 * the title row's "Close <month>" (CloseMonthAction); the full history ("History") is at the end of Assets and
 * "What changed?" on Income and expenses.
 */
export function Overview() {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const snapshotQuery = useSnapshot()
  const snapshot = snapshotQuery.data
  const parts = useClientModules()
  const { setup } = useAuth()
  const canRunSetup = useCanRunSetup()
  const canEdit = useCan('edit')
  const demo = useAuth().mode === 'demo'
  // the month the block shows: the one picked on the comb, else the balances' month (the KPI row keeps the flows' month)
  const [month, setMonth] = useState<string | null>(null)
  // how many years the comb's window is shifted back
  const [offset, setOffset] = useState(0)

  if (snapshotQuery.isLoading) return <PageSkeleton />
  if (snapshotQuery.error || !snapshot) return <PageError onRetry={() => void snapshotQuery.refetch()} retrying={snapshotQuery.isFetching}>{t('pages.overview.loadError')}</PageError>

  const last = snapshot.history.at(-1)
  const shown = month ?? (snapshot.asOf.capitalDate ? monthOf(snapshot.asOf.capitalDate) : last ? monthOf(last.date) : null)
  const cells = yearCells(snapshot.history, snapshot.asOf.openMonths, new Date(), partialCapitalMonths(snapshot))
  // the modules' cells and cards, each slot ordered across the modules; the core's own card is "Whose assets"
  const kpis = parts.flatMap(p => (p.overview?.kpis ?? []).map(k => ({ key: `${p.key}-${k.order}`, ...k }))).sort((a, b) => a.order - b.order)
  const cards = [
    { key: 'whose-assets', order: 10, Card: WhoseAssetsCard },
    ...parts.flatMap(p => (p.overview?.cards ?? []).filter(c => !c.visible || c.visible(snapshot)).map(c => ({ key: `${p.key}-${c.order}`, order: c.order, Card: c.Card }))),
  ].sort((a, b) => a.order - b.order)

  // a finished year's page, from the first module that has one (the core knows no module's address)
  const yearHref = (year: number) => parts.map(p => p.overview?.yearHref?.(snapshot, year)).find(Boolean) ?? null
  const requested = new URLSearchParams(window.location.search).get('month') ?? ''
  const resultMonth = MONTH_RE.test(requested) ? requested : null

  return (
    <div>
      {resultMonth && <ClosedMonthResult month={resultMonth} snapshot={snapshot} yearHref={yearHref} />}
      {setup === 'skipped' && canRunSetup && (
        <OverviewNotice title={t('pages.overview.setupSkipped')} text={t('pages.overview.setupSkippedText')} to="/setup" cta={t('pages.overview.setupCta')} />
      )}
      {setup !== null && setup !== 'done' && !canRunSetup && <p className="note mb-2">{t('pages.overview.setupPending')}</p>}

      <section aria-labelledby="overview-history-title">
        <SectionLabel id="overview-history-title">{t('pages.overview.historyTitle')}</SectionLabel>
      {/* no closed balances: no years and no month to show, only where to enter them */}
      {cells.length > 0 && shown ? (
        <>
          <YearsComb cells={cells} selected={shown} onSelect={setMonth} offset={offset} onOffset={setOffset} fmt={fmt} yearHref={yearHref} />
          <NetWorthBlock snapshot={snapshot} month={shown} resultShown={resultMonth === shown} />
        </>
      ) : (
        <Card className="mb-2"><p className="empty empty--tile">{t('pages.netWorth.empty')}</p></Card>
      )}
      {/* a short history: older balances kept in a spreadsheet can come in at once */}
      {canEdit && !demo && snapshot.history.length < 3 && (
        <p className="note mb-2"><Trans i18nKey="pages.overview.importHint" components={{ import: <Link to="/settings/data" className="link-accent" /> }} /></p>
      )}

      </section>
      <section aria-labelledby="overview-summary-title">
        <SectionLabel id="overview-summary-title">{t('pages.overview.summaryTitle')}</SectionLabel>
      {/* no module supplies a cell — no row either */}
      {kpis.length > 0 && (
        <ul className="kpis" aria-label={t('pages.overview.keyFigures')}>{kpis.map(k => createElement(k.Cell, { key: k.key }))}</ul>
      )}
      <div className="overview-grid">{cards.map(c => createElement(c.Card, { key: c.key }))}</div>

      </section>
      <div className="overview-attention">
        <FinancialAnswers snapshot={snapshot} page="overview" />
      </div>
    </div>
  )
}
