import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { apiSend, ApiError } from '../../lib/api'
import { PARAMETER_WRITES, tableQuery, useAdminWrite } from './adminQuery'
import type { Member } from './shared'
import { TagList } from './ui/TagList'
import { useSingleFlight } from './useSingleFlight'

export interface MembersBlockProps {
  /** Sorted by the caller */
  members: Member[]
  inputLabel?: string
  /** No "×", no add field (Parameters without the edit right) */
  readOnly?: boolean
  /** The add field stays, the "×" goes (the wizard) */
  readOnlyRemove?: boolean
  /** Called after a successful add with the trimmed name; a 409 (duplicate) counts too: the name exists, no error is shown and the list is read again */
  onAdded?: (name: string) => void
}

/** The members as tags with their writes: POST /api/admin/members, DELETE /api/admin/members/:rowid */
export function MembersBlock({ members, inputLabel, readOnly = false, readOnlyRemove = false, onAdded }: MembersBlockProps) {
  const { t } = useTranslation()
  const write = useAdminWrite(PARAMETER_WRITES)
  const queryClient = useQueryClient()
  const [newMember, setNewMember] = useState('')
  const [runAdd] = useSingleFlight()

  const addMember = () => runAdd(async () => {
    const name = newMember.trim()
    if (!name) return
    let exists = false
    const handled = onAdded ? (e: unknown) => (exists = e instanceof ApiError && e.status === 409) : undefined
    const saved = await write(() => apiSend('/api/admin/members', 'POST', { name }), [t('data.params.memberAdded'), name], t('data.common.saveFailed'), handled)
    if (!saved && !exists) return
    // the name exists on the server but maybe not in a stale list: read it again so it shows
    if (exists) void queryClient.invalidateQueries({ queryKey: tableQuery('members').queryKey })
    setNewMember(cur => (cur === newMember ? '' : cur))
    onAdded?.(name)
  })

  async function deleteMember(rowid: number) {
    await write(() => apiSend(`/api/admin/members/${rowid}`, 'DELETE'), t('data.params.memberDeleted'), t('data.common.deleteFailed'))
  }

  // the wizard (readOnlyRemove): the names without "×" in the same list as the add field
  const fixed = readOnlyRemove && !readOnly
  const tags = members.map(m => ({ key: m.rowid, text: m.name, fixed }))
  return (
    <TagList label={t('data.params.members')} tags={tags} readOnly={readOnly} onRemove={key => deleteMember(Number(key))}
      inputLabel={inputLabel} value={newMember} onChange={setNewMember} onAdd={addMember} placeholder={t('data.params.memberPlaceholder')} />
  )
}
