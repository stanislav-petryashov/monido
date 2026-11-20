import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useChartFrame } from '../../components/charts/useChartFrame'
import { shiftMonth } from '../../domain/dates'
import { fmtCurrencyCents, fmtDate, fmtMonth, fmtMonthNumeric, fmtNum } from '../../lib/formatters'
import { returnPct } from './text'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import type { GoalAllocation } from '../../domain/types'
import type { GoalLine } from './view'

/** The months the shares chart draws: two years */
const SHARE_MONTHS = 24

/** The share a goal settles on from its later month: the month after when the first is short (a nearer goal took part of it) */
const steady = (later: { perMonthBase: number; next: number | null }): number => Math.max(later.perMonthBase, later.next ?? 0)

/** The «Reached» cell's tone: on time, late, or never (muted) */
const reachedTone = (a: GoalAllocation): string =>
  a.projectedDate === null ? 'gl-mut' : a.status === 'on_track' || a.status === 'done' ? 'gl-ok' : 'gl-late'

interface SharesCardProps {
  /** The family's expected yearly return as a fraction (snapshot.expectedReturn) */
  annualReturn: number
  /** The goals in the plan's order (those without a rate are not shared anything) */
  lines: GoalLine[]
  selected: string | null
  onSelect: (id: string) => void
  /** The monthly saving; null — not tracked: one sentence with each goal's need */
  saving: number | null
  need: number
  /** The plan's month 0, 'YYYY-MM' */
  month: string
  currency: string
  fmt: (v: number) => string
  compact: boolean
}

/**
 * «How the goals share <saving> a month»: one bar a month for SHARE_MONTHS months, split by goal in the plan's order — the
 * chosen goal in ink, the others in two greys — and the table in cents (needed, gets now, later, reached) so its parts add
 * up to the totals as shown; a row selects its goal. Without the saving, one sentence with what each goal needs.
 */
