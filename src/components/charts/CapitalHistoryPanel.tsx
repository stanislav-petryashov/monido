import { useTranslation } from 'react-i18next'
import type { HistoryPoint } from '../../domain/types'
import { resolveCapitalHistory, type CapitalHistoryState, type CapitalHistoryPreset } from '../../lib/capitalHistory'
import { growthForHistory } from '../../lib/snapshotSelectors'
import { fmtMonth, fmtPct, fmtYears } from '../../lib/formatters'
import { useDashboard } from '../../lib/dashboardState'
import { Card } from '../ui/Card'
import { StatRow } from '../cards/StatRow'
import { AreaChart } from './AreaChart'
import '../../styles/finance.css'

const PRESETS: CapitalHistoryPreset[] = ['3m', '6m', '12m', 'all']
const UNITS = ['amount', 'percent'] as const
const label = (name: string) => `pages.netWorth.historyPanel.${name}`

export function CapitalHistoryPanel({ history, state, onChange, unavailableMonths }: { history: HistoryPoint[]; state: CapitalHistoryState; onChange: (state: CapitalHistoryState) => void; unavailableMonths?: readonly string[] }) {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const { model, selectedMonth } = resolveCapitalHistory(history, state, unavailableMonths)
  const points = model.selected.flatMap(m => m.point ? [m.point] : [])
  const growth = growthForHistory(points), first = points[0], last = points[points.length - 1]
  const complete = !unavailableMonths || !model.selected.some(m => unavailableMonths.includes(m.month))
  const delta = complete && first && last && points.length > 1 ? last.netWorth - first.netWorth : null
  const noPlot = !model.series.some(s => state.visibleSeries.includes(s.key) && s.values.some(v => v !== null))
  // A different analysis control resets transient hover/announcement state, not page intent.
  const chartKey = [model.unit, model.range?.from, model.range?.to, ...state.visibleSeries].join('|')
  return <Card className="capital-history">
    {!history.length ? <p className="note">{t(label('empty'))}</p> : <>
      {unavailableMonths && model.selected.some(m => !m.point) && <p className="note">{t('pages.assets.incompleteHistory')}</p>}
      <div className="capital-history__top">
        <p className="note">{model.range && t(label('dates'), { from: fmtMonth(model.range.from), to: fmtMonth(model.range.to) })}</p>
        <div className="capital-history__switch" role="group" aria-label={t(label('period'))}>{PRESETS.map(p => <button type="button" key={p} aria-pressed={state.preset === p} onClick={() => onChange({ ...state, preset: p, customRange: null, selectedMonth: null })}>{t(label(p))}</button>)}</div>
      </div>
      <div className="capital-history__top">
        <div className="capital-history__legend" role="group" aria-label={t(label('series'))}>{model.series.map((s, i) => {
          const enabled = state.visibleSeries.includes(s.key)
          return <div key={s.key}>
            <button type="button" aria-pressed={enabled} disabled={enabled && state.visibleSeries.length === 1} aria-describedby={s.unavailableReason ? `capital-reason-${s.key}` : undefined} onClick={() => onChange({ ...state, visibleSeries: enabled ? state.visibleSeries.filter(k => k !== s.key) : [...state.visibleSeries, s.key] })}>
              <i className="capital-history__dot" aria-hidden="true" style={{ background: `var(${i === 0 ? '--primary' : i === 1 ? '--chart-2' : '--chart-3'})` }} />{t(label(s.key))}
            </button>
            {s.unavailableReason && <span id={`capital-reason-${s.key}`} className="capital-history__reason">{t(label(s.unavailableReason))}</span>}
          </div>
        })}</div>
        <div className="capital-history__switch" role="group" aria-label={t(label('units'))}>{UNITS.map(unit => <button type="button" key={unit} aria-pressed={state.unit === unit} onClick={() => onChange({ ...state, unit })}>{t(label(unit))}</button>)}</div>
      </div>
      {noPlot && state.unit === 'percent' && <p className="note">{t(label('noPercent'))} <button type="button" className="link-button" onClick={() => onChange({ ...state, unit: 'amount' })}>{t(label('showAmounts'))}</button></p>}
      <AreaChart key={chartKey} model={model} visibleSeries={state.visibleSeries} selectedMonth={selectedMonth} height={history.length === 1 ? 140 : 240} onSelectMonth={month => onChange({ ...state, selectedMonth: month })} />
      <div className="capital-history__growth">
        {delta !== null && Number.isFinite(delta) ? <>
          <p className="note">{t(label('actualDates'), { from: fmtMonth(first.date), to: fmtMonth(last.date) })}</p>
          <StatRow label={t(label('change'))} value={fmt(delta)} />
        </> : <p className="note">{t(label('insufficient'))}</p>}
        {complete && growth.cagrPct !== null && <>
          <StatRow label={t('pages.netWorth.growthOver', { count: growth.months, months: growth.months })} value={fmtPct(growth.cagrPct, { sign: true, preserveNonzero: true })} />
          <StatRow label={t('pages.netWorth.doubling')} value={fmtYears(growth.doublingYears)} />
          {growth.cagrPct <= 0 && <p className="note">{t('pages.netWorth.noDoubling')}</p>}
        </>}
        <p className="note">{t(label('contributions'))}</p>
      </div>
    </>}
  </Card>
}
