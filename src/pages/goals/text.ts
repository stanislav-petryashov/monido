// The Goals page's words for the plan's figures: a goal's status line, its spans and months.
import type { Translate } from '../../i18n/core'
import { monthOf, monthsBetween } from '../../domain/dates'
import { fmtMonthNumeric, fmtSpan } from '../../lib/formatters'
import type { GoalLine } from './view'

/** An assessment's tone: on time (success), late or short (warning), unknown (muted) */
export type Tone = 'gl-ok' | 'gl-late' | 'gl-mut'

/** The goal's deadline month, 'YYYY-MM' */
export const deadlineOf = (l: GoalLine): string => monthOf(l.item.target_date)

/** How much later than the deadline a month is, as years and months */
export const lateBy = (l: GoalLine, month: string): string => fmtSpan(Math.max(0, monthsBetween(deadlineOf(l), month)))

/** The goal's status as the list and the queue say it: the plan's assessment, never a guess while the savings are unknown */
export function statusLine(t: Translate, l: GoalLine): { text: string; tone: Tone } {
  const a = l.alloc
  if (!a) return { text: t('goalsPage.status.noRate', { currency: l.item.currency }), tone: 'gl-mut' }
  if (a.status === 'done') return { text: t('goalsPage.status.done'), tone: 'gl-ok' }
  if (a.status === null) return { text: t('goalsPage.status.unknown'), tone: 'gl-mut' }
  if (a.status === 'unreachable' || a.projectedDate === null) return { text: t('goalsPage.status.unreachable'), tone: 'gl-late' }
  const month = fmtMonthNumeric(a.projectedDate)
  if (l.isFire) return a.status === 'on_track'
    ? { text: t('goalsPage.status.fireOnTrack', { month }), tone: 'gl-ok' }
    : { text: t('goalsPage.status.fire', { month, span: lateBy(l, a.projectedDate) }), tone: 'gl-late' }
  return a.status === 'on_track'
    ? { text: t('goalsPage.status.onTrack', { month: fmtMonthNumeric(deadlineOf(l)) }), tone: 'gl-ok' }
    : { text: t('goalsPage.status.late', { month, span: lateBy(l, a.projectedDate) }), tone: 'gl-late' }
}

/** 'YYYY-MM' → the month's name ("July") */
export const monthName = (t: Translate, ym: string): string => t(`dates.month.${Number(ym.slice(5, 7))}`)

/** Consecutive months as one range: "July–September 2026", across a new year "December 2025 – February 2026"; none → '—' */
export function monthRange(t: Translate, months: string[]): string {
  if (!months.length) return '—'
  const first = months[0], last = months[months.length - 1]
  const titled = (ym: string) => t('dates.monthYear', { month: monthName(t, ym), year: ym.slice(0, 4) })
  if (first === last) return titled(first)
  return first.slice(0, 4) === last.slice(0, 4)
    ? t('dates.monthYear', { month: `${monthName(t, first)}–${monthName(t, last)}`, year: last.slice(0, 4) })
    : `${titled(first)} – ${titled(last)}`
}