export function SharesCard({ lines, selected, onSelect, saving, need, month, currency, fmt, compact: phone, annualReturn }: SharesCardProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const titleId = useId()
  const { ref, width } = useChartFrame(phone ? 340 : 780)
  const compact = phone || width < 480
  const planned = lines.filter(l => l.alloc !== null)
  if (!planned.length) return null
  const cents = (v: number) => (hidden ? PRIVACY_MASK : fmtCurrencyCents(v, currency))
  if (saving === null) return (
    <section className="card gl-card" aria-labelledby={titleId}>
      <h2 className="card-hd" id={titleId}>{t('goalsPage.shares.titleOff')}</h2>
      <p className="gl-calc gl-calc--text">{t('goalsPage.shares.off', {
        list: planned.map(l => t('goalsPage.shares.offItem', { name: l.name, amount: fmt(l.alloc!.requiredMonthlyBase) })).join(', '),
      })}</p>
    </section>
  )
  // the others alternate two greys; the chosen goal is the darkest
  const others = planned.filter(l => l.id !== selected)
  const tone = (id: string) => (id === selected ? 'gl-sh--sel' : others.findIndex(l => l.id === id) % 2 ? 'gl-sh--b' : 'gl-sh--a')
  const W = width, H = compact ? 130 : 140, L = compact ? 40 : 56, R = 8, TOP = 10, B = H - 26
  const bw = (W - L - R) / SHARE_MONTHS
  const Y = (v: number) => B - (saving > 0 ? (v / saving) * (B - TOP) : 0)
  const every = compact ? 6 : 3
  const rate = returnPct(annualReturn)
  const gap = need - saving

  return (
    <section className="card gl-card" aria-labelledby={titleId}>
      <div className="card-hd--row gl-card__hd">
        <h2 className="card-hd" id={titleId}>{t('goalsPage.shares.title', { saving: fmt(saving) })}</h2>
        <span className="gl-card__meta">{t('goalsPage.shares.meta', { count: SHARE_MONTHS })}</span>
      </div>
      <svg ref={ref} className="gl-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('goalsPage.shares.label')}>
        <line className="gl-chart__grid" x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} />
        <text className="gl-chart__t" x={L - 8} y={Y(saving) + 4} textAnchor="end">{hidden ? PRIVACY_MASK : fmtNum(saving, 0)}</text>
        {Array.from({ length: SHARE_MONTHS }, (_, i) => {
          const x = L + i * bw + 1
          const ym = shiftMonth(month, i + 1)
          let base = 0
          return (
            <g key={i}>
              {planned.map(l => {
                const v = l.alloc!.shares[i] ?? 0
                if (v <= 0) return null
                const y0 = base
                base += v
                return (
                  <rect key={l.id} className={tone(l.id)} x={x} y={Y(y0 + v)} width={Math.max(0, bw - 2)} height={Math.max(0, Y(y0) - Y(y0 + v))}>
                    <title>{t('goalsPage.shares.bar', { name: l.name, amount: hidden ? PRIVACY_MASK : fmt(v), month: fmtMonth(ym) })}</title>
                  </rect>
                )
              })}
              {i % every === 0 && <text className="gl-chart__t" x={x + bw / 2} y={H - 6} textAnchor="middle">{fmtDate(ym)}</text>}
            </g>
          )
        })}
      </svg>
      <div className="gl-shares-wrap">
        <table className="page-table gl-shares">
          <thead>
            <tr>
              <th>{t('goalsPage.shares.goal')}</th>
              <th className="num gl-c-ph">{t('goalsPage.shares.need')}</th>
              <th className="num">{t('goalsPage.shares.now')}</th>
              <th className="gl-c-ph">{t('goalsPage.shares.later')}</th>
              <th className="num">{t('goalsPage.shares.reached')}</th>
            </tr>
          </thead>
          <tbody>
            {planned.map(l => {
              const a = l.alloc!
              const later = l.steps?.later ?? null
              const reached = a.projectedDate
              return (
                <tr key={l.id} className={l.id === selected ? 'gl-shares__sel' : undefined} onClick={() => onSelect(l.id)}>
                  <td>
                    <span className="gl-shares__goal">
                    <span className={`gl-sw ${tone(l.id)}`} aria-hidden="true" />
                    <button type="button" className="gl-shares__name" aria-current={l.id === selected ? 'true' : undefined} onClick={e => { e.stopPropagation(); onSelect(l.id) }}>{l.name}</button>
                    </span>
                  </td>
                  <td className="num gl-c-ph" data-label={t('goalsPage.shares.need')}>{cents(a.requiredMonthlyBase)}</td>
                  <td className="num" data-label={t('goalsPage.shares.now')}>{cents(l.steps?.now ?? 0)}</td>
                  <td className="gl-c-ph gl-shares__then" data-label={t('goalsPage.shares.later')}>{later ? t('goalsPage.shares.laterValue', { month: fmtMonthNumeric(later.month), amount: hidden ? PRIVACY_MASK : fmt(steady(later)) }) : '—'}</td>
                  <td className={`num ${reachedTone(a)}`} data-label={t('goalsPage.shares.reached')}>{reached
                    ? (l.isFire ? t('goalsPage.shares.fireReached', { month: fmtMonthNumeric(reached), rate }) : fmtMonthNumeric(reached))
                    : a.status === 'done' ? t('goalsPage.status.done') : '—'}</td>
                </tr>
              )
            })}
            <tr className="gl-shares__total">
              <td>{t('goalsPage.shares.total')}</td>
              <td className="num gl-c-ph" data-label={t('goalsPage.shares.need')}>{cents(need)}</td>
              <td className="num" data-label={t('goalsPage.shares.now')}>{cents(saving)}</td>
              <td className="gl-c-ph" />
              <td className={`num ${gap > 0 ? 'gl-late' : 'gl-ok'}`}>{gap > 0 ? t('goalsPage.shares.short', { amount: cents(gap) }) : t('goalsPage.shares.spare', { amount: cents(-gap) })}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="gl-calc">{t('goalsPage.shares.note', { rate })}</p>
    </section>
  )
}
