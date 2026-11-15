import { ProgressTrack } from '../../components/ui/ProgressTrack'
import { useTranslation } from 'react-i18next'
import { fmtMonthNumeric, fmtPct } from '../../lib/formatters'
import { deadlineOf, statusLine } from './text'
import type { GoalLine } from './view'

interface GoalListProps {
  lines: GoalLine[]
  /** The monthly saving the plan shares (the 3-month average); null — income and expenses are not tracked */
  saving: number | null
  /** What the goals need a month to make their deadlines */
  need: number
  /** The months the saving is the average of, as words ("July–September 2026") */
  months: string
  selected: string | null
  onSelect: (id: string) => void
  fmt: (v: number) => string
}

/**
 * The goals list: the saving a month against what the goals need (a bullet, the shortfall as an assessment), then a row per
 * goal in the plan's order — the name, the share saved with a violet progress fill, "saved of target · by month" and the
 * plan's status. While the saving is unknown the head names only the need, and every status says there is no data.
 */
export function GoalList({ lines, saving, need, months, selected, onSelect, fmt }: GoalListProps) {
  const { t } = useTranslation()
  const gap = saving === null ? null : need - saving
  return (
    <section className="card gl-list" aria-label={t('goalsPage.list.label')}>
      {saving === null ? (
        <div className="gl-total">
          <div className="gl-total__l">{t('goalsPage.list.needOff')}</div>
          <div className="gl-total__v num">{fmt(need)}</div>
          <div className="gl-total__m">{t('goalsPage.list.needOffMeta')}</div>
        </div>
      ) : (
        <div className="gl-total">
          <div className="gl-total__l">{t('goalsPage.list.saving')}</div>
          <div className="gl-total__v num">{fmt(saving)}</div>
          <div className="gl-total__m">{t('goalsPage.list.savingMeta', { months })}</div>
          {need > 0 && (
            <>
              <div className="gl-track gl-track--bullet" role="img" aria-label={t('goalsPage.list.bullet', { saving: fmt(saving), need: fmt(need) })}>
                <i style={{ width: `${Math.min(100, (saving / need) * 100)}%` }} />
              </div>
              <div className="gl-total__ends">
                <span>{t('goalsPage.list.need', { amount: fmt(need) })}</span>
                {gap !== null && (gap > 0
                  ? <span className="gl-late">{t('goalsPage.list.short', { amount: fmt(gap) })}</span>
                  : <span className="gl-ok">{t('goalsPage.list.spare', { amount: fmt(-gap) })}</span>)}
              </div>
            </>
          )}
        </div>
      )}
      {lines.map(l => {
        const pct = l.alloc?.progressPct ?? (l.item.target > 0 ? (l.item.current / l.item.target) * 100 : 0)
        const status = statusLine(t, l)
        return (
          <button key={l.id} type="button" className="gl-row" aria-current={l.id === selected ? 'true' : undefined} onClick={() => onSelect(l.id)}>
            <span className="gl-row__name">{l.name}</span>
            <span className="gl-row__pct num">{fmtPct(pct)}</span>
            <ProgressTrack pct={pct} className="gl-row__progress" label={t('goalsPage.list.progress', { pct: fmtPct(pct) })} />
            <span className="gl-row__amt">{t('goalsPage.list.amount', {
              current: l.item.currentBase === null ? '—' : fmt(l.item.currentBase),
              target: l.item.targetBase === null ? '—' : fmt(l.item.targetBase),
              month: fmtMonthNumeric(deadlineOf(l)),
            })}</span>
            <span className={`gl-row__st ${status.tone}`}>{status.text}</span>
          </button>
        )
      })}
    </section>
  )
}
