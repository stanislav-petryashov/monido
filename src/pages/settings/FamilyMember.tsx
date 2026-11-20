import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthMode, InviteLink, UserView, UsersView } from '../../domain/api'
import type { FamilyTelegramUser, TelegramPreferences } from '../../domain/familyTelegram'
import { apiSend } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { fmtDayTime } from '../../lib/formatters'
import { useCan, RIGHTS } from '../../lib/rights'
import { useConfirm, useToast } from '../../lib/notifyState'
import { Disclosure } from '../../components/ui/Disclosure'
import { Switch } from '../../components/ui/Switch'
import { Notice } from '../../components/ui/Notice'
import { AUTH_WRITES, PARAMETER_WRITES, reloadingAuth, useSnapshotWrite } from '../admin/adminQuery'
import { Field } from '../admin/ui/Field'
import { FormDialog } from '../admin/ui/FormDialog'
import { useSingleFlight } from '../admin/useSingleFlight'
import { familyTelegramQuery } from './familyTelegramQuery'

const WRITES = [...AUTH_WRITES, ...PARAMETER_WRITES, familyTelegramQuery.queryKey, ['admin']]
const MESSAGE_PREFERENCES = ['proposals', 'conversation'] as const
/** `provider`: the identity provider's host while sign-in through it is set up; `mode`: the family's sign-in mode */
export function FamilyMember({ member, user, preferences, bot, provider = null, mode = 'password', current, onInvited }: {
  member: { rowid: number; name: string }; user?: UserView; preferences?: FamilyTelegramUser
  bot: UsersView['bot']; provider?: string | null; mode?: AuthMode; current: boolean; onInvited: () => void
}) {
  const { t } = useTranslation()
  const canManage = useCan('manage'), canEdit = useCan('edit')
  const write = reloadingAuth(useSnapshotWrite(WRITES))
  const confirm = useConfirm(), toast = useToast()
  const [run, pending] = useSingleFlight()
  const [invite, setInvite] = useState<InviteLink | null>(null)
  const [providerInvite, setProviderInvite] = useState<InviteLink | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(member.name)
  const linked = !!user?.telegram
  // in the provider mode the provider account is how the member signs in: the line under the name says that one
  const status = mode === 'oidc' && provider
    ? t(user?.identity ? 'family.provider.linked' : 'family.provider.none', { provider })
    : user?.telegram ?? t(user?.invitePending ? 'family.pending' : 'ux.telegramNotConnected')

  /** The member's account in the app, created (no right to manage) when there is none yet */
  async function account(): Promise<UserView | undefined> {
    if (user) return user
    let saved: UsersView | undefined
    if (!await write(async () => { saved = await apiSend<UsersView>('/api/users', 'POST', { member: member.name, rights: { edit: true, vote: true, manage: false } }) }, null, t('data.common.saveFailed'))) return undefined
    return saved?.users.find(u => u.member === member.name)
  }
  async function connect() {
    await run(async () => {
      const target = await account()
      if (!target) return
      await write(async () => { setInvite(await apiSend<InviteLink>(`/api/users/${target.id}/invite`, 'POST')) }, null, t('users.inviteFailed'))
      onInvited()
    })
  }
  async function inviteToProvider() {
    await run(async () => {
      const target = await account()
      if (!target) return
      await write(async () => { setProviderInvite(await apiSend<InviteLink>(`/api/users/${target.id}/identity-invite`, 'POST')) }, null, t('users.inviteFailed'))
      onInvited()
    })
  }
  async function unlinkProvider() {
    if (!user || !provider) return
    if (!await confirm({ title: t('family.provider.unlinkTitle', { member: member.name, provider }), text: t('family.provider.unlinkText', { member: member.name, provider }), confirmLabel: t('family.provider.unlinkConfirm'), tone: 'danger' })) return
    await run(() => write(() => apiSend(`/api/users/${user.id}/identity`, 'DELETE'), t('family.provider.unlinked'), t('data.common.deleteFailed')))
  }
  const copy = async (link: string) => { if (await copyText(link)) toast.success(t('users.copied')); else toast.error(t('users.copyFailed')) }
  async function disconnect() {
    if (!user || !await confirm({ title: t('users.deleteTitle', { member: member.name }), text: t('users.deleteText'), confirmLabel: t('family.disableAccess'), tone: 'danger' })) return
    if (await run(() => write(() => apiSend(`/api/users/${user.id}`, 'DELETE'), t('users.deleted'), t('data.common.deleteFailed')))) setInvite(null)
  }
  async function remove() {
    if (!await confirm({ title: t('family.deleteTitle', { name: member.name }), text: t('family.deleteHint'), confirmLabel: t('family.deleteMember'), tone: 'danger' })) return
    await run(() => write(() => apiSend(`/api/admin/members/${member.rowid}`, 'DELETE'), t('data.params.memberDeleted'), t('data.common.deleteFailed')))
  }
  const savePreference = (key: keyof TelegramPreferences, value: boolean) => user && run(() => write(
    () => apiSend(`/api/family-telegram/users/${user.id}`, 'PUT', { [key]: value }), null, t('data.common.saveFailed')))
  const preference = (key: keyof TelegramPreferences) => <div className="family-toggle" key={key}>
    <span>{t(`family.preferences.${key}`)}</span>
    <Switch label={`${t(`family.preferences.${key}`)}: ${member.name}`} checked={preferences?.[key] ?? false} disabled={!canManage || pending || !preferences || !linked} onChange={next => void savePreference(key, next)} />
  </div>
  return <Disclosure className="family-member" titleAs="span" title={<span className="family-person">
    <span className="family-avatar" aria-hidden="true">{[...member.name][0]}</span>
    <span><span className="family-name">{member.name}{current && <span className="family-you"> · {t('users.you')}</span>}</span><span className="family-status">{status}</span></span>
  </span>}>
    <div className="family-member__body">
      <div className="family-row"><div><h3>{t('users.columns.telegram')}</h3><p className="note note--help">{linked ? user.telegram : t('family.personalHint')}</p></div>
        {canManage && <button type="button" className="btn btn--ghost" disabled={pending || !bot.username || !!bot.problem} onClick={() => void connect()}>{t(linked ? 'family.reconnect' : user?.invitePending ? 'family.newInvite' : 'family.connect')}</button>}
      </div>
      {!bot.configured && canManage && <p className="note note--help"><a className="link-accent" href="/settings/reminders#notification-bot">{t('family.connectBotFirst')}</a></p>}
      {provider && <div className="family-row"><div><h3>{t('family.provider.title', { provider })}</h3><p className="note note--help">{t(user?.identity ? 'family.provider.linked' : 'family.provider.none', { provider })}{!user?.identity && <> {t('family.provider.hint', { provider })}</>}</p></div>
        {canManage && (user?.identity
          ? <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => void unlinkProvider()}>{t('family.provider.unlink', { provider })}</button>
          : <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => void inviteToProvider()}>{t('family.provider.invite', { provider })}</button>)}
      </div>}
      {providerInvite && <Notice tone="neutral" title={t('users.inviteLink', { member: member.name })}>
        <span>{t('family.provider.inviteHint', { member: member.name, date: fmtDayTime(providerInvite.expiresAt) })}</span>
        <span className="family-invite-link">{providerInvite.link}</span>
        <button type="button" className="btn btn--ghost" onClick={() => void copy(providerInvite.link)}>{t('users.copy')}</button>
      </Notice>}
      {invite && <Notice tone="neutral" title={t('users.inviteLink', { member: member.name })}>
        <span>{t('users.inviteHint', { member: member.name, date: fmtDayTime(invite.expiresAt) })}</span>
        <span className="family-invite-link">{invite.link}</span>
        <button type="button" className="btn btn--ghost" onClick={() => void copy(invite.link)}>{t('users.copy')}</button>
      </Notice>}
      {user && <>
        {canManage && preferences && <div className="family-subgroup"><h3>{t('family.personalMessages')}</h3>{MESSAGE_PREFERENCES.map(preference)}<p className="note note--help">{t('family.conversationHint')}</p><a className="link-accent" href="/settings/reminders">{t('notifications.title')}</a></div>}
        <div className="family-subgroup"><h3>{t('family.access')}</h3>{canManage && preferences && mode !== 'oidc' && preference('signIn')}
          {RIGHTS.map(right => <div className="family-toggle" key={right}><span>{t(`rights.${right}`)}</span><Switch checked={user.rights[right]} label={t('users.rightLabel', { right: t(`rights.${right}`), member: member.name })} disabled={!canManage || pending} onChange={next => void run(() => write(() => apiSend(`/api/users/${user.id}`, 'PUT', { rights: { [right]: next } }), null, t('data.common.saveFailed')))} /></div>)}
        </div>
      </>}
      <div className="family-actions">
        {canEdit && (!user || canManage) && <button type="button" className="btn btn--quiet" onClick={() => { setName(member.name); setRenaming(true) }}>{t('family.rename')}</button>}
        {user && canManage ? <button type="button" className="btn btn--quiet" aria-label={t('users.deleteTitle', { member: member.name })} disabled={pending} onClick={() => void disconnect()}>{t('family.disableAccess')}</button>
          : !user && canEdit && <button type="button" className="btn btn--quiet" disabled={pending} onClick={() => void remove()}>{t('family.deleteMember')}</button>}
      </div>
    </div>
    {renaming && <FormDialog title={t('family.rename')} submitLabel={t('data.common.save')} submitDisabled={!name.trim() || name.trim() === member.name} onCancel={() => setRenaming(false)} onSubmit={async () => {
      const saved = await write(() => apiSend(`/api/members/${member.rowid}/rename`, 'POST', { name: name.trim() }), t('family.renamed'), t('data.common.saveFailed'))
      if (saved) setRenaming(false)
      return saved
    }}><Field label={t('family.name')}><input className="admin-input" maxLength={100} value={name} onChange={e => setName(e.target.value)} /></Field></FormDialog>}
  </Disclosure>
}
