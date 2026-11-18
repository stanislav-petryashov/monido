import { useQuery } from '@tanstack/react-query'
import { useContext, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { monthEnd, monthOf } from '../../domain/dates'
import { isFireGoal, planPreview } from '../../domain/goals'
import type { GoalRow } from '../../domain/types'
import { apiSend } from '../../lib/api'
import { ToastContext, useToast } from '../../lib/notifyState'
import { changed, useDiscardGuard } from '../../lib/useUnsavedChanges'
import { goalKey } from '../../modules/goals/goalKey'
import { useSnapshotWrite } from '../admin/adminQuery'
import { onEscape } from '../admin/ui/onEscape'
import { useSingleFlight } from '../admin/useSingleFlight'
import { useReferenceLists } from '../admin/shared'
import { GoalFieldInputs, WhatHappens, type GoalFields } from './GoalForm'
import { fieldsOf, GOAL_ROWS, rowOf, type PreviewContext } from './goalRows'

interface GoalEditorProps {
  goal: GoalRow
  /** The need before the change (the plan's requiredMonthlyBase) */
  was: number
  /** «Update saved»: the focus on «Already saved»; a month from «move the deadline to …» */
  focusSaved?: boolean
  month?: string | null
  context: PreviewContext
  onClose: () => void
  /** Hands the page the editor's discard guard: choosing another goal asks first when the draft has changes */
  bindDiscard: (discard: ((action: () => void) => Promise<void>) | null) => void
}

/**
 * The chosen goal's fields in place of its head: Enter saves, Escape cancels behind the discard guard, one save at a time;
 * «With the changes» says live what the plan does with the draft. The write is the goals row with the goal the form was
 * filled from as `expectedIdentity`, so a change made elsewhere is refused, not overwritten. Drawn only inside the app's notifications.
 */
export function GoalEditor(props: GoalEditorProps) {
  return useContext(ToastContext) ? <Editor {...props} /> : null
}

function Editor({ goal, was, focusSaved = false, month = null, context, onClose, bindDiscard }: GoalEditorProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const stored = useQuery(GOAL_ROWS).data?.rows
  const opened = stored?.find(r => r.id === goal.id) ?? null
  const { currencies } = useReferenceLists()
  const write = useSnapshotWrite([GOAL_ROWS.queryKey])
  const [runSave, saving, pending] = useSingleFlight()
  // the form shows `goal`: its changes and the identity it was opened with are taken against it, never against a newer row,
  // so a change made elsewhere since is refused (409), not written back
  const baseline = useMemo(() => fieldsOf(goal), [goal])
  const [data, setFields] = useState<GoalFields>(() => ({ ...fieldsOf(goal), ...(month ? { target_date: monthEnd(month) } : {}) }))
  const setData = (change: Partial<GoalFields>) => setFields(d => ({ ...d, ...change }))
  const [submitted, setSubmitted] = useState(false)
  const { discard } = useDiscardGuard(changed(data, baseline) || saving, pending)
  useEffect(() => { bindDiscard(discard); return () => bindDiscard(null) })
  const others = (stored ?? []).filter(r => r.id !== goal.id)
  const otherFire = others.find(isFireGoal)
  const { row: draft, error } = rowOf(data, goal.id)
  const preview = draft ? planPreview(context.goals, draft, context.saving, context.today, context.rates, context.base) : null

  async function save() {
    setSubmitted(true)
    if (!opened || !draft) {
      if (error) toast.error(t('data.common.saveFailed'), t(error))
      return
    }
    // the switch decides the key: independence is `fire`, another goal the name's slug
    const fireChanged = (data.fire === 'on') !== isFireGoal(goal)
    const id = fireChanged ? goalKey({ name: data.name }, others.map(r => ({ rowid: r.rowid, id: r.id })), data.fire === 'on') : goal.id
    const row = { ...draft, id }
    const fields = Object.fromEntries((['id', 'name', 'target', 'current', 'target_date', 'currency'] as const)
      .filter(k => row[k] !== goal[k]).map(k => [k, row[k]]))
    if (!Object.keys(fields).length) { onClose(); return }
    const { rowid } = opened
    const expectedIdentity = { id: goal.id, name: goal.name, target: goal.target, current: goal.current, target_date: goal.target_date, emoji: goal.emoji, currency: goal.currency }
    const saved = await write(() => apiSend(`/api/admin/goals/${rowid}`, 'PUT', { ...fields, expectedIdentity }), [t('goalsPage.form.saved'), row.name], t('data.common.saveFailed'))
    if (saved) onClose()
  }

  return (
    <form className="card gl-head gl-form" noValidate onSubmit={e => { e.preventDefault(); void runSave(save) }} onKeyDown={onEscape(() => void discard(onClose))}>
      <h2 className="gl-form__title">{t('goalsPage.form.editTitle')}</h2>
      <fieldset className="form-stack gl-form__set" disabled={saving}>
        <GoalFieldInputs data={data} setData={setData} currencies={currencies} wasMonth={monthOf(goal.target_date)} focusSaved={focusSaved} submitted={submitted}
          fire={isFireGoal(goal) || !otherFire ? { offered: true } : { offered: false, other: otherFire.name }} />
      </fieldset>
      <WhatHappens preview={preview} currency={data.currency} was={was} fmt={context.fmt} />
      <div className="form-actions">
        <span className="gl-form__keys">{t('goalsPage.form.keys')}</span>
        <button type="button" className="btn btn--ghost" disabled={saving} onClick={() => void discard(onClose)}>{t('common.cancel')}</button>
        <button type="submit" className="btn btn--primary" disabled={saving || !opened}>{t('data.common.save')}</button>
      </div>
    </form>
  )
}
