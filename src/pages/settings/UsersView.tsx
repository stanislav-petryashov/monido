import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { apiSend } from '../../lib/api'
import { useCan } from '../../lib/rights'
import { Loading } from '../../components/ui/Loading'
import { DisclosureGroup } from '../../components/ui/Disclosure'
import { AUTH_WRITES, PARAMETER_WRITES, usersQuery, useSnapshotWrite } from '../admin/adminQuery'
import { useAdminRows } from '../admin/useAdminRows'
import { AdminReadNotice } from '../admin/ui/AdminReadNotice'
import { SettingsSection } from '../admin/ui/SettingsSection'
import { Field } from '../admin/ui/Field'
import { FormDialog } from '../admin/ui/FormDialog'
import { SignInSettings } from './SignInSettings'
import { FamilyMember } from './FamilyMember'
import { familyTelegramQuery } from './familyTelegramQuery'
import './settings-navigation.css'
import './family-settings.css'

export function UsersView() {
  const { t } = useTranslation()
  const canEdit = useCan('edit'), canManage = useCan('manage')
  const query = useQuery(usersQuery)
  const members = useAdminRows<{ name: string; rowid: number }>('members')
  const telegram = useQuery({ ...familyTelegramQuery, enabled: canManage && !!query.data && query.data.mode !== 'demo' })
  const write = useSnapshotWrite([...PARAMETER_WRITES, ...AUTH_WRITES])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const data = query.data
  if (!data) return <><AdminReadNotice queries={[query, members.query]} />{query.isPending && <Loading />}</>
  return <div className="general-settings family-settings">
    <AdminReadNotice queries={[query, members.query, telegram]} />
    <SettingsSection title={t('family.membersTitle')} description={t('family.membersHint')}>
      <DisclosureGroup>{[...members.rows].sort((a, b) => a.name.localeCompare(b.name)).map(member => {
        const user = data.users.find(u => u.member === member.name)
        return <FamilyMember key={member.rowid} member={member} user={user} preferences={telegram.data?.users.find(u => u.userId === user?.id)} bot={data.bot} current={!!user && user.id === data.meId} onInvited={() => void query.refetch()} />
      })}</DisclosureGroup>
      {members.query.isPending && <Loading className="reminder-state" />}
      {canEdit && <div className="family-actions"><button className="btn btn--ghost" type="button" disabled={members.query.data === undefined} onClick={() => { setName(''); setAdding(true) }}>{t('family.add')}</button></div>}
    </SettingsSection>
    <SettingsSection title={t('users.section.signIn')}><SignInSettings users={data} hideBot /></SettingsSection>
    {adding && <FormDialog title={t('family.add')} submitLabel={t('family.add')} submitDisabled={!name.trim()} onCancel={() => setAdding(false)} onSubmit={async () => {
      const saved = await write(() => apiSend('/api/admin/members', 'POST', { name: name.trim() }), t('data.params.memberAdded'), t('data.common.saveFailed'))
      if (saved) setAdding(false)
      return saved
    }}><Field label={t('family.name')}><input className="admin-input" maxLength={100} value={name} onChange={e => setName(e.target.value)} /></Field></FormDialog>}
  </div>
}
