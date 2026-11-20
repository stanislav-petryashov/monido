import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { CLIENT_MODULES } from '../../modules/client'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../../components/ui/Card'
import { Chip } from '../../components/ui/Chip'
import { Notice } from '../../components/ui/Notice'
import { ProgressTrack } from '../../components/ui/ProgressTrack'
import { Loading } from '../../components/ui/Loading'
import { PageError } from '../../components/PageError'
import type { UsersView } from '../../domain/api'
import { apiSend } from '../../lib/api'
import { AUTH_WRITES, authSettingsQuery, reloadingAuth, tableQuery, useAdminWrite, usersQuery } from '../admin/adminQuery'
import { Field } from '../admin/ui/Field'
import { Select } from '../admin/ui/Select'
import { useSingleFlight } from '../admin/useSingleFlight'
import { SetupBar } from '../setup/SetupBar'
import { TelegramSignIn } from '../TelegramSignIn'
import { TokenField } from './BotToken'
import { useSaveToken } from './useSaveToken'
import { CurrentPasswordField } from './CurrentPasswordField'
import { useCurrentPassword } from './useCurrentPassword'
import { familyTelegramQuery } from './familyTelegramQuery'
import '../../styles/setup.css'

const WRITES = [...AUTH_WRITES, familyTelegramQuery.queryKey, ['admin', 'members']]
const FRESH = { refetchInterval: 10_000, refetchOnWindowFocus: true, refetchOnReconnect: true } as const

