import { ASSET_PERIODS } from '../domain/types'
import { Loading } from '../components/ui/Loading'
import { Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { PageError } from '../components/PageError'
import { WarningsBanner } from '../components/WarningsBanner'
import { Disclosure, DisclosureGroup } from '../components/ui/Disclosure'
import { SegmentedPills } from '../components/ui/SegmentedPills'
import { PageSkeleton } from '../components/ui/Skeleton'
import { assetChanges, assetHistoryView, availablePeriods, currentHoldings, holdingGroups, type GroupBy, type HoldingChange } from '../domain/assetChanges'
import type { AssetPeriod } from '../domain/types'
import { monthOf, monthsBetween } from '../domain/dates'
import { lazyWithChunks } from '../i18n/lazyWithChunks'
import { initialCapitalHistoryState } from '../lib/capitalHistory'
import { useDashboard } from '../lib/dashboardState'
import { fmtDayYear, fmtMonthYear, fmtPct } from '../lib/formatters'
import { useHashFocus } from '../lib/pageFocus'
import { periodSuffix, signed } from '../lib/pageHelpers'
import { holdingHref } from '../lib/recordLink'
import { calculationWarnings } from '../lib/snapshotSelectors'
import { assetRecordPaths } from '../lib/assetRecords'
import '../styles/assets.css'
import { AssetHistoryCard } from './assets/AssetHistoryCard'
import { AssetMap } from './assets/AssetMap'
import { ChangeWaterfall } from './assets/ChangeWaterfall'
import { CompositionList } from './assets/CompositionList'
import { HoldingsList } from './assets/HoldingsList'
import { PHONE, useMedia } from '../lib/media'
import { useOverviewMetrics, useSnapshot } from '../lib/useFinanceData'

/** ECharts is heavy and the full history is a second look: it loads only when its disclosure is opened. */
const CapitalHistoryPanel = lazyWithChunks(() => import('../components/charts/CapitalHistoryPanel').then(m => ({ default: m.CapitalHistoryPanel })), 'planning')

const OVER = { month: 'common.overMonth', quarter: 'common.overQuarter', year: 'common.overYear' } as const

/**
 * What the family owns: the total, what it is made of, the accounts and properties, each a link to its record, and at the
 * end the net-worth history over time (balances only, so it is the core's).
 */
export function Assets() {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const [picked, setPeriod] = useState<AssetPeriod>('month')
  const [by, setBy] = useState<GroupBy>('type')
  const compact = useMedia(PHONE)
  const overview = useOverviewMetrics()
  const snapshotQuery = useSnapshot()
  const snapshot = snapshotQuery.data
  const [historyState, setHistoryState] = useState(initialCapitalHistoryState)
  // kept here: the skeleton of a currency loading for the first time unmounts the disclosure
  const [historyOpen, setHistoryOpen] = useState(false)
  // a link to the section (/assets#history) opens it and lands on it
  useHashFocus(snapshot !== undefined)

  if (overview.isLoading) return <PageSkeleton />
  if (overview.error || !snapshot) return <PageError onRetry={() => { void overview.refetch(); void snapshotQuery.refetch() }} retrying={overview.isFetching || snapshotQuery.isFetching} />

  const capital = snapshot.capital
  const monthSuffix = periodSuffix(capital?.date)
  const periods = availablePeriods(snapshot)
  // the picked period while it has a start, else the first that has
  const period = periods.includes(picked) ? picked : periods[0] ?? picked
  const changes = assetChanges(snapshot, period)
  // the domain gives the amounts as numbers: formatted here, so privacy mode masks them
  const { gain, loss, gainer, loser, gainerMember, loserMember, ...findingParams } = changes?.finding?.params ?? {}
  // a name two holdings share takes its owner, as `named` does
  const who = (name: unknown, member: unknown) =>
    typeof name === 'string' && member && changes!.holdings.filter(h => h.name === name).length > 1 ? `${name} · ${String(member)}` : name
  const finding = changes?.finding && t(changes.finding.key, {
    ...findingParams, gainerMember, loserMember, gainer: who(gainer, gainerMember), loser: who(loser, loserMember),
    gain: typeof gain === 'number' ? fmt(gain) : gain, loss: typeof loss === 'number' ? fmt(loss) : loss,
  })
  // one total for the headline and the map's shares
  const total = changes ? changes.endTotal : capital?.assets ?? null
  const scopeKnown = !!capital && !!snapshot.capitalCoverage?.find(c => c.month === monthOf(capital.date))
  const totalKnown = changes ? changes.endComplete : !!capital && snapshot.capitalCoverage?.find(c => c.month === monthOf(capital.date))?.assetsKnown === true
  const figure = total === null || !totalKnown ? '—' : fmt(total)
  const changeScopeKnown = !!capital && snapshot.capitalCoverage?.find(c => c.month === monthOf(capital.date))?.assetsKnown === true && (!changes || snapshot.capitalCoverage?.find(c => c.month === changes.startMonth)?.assetsKnown === true)
  const historyView = assetHistoryView(snapshot)
  const overLabel = !changes ? '' : period === 'all' ? t('common.overAll', { month: fmtMonthYear(changes.startMonth) }) : t(OVER[period])
  const recordPaths = assetRecordPaths()
  /** The row's record: an account by its key (name + member), any other asset by its name */
  const recordOf = (row: Pick<HoldingChange, 'kind' | 'name' | 'member'>) => holdingHref(recordPaths, row)
  // the span, not the entries: a month without balances has none, and "9 months since January" would read as ending in September
  const firstMonth = snapshot.history[0]?.date.slice(0, 7)
  const lastMonth = snapshot.history.at(-1)?.date.slice(0, 7)
  const historyHint = firstMonth && lastMonth ? t('pages.netWorth.historyHint', { count: monthsBetween(firstMonth, lastMonth) + 1, start: fmtMonthYear(firstMonth) }) : undefined

  return (
    <div>
      <WarningsBanner warnings={calculationWarnings(snapshot, ['capital'])} />
      <div className="assets-period">
        <span className="assets-period__label" aria-hidden="true">{t('pages.assets.periodLabel')}</span>
        <SegmentedPills overflow="scroll"
          ariaLabel={t('pages.assets.periodGroup')}
          items={ASSET_PERIODS}
          active={changes ? period : null}
          onSelect={setPeriod}
          label={p => t(`pages.assets.period.${p}`)}
          disabledReason={p => (periods.includes(p) ? undefined : t('pages.assets.periodUnavailable'))}
        />
        {changes && <span className="assets-period__label">{t('pages.assets.since', { date: fmtDayYear(changes.startDate) })}</span>}
      </div>
      <section className="card card--p assets-top" aria-label={t('metrics.assets.title')}>
        <div>
          <div className="figure-label">{`${t('metrics.assets.title')}${monthSuffix}`}</div>
          <div className="hl__value" role="region" tabIndex={0} aria-label={figure}>{figure}</div>
          {changes?.complete && (
            <div className="hl__deltas">
              <span className="delta-pair">
                <span className="delta">{signed(changes.change, fmt)}</span>
                <span className="delta-pair__label">{changes.changePct === null ? overLabel : `${overLabel} · ${fmtPct(changes.changePct, { sign: true })}`}</span>
              </span>
            </div>
          )}
          {!totalKnown && capital && <p className="note">{t('pages.assets.incomplete')}</p>}
          {finding && <p className="assets-top__finding">{finding}</p>}
          {capital && total !== null && (
            <button type="button" className="btn btn--quiet" onClick={() => { const heading = document.getElementById('assets-holdings'); heading?.scrollIntoView?.(); heading?.focus() }}>{t('pages.assets.fullList')}</button>
          )}
          {!capital && <div className="note">{t('pages.netWorth.empty')}</div>}
        </div>
        {capital && total !== null && (
          <div>
          <AssetMap holdings={changes?.holdings ?? currentHoldings(capital, snapshot)} total={total} totalKnown={totalKnown} scopeKnown={scopeKnown} recordOf={recordOf} fmt={fmt} overLabel={changes ? overLabel : null} />
          </div>
        )}
      </section>

      {capital && total !== null && (
        <div className={changes ? 'assets-row' : 'mt-2'}>
          {changes && <ChangeWaterfall changes={changes} endMonth={monthOf(capital.date)} fmt={fmt} />}
          <CompositionList
            groups={holdingGroups((changes?.holdings ?? currentHoldings(capital, snapshot)), scopeKnown, changeScopeKnown)}
            total={total}
            totalKnown={totalKnown}
            by={by}
            onBy={setBy}
            fmt={fmt}
            members={snapshot.members}
            liquid={capital.liquid}
            overLabel={changes ? overLabel : null}
          />
        </div>
      )}

      {capital && total !== null && (
        <>
          <AssetHistoryCard snapshot={snapshot} period={period} changes={changes} overLabel={overLabel} compact={compact} />
          <HoldingsList
            holdings={changes?.holdings ?? currentHoldings(capital, snapshot)}
            total={total}
            totalKnown={totalKnown}
            scopeKnown={scopeKnown}
            changeScopeKnown={changeScopeKnown}
            recordOf={recordOf}
            fmt={fmt}
            members={snapshot.members}
            baseCurrency={snapshot.baseCurrency}
            overLabel={changes ? overLabel : null}
          />
        </>
      )}

      <DisclosureGroup>
        <Disclosure title={t('pages.netWorth.history')} hint={historyHint} anchor="history" focusable initiallyOpen={historyOpen} onToggle={setHistoryOpen}>
          <ErrorBoundary fallback={<PageError />}>
            <Suspense fallback={<Loading className="reminder-state" />}>
              <CapitalHistoryPanel history={snapshot.history} unavailableMonths={historyView.unavailableCapital} state={historyState} onChange={setHistoryState}
                real={!snapshot.inflation ? { unavailable: 'no-inflation' } : snapshot.inflation.currency !== snapshot.baseCurrency ? { unavailable: 'other-currency', currency: snapshot.inflation.currency } : { ratePct: snapshot.inflation.ratePct }} />
            </Suspense>
          </ErrorBoundary>
        </Disclosure>
      </DisclosureGroup>
    </div>
  )
}
