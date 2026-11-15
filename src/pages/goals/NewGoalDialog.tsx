import { useQuery } from '@tanstack/react-query'
import { useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isFireGoal, planPreview } from '../../domain/goals'
import { apiSend } from '../../lib/api'
import { ToastContext, useToast } from '../../lib/notifyState'
import { changed, useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { goalKey } from '../../modules/goals/goalKey'
import { useSnapshotWrite } from '../admin/adminQuery'
import { FormDialog } from '../admin/ui/FormDialog'
import { useReferenceLists } from '../admin/shared'
import { GoalFieldInputs, WhatHappens, type GoalFields } from './GoalForm'
import { GOAL_ROWS, rowOf, type PreviewContext } from './goalRows'

/** The draft's key while it is typed: no stored goal has it */
const DRAFT_ID = '__draft__'

interface NewGoalDialogProps {
  /** The family currency: a new goal's first */
  currency: string
  context: PreviewContext
  /** «Weigh it with options: ask the Advisor» — only where the advisor's page is */
  ask: boolean
  onCreated: (id: string) => void
  onClose: () => void
}

/**
 * A new goal in a dialog on `--raised`: the goal's fields and «What happens» live from the plan (its place in the queue,
 * what it gets and when it is reached, the goals whose months move), «Ask the Advisor» where the advisor is. Drawn only
 * inside the app's notifications.
 */
export function NewGoalDialog(props: NewGoalDialogProps) {
  return useContext(ToastContext) ? <NewGoal {...props} /> : null
}

function NewGoal({ currency, context, ask, onCreated, onClose }: NewGoalDialogProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const rows = useQuery(GOAL_ROWS).data?.rows
  const { currencies } = useReferenceLists()
  const write = useSnapshotWrite([GOAL_ROWS.queryKey])
  const empty: GoalFields = { name: '', target: '', current: '', target_date: '', currency, fire: '' }
  const [data, setFields] = useState<GoalFields>(empty)
  const setData = (change: Partial<GoalFields>) => setFields(d => ({ ...d, ...change }))
  const [submitted, setSubmitted] = useState(false)
  const { confirmDiscard } = useUnsavedChanges(changed(data, empty))
  const fireGoal = rows?.find(isFireGoal)
  const { row: draft, error } = rowOf(data, data.fire === 'on' ? 'fire' : DRAFT_ID)
  const preview = draft ? planPreview(context.goals, draft, context.saving, context.today, context.rates, context.base) : null

  async function create(): Promise<boolean> {
    setSubmitted(true)
    if (!rows || !draft) {
      if (error) toast.error(t('data.common.saveFailed'), t(error))
      return false
    }
    const id = goalKey({ name: data.name }, rows.map(r => ({ rowid: r.rowid, id: r.id })), data.fire === 'on' && !fireGoal)
    const saved = await write(() => apiSend('/api/admin/goals', 'POST', { ...draft, id }), [t('goalsPage.form.added'), draft.name], t('data.common.saveFailed'))
    if (saved) onCreated(id)
    return saved
  }

  return (
    <FormDialog title={t('goalsPage.form.newTitle')} submitLabel={t('goalsPage.form.create')} onSubmit={create} submitDisabled={!rows}
      beforeCancel={changed(data, empty) ? confirmDiscard : undefined} onCancel={onClose}>
      <div className="gl-form gl-form--dialog">
        <GoalFieldInputs data={data} setData={setData} currencies={currencies} wasMonth={null} submitted={submitted}
          fire={fireGoal ? { offered: false, other: fireGoal.name } : { offered: true }} />
        <WhatHappens preview={preview} currency={data.currency} was={null} fmt={context.fmt} ask={ask} />
      </div>
    </FormDialog>
  )
}