/** One active task; readiness always comes from the server, including the selected account's fresh proof. */
export function SignInSwitch({ onCancel }: { onCancel?: () => void }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const query = useQuery({ ...authSettingsQuery, ...FRESH })
  const offers = query.data?.mode === 'password' && !query.data.locked
  const users = useQuery({ ...usersQuery, ...FRESH, enabled: offers })
  const members = useQuery({ ...tableQuery<{ name: string; rowid: number }>('members'), enabled: offers })
  const preferences = useQuery({ ...familyTelegramQuery, ...FRESH, enabled: offers })
  const write = useAdminWrite(WRITES)
  const saveToken = useSaveToken(write)
  const password = useCurrentPassword()
  const [run, busy] = useSingleFlight()
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [grant, setGrant] = useState(false)
  const [prepared, setPrepared] = useState<number | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)
  const [editingBot, setEditingBot] = useState(false)
  const title = useRef<HTMLHeadingElement>(null)
  const view = query.data
  const rows = members.data?.rows ?? []
  const person = selected ?? view?.switchToTelegram.proof?.member ?? rows[0]?.name ?? ''
  const user = users.data?.users.find(u => u.member === person)
  const signIn = preferences.data?.users.find(p => p.userId === user?.id)?.signIn === true
  const proof = view?.switchToTelegram.proof
  const valid = !!(view?.switchToTelegram.bot && !view.bot.problem && user?.telegram && user.rights.manage && signIn && proof?.manage && proof.member === person)
  const stage = !view?.switchToTelegram.bot || !!view.bot.problem || editingBot ? 0 : valid && !editingProfile ? 2 : 1
  const canProve = !!(user?.rights.manage && signIn && (prepared === user.id || user.telegram))
  useEffect(() => { title.current?.focus({ preventScroll: true }) }, [stage])

  async function refresh() {
    await Promise.all(WRITES.map(queryKey => client.invalidateQueries({ queryKey })))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    await run(async () => {
      if (stage === 0) {
        if (view?.switchToTelegram.bot && !view.bot.problem) { setEditingBot(false); return }
        if (token.trim() && await saveToken(token)) { setToken(''); setEditingBot(false) }
        return
      }
      if (stage === 1) {
        if (!rows.length) {
          if (name.trim() && await write(() => apiSend('/api/admin/members', 'POST', { name: name.trim() }), null, t('data.common.saveFailed'))) setSelected(name.trim())
          return
        }
        if (!person || (!user?.rights.manage && !grant)) return
        let account = user
        if (!account) {
          let saved: UsersView | undefined
          if (!await write(async () => { saved = await apiSend<UsersView>('/api/users', 'POST', { member: person, rights: { edit: true, vote: true, manage: true } }) }, null, t('data.common.saveFailed'))) return
          account = saved?.users.find(u => u.member === person)
        } else if (!account.rights.manage && !await write(() => apiSend(`/api/users/${account!.id}`, 'PUT', { rights: { manage: true } }), null, t('data.common.saveFailed'))) return
        if (!account) return
        if (!signIn && !await write(() => apiSend(`/api/family-telegram/users/${account.id}`, 'PUT', { signIn: true }), null, t('data.common.saveFailed'))) return
        setPrepared(account.id); setEditingProfile(false)
        return
      }
      if (!valid || !password.current) return
      password.reset()
      // Recheck before committing; the server also validates the ticket and password atomically.
      const fresh = await query.refetch()
      if (fresh.isError || !fresh.data?.switchToTelegram.proof?.manage || fresh.data.switchToTelegram.proof.member !== person || !fresh.data.switchToTelegram.bot) return
      await reloadingAuth(write)(() => apiSend('/api/auth-settings/mode', 'POST', { mode: 'telegram', current: password.current }), t('users.signIn.switch.done'), t('data.common.saveFailed'), password.handled)
    })
  }

  if (!view) return query.isError ? <PageError className="note note--help note--error">{t('data.common.loadFailed')}</PageError> : <Loading />
  if (!offers) return null
  if (users.isError || members.isError || preferences.isError) return <PageError>{t('data.common.loadFailed')}</PageError>
  if (!users.data || !members.data || !preferences.data) return <Loading />
  const excluded = rows.filter(member => {
    const account = users.data.users.find(u => u.member === member.name)
    return !account?.telegram || !preferences.data.users.find(p => p.userId === account.id)?.signIn
  }).map(member => member.name)
  const back = () => { password.setCurrent(''); setPrepared(null); setEditingProfile(true); if (stage === 1) setEditingBot(true) }
  const cancel = onCancel && <button type="button" className="btn btn--ghost" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
  return <Card plain className="mb-2">
    <div className="form-stack">
      <h3 className="card-hd">{t('users.signIn.switch.title')}</h3>
      <p className="note note--help">{t('users.signIn.switch.flow.intro')}</p>
      <p className="progress-label" aria-live="polite">{t('users.signIn.switch.flow.progress', { step: stage + 1, title: t(`users.signIn.switch.flow.stage${stage}`) })}</p>
      <ProgressTrack pct={stage / 3 * 100} label={t('users.signIn.switch.title')} />
      <h4 ref={title} tabIndex={-1} className="setup-card__title">{t(`users.signIn.switch.flow.heading${stage}`)}</h4>
      <form className="form-stack" onSubmit={event => void submit(event)}>
        {stage === 0 && (view.bot.source === 'env' && view.bot.problem ? <p role="alert" className="note note--help note--error">{t('users.signIn.switch.flow.envProblem')}</p> : view.switchToTelegram.bot && !view.bot.problem ? <p className="note note--help">{t('users.signIn.bot.ready', { username: view.bot.username ? `@${view.bot.username}` : '' })}</p> : <>
          <p className="note note--help">{t('users.signIn.switch.flow.botHint')} <a className="link-accent" href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">{t('users.signIn.switch.flow.botFather')}</a></p>
          <TokenField inset value={token} onChange={setToken} />
        </>)}
        {stage === 1 && <>
          {rows.length ? <Field variant="inset" label={t('users.signIn.switch.flow.profile')}><Select value={person} disabled={busy} onChange={event => { setSelected(event.target.value); setGrant(false); setPrepared(null); setEditingProfile(true) }}>{rows.map(member => <option key={member.rowid} value={member.name}>{member.name}</option>)}</Select></Field> : <Field variant="inset" label={t('family.name')}><input className="admin-input" maxLength={100} value={name} onChange={event => setName(event.target.value)} /></Field>}
          {user?.telegram && <p><Chip color="success">{t('users.signIn.switch.flow.linked', { account: user.telegram })}</Chip></p>}
          {!!rows.length && <p className="note note--help">{t(user?.telegram ? 'users.signIn.switch.flow.linkedHint' : 'users.signIn.switch.flow.linkHint')}</p>}
          {!!rows.length && !user?.rights.manage && <label className="setup-choice"><input className="setup-choice__input" type="checkbox" checked={grant} disabled={busy} onChange={event => setGrant(event.target.checked)} /><span className="setup-choice__body"><span className="setup-choice__title">{t('users.signIn.switch.flow.grant')}</span><span>{t('users.signIn.switch.flow.grantHint')}</span></span></label>}
          {user?.rights.manage && <p className="note note--help">{t('users.signIn.switch.flow.manager')}</p>}
          {user && !signIn && <p className="note note--help">{t('users.signIn.switch.flow.enableSignIn')}</p>}
        </>}
        {stage === 2 && <>
          <p role="status"><Chip color="success">{t('users.signIn.switch.flow.ready', { member: person, account: user?.telegram })}</Chip></p>
          {!!excluded.length && <Notice tone="warning" title={t('users.signIn.switch.flow.excluded', { members: excluded.join(', ') })}>{t('users.signIn.switch.flow.excludedHint')}</Notice>}
          {CLIENT_MODULES.flatMap(({ key, signInSwitchNotice: Warning }) => (Warning ? [<Suspense key={key} fallback={null}><Warning /></Suspense>] : []))}
          <p className="note note--help">{t('users.signIn.switch.confirmText')}</p>
          <CurrentPasswordField label={t('users.signIn.switch.confirmPassword')} password={password} />
        </>}
        {!(stage === 1 && canProve && user) && <SetupBar onBack={stage > 0 ? back : undefined} left={cancel} busy={busy} primary={t(stage === 0 ? view.switchToTelegram.bot && !view.bot.problem ? 'data.setup.next' : 'users.signIn.bot.check' : stage === 2 ? 'users.signIn.switch.button' : !rows.length ? 'family.add' : 'users.signIn.switch.flow.continue')} disabled={busy || (stage === 0 ? !!view.bot.problem && view.bot.source === 'env' || (!view.switchToTelegram.bot || !!view.bot.problem) && !token.trim() : stage === 2 ? !valid || !password.current : !rows.length ? !name.trim() : !user?.rights.manage && !grant)} />}
      </form>
      {stage === 1 && canProve && user && <TelegramSignIn key={`${user.id}:${view.bot.username}`} proof={{ userId: user.id, actions: state => <SetupBar {...state} onBack={back} left={cancel} />, onDone: () => { setEditingProfile(false); void refresh() } }} />}
    </div>
  </Card>
}
