import { Suspense, useState, type FormEvent } from 'react'
import { CLIENT_MODULES } from '../../modules/client'
import { Trans, useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Card } from '../../components/ui/Card'
import { Chip } from '../../components/ui/Chip'
import { Loading } from '../../components/ui/Loading'
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote'
import type { AuthSettingsView, UsersView } from '../../domain/api'
import { newPasswordProblem, type NewPasswordProblem } from '../../domain/password'
import { errorMessage } from '../../i18n/client'
import { apiSend } from '../../lib/api'
import { useConfirm, useToast } from '../../lib/notifyState'
import { useCan } from '../../lib/rights'
import { AUTH_WRITES, authSettingsQuery, botNamePoll, reloadingAuth, useAdminWrite, useLoadFailedToast, type AdminWrite } from '../admin/adminQuery'
import { Select } from '../admin/ui/Select'
import { Field } from '../admin/ui/Field'
import { NewPasswordFields } from '../admin/ui/NewPasswordFields'
import { FormDialog } from '../admin/ui/FormDialog'
import { OptionPicker } from '../admin/ui/OptionPicker'
import { CurrentPasswordField } from './CurrentPasswordField'
import { TokenField } from './BotToken'
import { useSaveToken } from './useSaveToken'
import { SignInSwitch } from './SignInSwitch'
import { OidcSwitch } from './OidcSwitch'
import { useCurrentPassword } from './useCurrentPassword'
import { useSingleFlight } from '../admin/useSingleFlight'

/** The mode sentence, a read-only note, and the warning after a fallback at start. */
function ModeLine({ mode, locked = false, fallback = null, stored = 'password' }: { mode: UsersView['mode']; locked?: boolean; fallback?: AuthSettingsView['fallback']; stored?: AuthSettingsView['stored'] }) {
  const { t } = useTranslation()
  if (mode !== 'password' && mode !== 'telegram' && mode !== 'oidc' && mode !== 'demo' && mode !== 'none') return null
  return (
    <>
      <p className="note note--help">{t(`users.signIn.mode.${mode}`)}</p>
      {locked && (
        <p className="note note--help">
          <Chip color="secondary">{t('users.signIn.locked')}</Chip>
        </p>
      )}
      {fallback && <p className="note note--help users-fallback"><Chip color="warning">{t(stored === 'oidc' ? 'users.signIn.fallbackOidc' : 'users.signIn.fallback')}</Chip></p>}
    </>
  )
}

/** The bot as anyone signed in sees it: not connected, a problem in words, or its name. */
function BotLine({ bot }: { bot: UsersView['bot'] }) {
  const { t } = useTranslation()
  if (!bot.configured) return <p className="note note--help">{t('users.signIn.bot.none')}</p>
  if (bot.problem) return <p className="note note--help note--error" role="alert">{errorMessage(bot.problem, undefined, bot.problem)}</p>
  return <p className="note note--help">{bot.username ? t('users.signIn.bot.ready', { username: `@${bot.username}` }) : t('users.signIn.bot.readyNoName')}</p>
}

/** Change the family password (password mode): the current one, the new one twice. */
function ChangePasswordDialog({ write, onClose }: { write: AdminWrite; onClose: () => void }) {
  const { t } = useTranslation()
  const currentPassword = useCurrentPassword()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [problem, setProblem] = useState<NewPasswordProblem>(null)

  async function submit() {
    const found = newPasswordProblem(password, repeat)
    setProblem(found)
    currentPassword.reset()
    if (found) return false
    // the caller holds a fresh session; everyone else signs in again
    return reloadingAuth(write)(() => apiSend('/api/auth-settings/password', 'POST', { current: currentPassword.current, password }), t('users.signIn.password.changed'), t('data.common.saveFailed'), currentPassword.handled)
  }

  return (
    <FormDialog title={t('users.signIn.password.title')} submitLabel={t('data.common.save')} onSubmit={submit} onCancel={onClose}>
      <div className="form-stack">
        <CurrentPasswordField label={t('users.signIn.password.current')} password={currentPassword} />
        <NewPasswordFields password={password} repeat={repeat} onPassword={setPassword} onRepeat={setRepeat} problem={problem} />
      </div>
    </FormDialog>
  )
}

/** The family password card (password mode): set or not, and the change dialog. */
function PasswordCard({ view, write }: { view: AuthSettingsView; write: AdminWrite }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Card plain className="mb-2">
      <h3 className="card-hd">{t('users.signIn.password.title')}</h3>
      <p className="note note--help">
        <Chip color={view.password.set ? 'success' : 'secondary'}>{t(view.password.set ? 'users.signIn.password.set' : 'users.signIn.password.notSet')}</Chip>
      </p>
      <div className="form-actions form-actions--start">
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)}>{t('users.signIn.password.change')}</button>
      </div>
      {open && <ChangePasswordDialog write={write} onClose={() => setOpen(false)} />}
    </Card>
  )
}

