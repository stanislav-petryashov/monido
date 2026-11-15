// The goals rows the page writes, and the goal form's text as a row: shared by the editor, the new-goal dialog and the menu.
import type { GoalRow } from '../../domain/types'
import { isFireGoal } from '../../domain/goals'
import { tableQuery } from '../admin/adminQuery'
import { amountText, parseAmount } from '../admin/amount'
import { UNREAD_DATE } from '../admin/dateMask'
import type { GoalFields } from './GoalForm'

/** The goals rows with their rowid: what an edit names, and the keys a new goal picks among */
export const GOAL_ROWS = tableQuery<GoalRow & { rowid: number }>('goals')

/** A stored goal as the form shows it */
export const fieldsOf = (g: GoalRow): GoalFields => ({
  name: g.name, target: amountText(g.target), current: amountText(g.current), target_date: g.target_date, currency: g.currency, fire: isFireGoal(g) ? 'on' : '',
})

/** Read a goal draft once, returning either its row or the reason it cannot be saved. */
export function rowOf(data: GoalFields, id: string): { row: GoalRow; error: null } | { row: null; error: 'goalsPage.form.needName' | 'goalsPage.form.needMonth' | 'goalsPage.form.needAmount' } {
  const target = parseAmount(data.target).value
  const current = data.current.trim() === '' ? 0 : parseAmount(data.current).value
  if (!data.name.trim()) return { row: null, error: 'goalsPage.form.needName' }
  if (!data.target_date || data.target_date === UNREAD_DATE) return { row: null, error: 'goalsPage.form.needMonth' }
  if (target === null || current === null) return { row: null, error: 'goalsPage.form.needAmount' }
  return { row: { id, name: data.name.trim(), target, current, target_date: data.target_date, currency: data.currency, emoji: null }, error: null }
}

/** What the plan preview needs from the page */
export interface PreviewContext {
  /** The snapshot's goals in its base currency (goalsInBase) */
  goals: GoalRow[]
  saving: number | null
  rates: Record<string, number>
  base: string
  /** The plan's today: the snapshot's day */
  today: Date
  fmt: (v: number) => string
}
