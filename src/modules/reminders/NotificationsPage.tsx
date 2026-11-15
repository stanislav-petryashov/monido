import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { RemindersView } from '../../domain/api'
import { apiSend } from '../../lib/api'
import { useCan } from '../../lib/rights'
import { useConfirm } from '../../lib/notifyState'
import { Disclosure } from '../../components/ui/Disclosure'
import { Switch } from '../../components/ui/Switch'
import { Link } from '../../components/ui/Link'
import { Loading } from '../../components/ui/Loading'
import { usersQuery, useAdminWrite } from '../../pages/admin/adminQuery'
import { AdminReadNotice } from '../../pages/admin/ui/AdminReadNotice'
import { SettingsSection } from '../../pages/admin/ui/SettingsSection'
import { Field } from '../../pages/admin/ui/Field'
import { Select } from '../../pages/admin/ui/Select'
import { useSingleFlight } from '../../pages/admin/useSingleFlight'
import { BotSettings } from '../../pages/settings/SignInSettings'
import { FamilyChats } from '../../pages/settings/FamilyChats'
import { familyTelegramQuery } from '../../pages/settings/familyTelegramQuery'
import { RemindersBlock } from './RemindersBlock'
import { remindersQuery } from './remindersQuery'
import '../../pages/settings/settings-navigation.css'
import '../../pages/settings/family-settings.css'
import './notifications.css'

export function NotificationsPage() {
  const { t } = useTranslation()
  const canManage = useCan('manage')
  const users = useQuery(usersQuery)
  const reminders = useQuery(remindersQuery)
  const telegram = useQuery({ ...familyTelegramQuery, enabled: canManage && users.data?.mode !== 'demo' })
  const write = useAdminWrite([familyTelegramQuery.queryKey, remindersQuery.queryKey])
  const [run, pending] = useSingleFlight()
  const confirm = useConfirm()
  const client = useQueryClient()
  const [testing, setTesting] = useState(false)
  const [selected, setSelected] = useState('')
  const candidates = reminders.data?.recipients.filter(r => r.enabled) ?? []
  const recipientId = candidates.some(r => r.id === selected) ? selected : candidates[0]?.id ?? ''
  const editable = canManage && users.data?.mode !== 'demo'
  return <div className="general-settings family-settings notifications-settings">
    <AdminReadNotice queries={[users, reminders, telegram]} />
    <SettingsSection title={t('notifications.channels')} description={t('notifications.channelsHint')}>
      {users.data ? <div id="notification-bot">
        {users.data.bot.configured && !users.data.bot.problem ? <Disclosure title={t('users.signIn.bot.title')} hint={users.data.bot.username ? `@${users.data.bot.username}` : undefined}>
          <BotSettings users={users.data} />
        </Disclosure> : <BotSettings users={users.data} />}
      </div> : users.isPending && <Loading />}
    </SettingsSection>
    {editable && <SettingsSection title={t('notifications.recipients')} description={t('notifications.recipientsHint')}>
      <div className="notification-recipients">{users.data?.users.filter(u => u.telegram).map(user => {
        const preferences = telegram.data?.users.find(p => p.userId === user.id)
        return <div className="notification-recipient" key={user.id}><div><strong>{user.member}</strong><span className="note">{user.telegram}</span></div>
          <Switch label={t('notifications.forMember', { name: user.member })} checked={preferences?.reminders ?? false} disabled={pending || !preferences} onChange={reminders => void run(() => write(() => apiSend(`/api/family-telegram/users/${user.id}`, 'PUT', { reminders }), null, t('data.common.saveFailed')))} />
        </div>
      })}</div>
      {reminders.data?.recipients.filter(r => r.kind === 'legacy').map(r => <div className="notification-recipient" key={r.id}><div><strong>{r.title || t('modules.reminders.noName')}</strong><span className="note">{t('notifications.legacy')}</span></div>
        <button type="button" className="btn btn--quiet" disabled={pending} onClick={async () => {
          if (await confirm({ title: t('family.disconnectChat'), text: t('family.disconnectChatHint', { name: r.title }), confirmLabel: t('family.disconnectChat'), tone: 'danger' })) await run(() => write(() => apiSend('/api/reminders/link', 'DELETE'), null, t('data.common.saveFailed')))
        }}>{t('modules.reminders.unlink')}</button>
      </div>)}
      {users.data && <FamilyChats bot={users.data.bot} actions={<>
        {!testing && <button className="btn btn--ghost" type="button" disabled={!reminders.data?.configured || !candidates.length || pending} onClick={() => setTesting(true)}>{t('notifications.test')}</button>}
        <Link to="/settings/family" className="link-accent">{t('notifications.linkPersonal')}</Link>
      </>} />}
      {testing && <div className="notification-test"><p className="note">{t('notifications.testHint')}</p>
        <Field variant="inset" label={t('notifications.sendTo')}><Select value={recipientId} disabled={pending} onChange={e => setSelected(e.target.value)}>{candidates.map(r => <option key={r.id} value={r.id}>{r.title || t('modules.reminders.noName')}</option>)}</Select></Field>
        <div className="family-actions"><button className="btn btn--ghost" type="button" disabled={pending} onClick={() => setTesting(false)}>{t('common.cancel')}</button>
          <button className="btn btn--primary" type="button" disabled={pending || !recipientId} onClick={() => void run(async () => {
            const ok = await write(() => apiSend<RemindersView>('/api/reminders/test-recipient', 'POST', { recipientId }), t('modules.reminders.sent'), t('modules.reminders.sendFailed'))
            if (ok) setTesting(false)
            else await client.invalidateQueries({ queryKey: remindersQuery.queryKey })
          })}>{t('notifications.sendTest')}</button></div>
      </div>}
    </SettingsSection>}
    <SettingsSection title={t('notifications.schedule')} description={t('notifications.scheduleHint')}><RemindersBlock /></SettingsSection>
  </div>
}