/** Replace the token of a connected bot */
function ReplaceTokenDialog({ write, onClose }: { write: AdminWrite; onClose: () => void }) {
  const { t } = useTranslation()
  const save = useSaveToken(write)
  const [token, setToken] = useState('')
  return (
    <FormDialog title={t('users.signIn.bot.title')} description={t('users.signIn.bot.replacedNote')} submitLabel={t('users.signIn.bot.check')} onSubmit={() => save(token)} onCancel={onClose}>
      <div className="form-stack"><TokenField value={token} onChange={setToken} /></div>
    </FormDialog>
  )
}

/** The Telegram bot card (every mode): connect, replace or disconnect; with the token in .env only its state. */
function BotCard({ view, write, hideHeading = false }: { view: AuthSettingsView; write: AdminWrite; hideHeading?: boolean }) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const save = useSaveToken(write)
  const [token, setToken] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [runCheck, checking] = useSingleFlight()
  const { bot } = view

  async function connect(e: FormEvent) {
    e.preventDefault()
    if (await runCheck(() => save(token))) setToken('')
  }

  async function disconnect() {
    if (!(await confirm({ title: t('users.signIn.bot.disconnectTitle'), text: t('users.signIn.bot.disconnectText'), confirmLabel: t('users.signIn.bot.disconnect'), tone: 'danger' }))) return
    await write(() => apiSend('/api/auth-settings/bot-token', 'DELETE'), null, t('data.common.deleteFailed'))
  }

  return (
    <Card plain className="mb-2">
      {!hideHeading && <h3 className="card-hd">{t('users.signIn.bot.title')}</h3>}
      {bot.source === null ? (
        <form className="form-stack" onSubmit={e => void connect(e)}>
          <p className="note note--help">{t('users.signIn.bot.none')}</p>
          <TokenField inset value={token} onChange={setToken} />
          <div className="form-actions form-actions--start">
            <button type="submit" className="btn btn--primary" disabled={checking}>{t('users.signIn.bot.check')}</button>
          </div>
        </form>
      ) : (
        <>
          <BotLine bot={{ configured: true, username: bot.username, problem: bot.problem }} />
          {bot.source === 'env' ? (
            <p className="note note--help"><Trans i18nKey="users.signIn.bot.envNote" components={{ code: <code /> }} /></p>
          ) : (
            <div className="form-actions form-actions--start">
              <button type="button" className="btn btn--ghost" onClick={() => setReplacing(true)}>{t('users.signIn.bot.replace')}</button>
              {/* while Telegram is the stored sign-in the bot is how people sign in: the server refuses (wrong_mode) */}
              {view.stored !== 'telegram' && <button type="button" className="btn btn--danger" onClick={() => void disconnect()}>{t('users.signIn.bot.disconnect')}</button>}
            </div>
          )}
        </>
      )}
      {replacing && <ReplaceTokenDialog write={write} onClose={() => setReplacing(false)} />}
    </Card>
  )
}

type BackChoice = 'keep' | 'set'

/** Back to the family password (telegram mode): keep the saved one or set a new one; with none saved, a new one. */
function BackDialog({ view, write, onClose }: { view: AuthSettingsView; write: AdminWrite; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const canKeep = view.password.set
  const [choice, setChoice] = useState<BackChoice>(canKeep ? 'keep' : 'set')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [problem, setProblem] = useState<NewPasswordProblem>(null)
  const setting = choice === 'set'

  async function submit() {
    const found = setting ? newPasswordProblem(password, repeat) : null
    setProblem(found)
    if (found) return false
    const body = setting ? { mode: 'password', password } : { mode: 'password' }
    const ok = await reloadingAuth(write)(() => apiSend('/api/auth-settings/mode', 'POST', body), null, t('data.common.saveFailed'))
    if (ok) toast.success(t('users.signIn.back.done'))
    return ok
  }

  return (
    <FormDialog title={t('users.signIn.back.title')} description={t(view.mode === 'oidc' ? 'users.signIn.back.confirmTextOidc' : 'users.signIn.back.confirmText')} submitLabel={t('users.signIn.back.title')} onSubmit={submit} onCancel={onClose}>
      <div className="form-stack">
        {/* what the switch ends in the modules (Claude's connections) */}
        {CLIENT_MODULES.flatMap(({ key, signInSwitchNotice: Warning }) => (Warning ? [<Suspense key={key} fallback={null}><Warning /></Suspense>] : []))}
        {canKeep && (
          <Field label={t('users.signIn.password.title')} group>
            <OptionPicker<BackChoice> value={choice} onChange={setChoice}
              options={[{ value: 'keep', label: t('users.signIn.back.keep') }, { value: 'set', label: t('users.signIn.back.set') }]} />
          </Field>
        )}
        {setting && <NewPasswordFields password={password} repeat={repeat} onPassword={setPassword} onRepeat={setRepeat} problem={problem} />}
      </div>
    </FormDialog>
  )
}

/** Telegram fell back at start: stay on the family password for good, instead of Telegram coming back at a restart */
function KeepPassword({ write }: { write: AdminWrite }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [run, busy] = useSingleFlight()
  async function keep() {
    if (await reloadingAuth(write)(() => apiSend('/api/auth-settings/mode', 'POST', { mode: 'password' }), null, t('data.common.saveFailed'))) toast.success(t('users.signIn.back.done'))
  }
  return (
    <div className="form-actions form-actions--start mb-2">
      <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void run(keep)}>{t('users.signIn.keepPassword')}</button>
    </div>
  )
}

