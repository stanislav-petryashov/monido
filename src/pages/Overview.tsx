import { createElement, useState } from 'react'
import ClosedMonthResult from '../components/finance/ClosedMonthResult'
import { Trans, useTranslation } from 'react-i18next'
import { PageError } from '../components/PageError'
import { Card } from '../components/ui/Card'
import { Link } from '../components/ui/Link'
import { Notice } from '../components/ui/Notice'
import { PageSkeleton } from '../components/ui/Skeleton'
import { MONTH_RE, monthOf } from '../domain/dates'
import type { CapitalHistoryPreset } from '../lib/capitalHistory'
import { milestoneText } from '../lib/milestoneText'
import { useMoney } from '../lib/privacy'
import { useAuth } from '../lib/authState'
import { useCan, useCanRunSetup } from '../lib/rights'
import { useClientModules } from '../modules/client'
import { useSnapshot } from '../lib/useFinanceData'
import { CapitalSummary } from './overview/CapitalSummary'
import { HouseholdReview } from './overview/HouseholdReview'
import { OverviewAccounts } from './overview/OverviewAccounts'
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

export function Overview() {
  const { t } = useTranslation()
  const fmtIn = useMoney()
  const snapshotQuery = useSnapshot()
  const snapshot = snapshotQuery.data
  const parts = useClientModules()
  const { setup } = useAuth()
  const canRunSetup = useCanRunSetup()
  const canEdit = useCan('edit')
  const demo = useAuth().mode === 'demo'
  const [owner, setOwner] = useState<string | null>(null)
  const [preset, setPreset] = useState<CapitalHistoryPreset>('12m')

  if (snapshotQuery.isLoading) return <PageSkeleton />
  if (snapshotQuery.error || !snapshot) return <PageError onRetry={() => void snapshotQuery.refetch()} retrying={snapshotQuery.isFetching}>{t('pages.overview.loadError')}</PageError>

  const familyCards = parts.filter(p => p.key === 'goals' || p.key === 'health')
    .flatMap(p => (p.overview?.cards ?? []).filter(c => !c.visible || c.visible(snapshot)))
    .sort((a, b) => a.order - b.order)
  const yearHref = (year: number) => parts.map(p => p.overview?.yearHref?.(snapshot, year)).find(Boolean) ?? null
  const requested = new URLSearchParams(window.location.search).get('month') ?? ''
  const resultMonth = MONTH_RE.test(requested) ? requested : null

  const month = snapshot.asOf.capitalDate && monthOf(snapshot.asOf.capitalDate)
  const milestone = month && owner === null && resultMonth !== month && snapshot.milestones?.find(m => m.month === month && m.headline && m.announced)

  return (
    <div className="family-overview">
      {resultMonth && <ClosedMonthResult month={resultMonth} snapshot={snapshot} yearHref={yearHref} />}
      {setup === 'skipped' && canRunSetup && (
        <OverviewNotice title={t('pages.overview.setupSkipped')} text={t('pages.overview.setupSkippedText')} to="/setup" cta={t('pages.overview.setupCta')} />
      )}
      {setup !== null && setup !== 'done' && !canRunSetup && <p className="note mb-2">{t('pages.overview.setupPending')}</p>}

      {snapshot.history.length ? (
        <CapitalSummary snapshot={snapshot} owner={owner} setOwner={setOwner} preset={preset} setPreset={setPreset} />
      ) : <Card><p className="empty empty--tile">{t('pages.netWorth.empty')}</p></Card>}
      {milestone && <p className="note">{milestoneText(t, milestone, fmtIn)}</p>}
      {canEdit && !demo && snapshot.history.length < 3 && (
        <p className="note"><Trans i18nKey="pages.overview.importHint" components={{ import: <Link to="/settings/data" className="link-accent" /> }} /></p>
      )}
      {familyCards.length > 0 && <section aria-labelledby="overview-family-title">
        <h2 className="overview__title" id="overview-family-title">{t('pages.overview.family.title')}</h2>
        <div className="overview-family-cards">{familyCards.map(c => createElement(c.Card, { key: c.order }))}</div>
      </section>}
      {owner === null && <HouseholdReview snapshot={snapshot} />}
      <OverviewAccounts snapshot={snapshot} owner={owner} preset={preset} />
    </div>
  )
}
