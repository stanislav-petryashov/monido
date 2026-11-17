import { IconArrowLeft } from '@tabler/icons-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageError } from '../components/PageError'
import { WarningsBanner } from '../components/WarningsBanner'
import { PageSkeleton } from '../components/ui/Skeleton'
import { isoDate } from '../domain/dates'
import { allocateGoals, goalsInBase, savingToMeet } from '../domain/goals'
import { useDashboard } from '../lib/dashboardState'
import { PHONE, useMedia } from '../lib/media'
import { useFamilyCurrency } from '../lib/familySettings'
import { useCan } from '../lib/rights'
import { calculationWarnings } from '../lib/snapshotSelectors'
import { useGoalMetrics, useSnapshot } from '../lib/useFinanceData'
import { useClientModules } from '../modules/client'
import { AccumulationChart } from './goals/AccumulationChart'
import { setParam, useParam } from './goals/address'
import { GoalActions } from './goals/GoalActions'
import { GoalEditor } from './goals/GoalEditor'
import type { PreviewContext } from './goals/goalRows'
import { Forecasts } from './goals/Forecasts'
import { GoalHead } from './goals/GoalHead'
import { GoalList } from './goals/GoalList'
import { EmptyGoals } from './goals/EmptyGoals'
import { NewGoalDialog } from './goals/NewGoalDialog'
import { SharesCard } from './goals/SharesCard'
import { monthName, monthRange } from './goals/text'
import { averageMonths, defaultGoal, goalLines, knownRates, planToday, thisMonth } from './goals/view'
import { WhatIfSaving } from './goals/WhatIfSaving'
import { parseAmount } from './admin/amount'
import '../styles/goals.css'

/**
 * Goals: the list (the monthly saving against what the goals need, a row per goal in the plan's order) beside the chosen
 * goal — its head with the KPIs and the verdict, for independence its forecast and «Forecasts». On a phone the list and
 * the goal are two screens (`?goal=` opens one, «← Goals» goes back). Every figure is the domain's (goals.ts), read from
 * the snapshot's plan; the page finds and words them.
 */