const SIGN_IN_MODES = ['password', 'telegram', 'oidc'] as const

/** Back from the provider's test sign-in (`?oidc_test=` or `?sign_in_error=` on this page): its panel opens again */
const backFromProvider = () => /[?&](oidc_test|sign_in_error)=/.test(window.location.search)

function ModePicker({ view, write }: { view: AuthSettingsView; write: AdminWrite }) {
  const { t } = useTranslation()
  const [choice, setChoice] = useState<AuthSettingsView['mode']>(() => (view.mode === 'password' && (view.switchToOidc.proof || backFromProvider()) ? 'oidc' : view.mode))
  const close = () => setChoice(view.mode)
  return (
    <>
      <Field variant="inset" label={t('users.signIn.choose')}>
        <Select value={choice} disabled={view.locked || view.mode === 'none'} onChange={e => setChoice(e.target.value as AuthSettingsView['mode'])}>
          {view.mode === 'none' && <option value="none">{t('users.signIn.options.none')}</option>}
          {SIGN_IN_MODES.map(mode => <option key={mode} value={mode}>{t(`users.signIn.options.${mode}`)}</option>)}
        </Select>
      </Field>
      {!view.locked && choice === 'telegram' && view.mode !== 'telegram' && <SignInSwitch onCancel={close} />}
      {!view.locked && choice === 'oidc' && view.mode === 'password' && <OidcSwitch view={view} onCancel={close} />}
      {!view.locked && choice === 'oidc' && view.mode === 'telegram' && <p className="note note--help">{t('users.signIn.oidc.fromTelegram')}</p>}
      {!view.locked && choice === 'password' && view.mode !== 'password' && <BackDialog view={view} write={write} onClose={close} />}

    </>
  )
}

/** Separate placement for the family page; uses the same cached settings and writes. */
export function BotSettings({ users }: { users: UsersView }) {
  const canManage = useCan('manage')
  const query = useQuery({ ...authSettingsQuery, enabled: canManage && users.mode !== 'demo', refetchInterval: botNamePoll })
  const write = useAdminWrite([...AUTH_WRITES, ['admin', 'reminders']])
  if (users.mode === 'demo' || !canManage) return <BotLine bot={users.bot} />
  if (!query.data) return query.isError ? <BotLine bot={users.bot} /> : <Loading className="reminder-state" />
  return <BotCard view={query.data} write={write} hideHeading />
}

/**
 * The Sign-in section of the Users page. A manager reads GET /api/auth-settings: the mode line, the family password
 * card (password mode), the bot card (every mode) and the way back to the password (telegram mode). Anyone else sees the mode and the bot from the users view and the view-only note.
 */
export function SignInSettings({ users, hideBot = false }: { users: UsersView; hideBot?: boolean }) {
  const canManage = useCan('manage')
  // the demo has no sign-in to manage (the server refuses /api/auth-settings there): everyone gets its sentence only
  const demo = users.mode === 'demo'
  const query = useQuery({ ...authSettingsQuery, enabled: canManage && !demo, refetchInterval: botNamePoll })
  useLoadFailedToast(query)
  const write = useAdminWrite([...AUTH_WRITES, ['admin', 'reminders']])

  if (demo) return <ModeLine mode="demo" />
  if (!canManage) {
    return (
      <>
        <ModeLine mode={users.mode} />
        {!hideBot && <BotLine bot={users.bot} />}
        <ViewOnlyNote right="manage" />
      </>
    )
  }
  const view = query.data
  // a failed load is told once, by the notification; the section keeps the mode line everyone sees
  if (!view) return query.isError ? <ModeLine mode={users.mode} /> : <Loading className="reminder-state" />
  return (
    <>
      <ModeLine mode={view.mode} locked={view.locked} fallback={view.fallback} stored={view.stored} />
      {view.fallback && !view.locked && <KeepPassword write={write} />}
      {view.mode === 'password' && <PasswordCard view={view} write={write} />}
      <ModePicker key={view.mode} view={view} write={write} />
      {!hideBot && <BotCard view={view} write={write} />}
    </>
  )
}
