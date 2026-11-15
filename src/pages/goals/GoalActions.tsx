import { useQuery } from '@tanstack/react-query'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { apiSend } from '../../lib/api'
import { ToastContext, useConfirm } from '../../lib/notifyState'
import { useSnapshotWrite } from '../admin/adminQuery'
import { RowMenu } from '../admin/ui/RowMenu'
import { setParam } from './address'
import { GOAL_ROWS } from './goalRows'

interface GoalActionsProps {
  id: string
  name: string
  onUpdate: () => void
  onEdit: () => void
}

/**
 * The chosen goal's «Update saved» (the page's one primary) and its «···» menu: «Edit goal» and «Delete goal…» with the
 * confirmation. Drawn only inside the app's notifications (a page rendered on its own shows no actions).
 */
export function GoalActions(props: GoalActionsProps) {
  return useContext(ToastContext) ? <Actions {...props} /> : null
}

function Actions({ id, name, onUpdate, onEdit }: GoalActionsProps) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const write = useSnapshotWrite([GOAL_ROWS.queryKey])
  const row = useQuery(GOAL_ROWS).data?.rows.find(r => r.id === id)

  async function remove() {
    if (!row || !(await confirm({ title: t('goalsPage.head.deleteTitle', { name }), confirmLabel: t('data.common.delete'), tone: 'danger' }))) return
    if (await write(() => apiSend(`/api/admin/goals/${row.rowid}`, 'DELETE'), [t('goalsPage.head.deleted'), name], t('data.common.deleteFailed'))) setParam('goal', null)
  }

  return (
    <>
      <button type="button" className="btn btn--primary" onClick={onUpdate}>{t('goalsPage.head.update')}</button>
      <RowMenu label={name} ariaLabel={t('goalsPage.head.menu')} items={[
        { label: t('goalsPage.head.edit'), onSelect: onEdit },
        { label: t('goalsPage.head.delete'), danger: true, disabled: !row, onSelect: () => void remove() },
      ]} />
    </>
  )
}