export function Goals() {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const canEdit = useCan('edit')
  const phone = useMedia(PHONE)
  const m = useGoalMetrics()
  const snapshotQuery = useSnapshot()
  const snapshot = snapshotQuery.data
  const goalParam = useParam('goal')
  const adding = useParam('new') !== null
  const familyCurrency = useFamilyCurrency()
  // the advisor's page, where the family can weigh a goal with options: absent in the demo (a module, not a name check)
  const advisor = useClientModules().some(mod => mod.routes?.some(r => r.path === '/advisor/ask'))
  /** The chosen goal's editor: «Update saved» focuses the saved amount, «move the deadline» brings a month; null — closed */
  const [editing, setEditing] = useState<{ id: string; focusSaved?: boolean; month?: string } | null>(null)
  const editorDiscard = useRef<((action: () => void) => Promise<void>) | null>(null)
  const month = snapshot ? thisMonth(snapshot) : ''
  // "what if we saved X a month": the whole plan re-run here, never saved; '' — the family's own saving
  const [whatIfText, setWhatIfText] = useState('')
  const whatIf = parseAmount(whatIfText).value
  const whatIfPlan = useMemo(() => (snapshot && whatIf !== null && snapshot.goals.plan.monthlySavingsBase !== null
    ? allocateGoals(goalsInBase(snapshot.goals.items, snapshot.baseCurrency), Math.max(0, whatIf), planToday(snapshot), {}, snapshot.baseCurrency)
    : null), [snapshot, whatIf])
  const lines = useMemo(() => (snapshot ? goalLines(snapshot, month, whatIfPlan ?? undefined) : []), [snapshot, month, whatIfPlan])
  const selectedId = lines.some(l => l.id === goalParam) ? goalParam : defaultGoal(lines)
  const line = lines.find(l => l.id === selectedId) ?? null
  const actualSaving = snapshot?.goals.plan.monthlySavingsBase ?? null
  const saving = whatIfPlan ? whatIfPlan.monthlySavingsBase : actualSaving
  const need = whatIfPlan?.totalRequiredBase ?? snapshot?.goals.plan.totalRequiredBase ?? 0
  // the smallest saving that makes a late goal's deadline: up to fifty runs of the plan, for the chosen goal only
  const meet = useMemo(() => (snapshot && line && !line.isFire && line.alloc?.status === 'at_risk'
    ? savingToMeet(goalsInBase(snapshot.goals.items, snapshot.baseCurrency), line.id, saving, planToday(snapshot), {}, snapshot.baseCurrency)
    : null), [snapshot, line, saving])

  if (m.isLoading || snapshotQuery.isLoading) return <PageSkeleton />
  if (m.error || !m.data || !snapshot) return <PageError onRetry={() => { void m.refetch(); void snapshotQuery.refetch() }} retrying={m.isFetching || snapshotQuery.isFetching} />
  const context: PreviewContext = {
    goals: goalsInBase(snapshot.goals.items, snapshot.baseCurrency), saving, rates: knownRates(snapshot), base: snapshot.baseCurrency, today: planToday(snapshot), fmt,
  }
  const dialog = canEdit && adding && (
    <NewGoalDialog currency={familyCurrency || snapshot.baseCurrency} context={context} ask={advisor}
      onCreated={id => { setParam('new', null); setParam('goal', id) }} onClose={() => setParam('new', null)} />
  )
  if (lines.length === 0) return <>{dialog}<EmptyGoals canEdit={canEdit} ask={advisor} /></>

  const data = m.data
  const avg = averageMonths(snapshot)
  const range = monthRange(t, avg.map(r => r.month))
  const monthNets = avg.map(r => `${monthName(t, r.month)} ${fmt(r.net)}`).join(', ')
  // another goal closes the editor, asking first when its draft has changes
  const guarded = (action: () => void) => (editorDiscard.current ? void editorDiscard.current(action) : action())
  const select = (id: string, push = phone) => guarded(() => { setEditing(null); setParam('goal', id, push) })
  const edit = editing && line && editing.id === line.id ? editing : null
  // a phone shows the list until a goal is opened from it
  const showList = !phone || goalParam === null
  const showGoal = line !== null && (!phone || goalParam !== null)
  // under a "what if" the independence figures that follow the saving come from that plan; its other figures do not move
  const fireLine = lines.find(l => l.isFire)
  const fire = whatIfPlan && data.fire && fireLine
    ? { ...data.fire, atDeadlineBase: fireLine.atDeadline, forecastMonth: fireLine.alloc?.projectedDate ?? null, series: null }
    : data.fire
  return (
    <div className="gl-page">
      {dialog}
      <WarningsBanner warnings={calculationWarnings(snapshot, ['capital', 'cashflow', 'goals'])} />
      <div className="gl-split">
        {showList && (
          <GoalList lines={lines} saving={saving} need={need} months={range}
            selected={phone ? null : selectedId} onSelect={select} fmt={fmt} hypothetical={whatIfPlan !== null}
            whatIf={actualSaving !== null && <WhatIfSaving actual={actualSaving} value={whatIfText} onChange={setWhatIfText} fmt={fmt} />} />
        )}
        {showGoal && line && (
          <div className="gl-detail">
            {phone && (
              <button type="button" className="btn btn--ghost gl-back" onClick={() => guarded(() => { setEditing(null); setParam('goal', null) })}>
                <IconArrowLeft size={16} aria-hidden="true" />{t('goalsPage.back')}
              </button>
            )}
            {canEdit && edit && line.alloc ? (
              <GoalEditor key={line.id} goal={line.alloc.goal} was={line.alloc.requiredMonthlyBase} focusSaved={edit.focusSaved} month={edit.month} context={context}
                onClose={() => setEditing(null)} bindDiscard={d => { editorDiscard.current = d }} />
            ) : (
              <GoalHead line={line} fire={line.isFire ? fire : null} saving={saving} meet={meet} months={monthNets} fmt={fmt}
                actions={canEdit && line.alloc ? <GoalActions id={line.id} name={line.name} onUpdate={() => setEditing({ id: line.id, focusSaved: true })} onEdit={() => setEditing({ id: line.id })} /> : null}
                onMoveDeadline={canEdit && line.alloc ? m2 => setEditing({ id: line.id, month: m2 }) : null} />
            )}
            <AccumulationChart line={line} fire={line.isFire ? fire : null} month={month} today={isoDate(planToday(snapshot))} currency={snapshot.baseCurrency}
              known={saving !== null} fmt={fmt} compact={phone} />
            {line.isFire && <Forecasts data={data} snapshot={snapshot} fmt={fmt} />}
            <SharesCard lines={lines} selected={line.id} onSelect={id => select(id, false)} saving={saving} need={need}
              month={month} currency={snapshot.baseCurrency} fmt={fmt} compact={phone} />
          </div>
        )}
      </div>
    </div>
  )
}
