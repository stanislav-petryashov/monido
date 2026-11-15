import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { UsersView } from '../../domain/api'
import type { FamilyTelegramPairing } from '../../domain/familyTelegram'
import { apiSend } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { fmtDayTime } from '../../lib/formatters'
import { useConfirm, useToast } from '../../lib/notifyState'
import { Disclosure, DisclosureGroup } from '../../components/ui/Disclosure'
import { Switch } from '../../components/ui/Switch'
import { Notice } from '../../components/ui/Notice'
import { useAdminWrite } from '../admin/adminQuery'
import { useSingleFlight } from '../admin/useSingleFlight'
import { familyTelegramQuery } from './familyTelegramQuery'

const MESSAGE_PREFERENCES = ['proposals', 'conversation'] as const
export function FamilyChats({ bot, actions }: { bot: UsersView['bot']; actions?: ReactNode }) {
  const { t } = useTranslation()
  const confirm = useConfirm(), toast = useToast()
  const [pairing, setPairing] = useState<FamilyTelegramPairing | null>(null)
  const query = useQuery({ ...familyTelegramQuery, refetchInterval: () => pairing && Date.parse(pairing.expiresAt) > Date.now() ? 2000 : false })
  const write = useAdminWrite([familyTelegramQuery.queryKey, ['admin', 'reminders']])
  const [run, pending] = useSingleFlight()
  const client = useQueryClient()
  useEffect(() => {
    if (pairing && query.data) void client.invalidateQueries({ queryKey: ['admin', 'reminders'] })
  }, [client, pairing, query.data])
  const groups = query.data?.groups ?? []
  return <>
    <DisclosureGroup>{groups.map(group => <div key={group.chatId}><div className="notification-recipient"><div><strong>{group.title}</strong><span className="note">{t('notifications.sharedChat')}</span></div><Switch label={t('notifications.forMember', { name: group.title })} checked={group.reminders} disabled={pending} onChange={reminders => void run(() => write(() => apiSend(`/api/family-telegram/groups/${group.chatId}`, 'PUT', { reminders }), null, t('data.common.saveFailed')))} /></div><Disclosure title={t('notifications.chatSettings')} variant="inline" className="family-chat">
      {MESSAGE_PREFERENCES.map(key => <div className="family-toggle" key={key}>
        <span>{t(`family.preferences.${key}`)}</span><Switch label={`${t(`family.preferences.${key}`)}: ${group.title}`} checked={group[key]} disabled={pending} onChange={value => void run(() => write(() => apiSend(`/api/family-telegram/groups/${group.chatId}`, 'PUT', { [key]: value }), null, t('data.common.saveFailed')))} />
      </div>)}
      <p className="note">{t('family.groupConversationHint')}</p>
      <div className="family-actions"><button className="btn btn--quiet" type="button" disabled={pending} onClick={async () => {
        if (await confirm({ title: t('family.disconnectChat'), text: t('family.disconnectChatHint', { name: group.title }), confirmLabel: t('family.disconnectChat'), tone: 'danger' })) {
          await run(() => write(() => apiSend(`/api/family-telegram/groups/${group.chatId}`, 'DELETE'), null, t('data.common.deleteFailed')))
        }
      }}>{t('family.disconnectChat')}</button></div>
    </Disclosure></div>)}</DisclosureGroup>
    {pairing && <Notice tone="neutral" title={t('family.pairTitle')}>
      <p>{t('family.pairHint', { date: fmtDayTime(pairing.expiresAt) })}</p>
      <code className="family-invite-link">{pairing.command}</code>
      <div className="family-actions"><button className="btn btn--ghost" type="button" onClick={async () => { if (await copyText(pairing.command)) toast.success(t('users.copied')); else toast.error(t('users.copyFailed')) }}>{t('users.copy')}</button>
        <button className="btn btn--quiet" type="button" onClick={() => setPairing(null)}>{t('users.close')}</button></div>
    </Notice>}
    <div className="family-actions"><button className="btn btn--ghost" type="button" disabled={pending || !bot.username || !!bot.problem || !query.data} onClick={() => void run(() => write(async () => setPairing(await apiSend<FamilyTelegramPairing>('/api/family-telegram/pairing', 'POST')), null, t('data.common.saveFailed')))}>{t('family.addChat')}</button>{actions}</div>
  </>
}
