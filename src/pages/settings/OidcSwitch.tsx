import { Suspense, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/Card'
import { Chip } from '../../components/ui/Chip'
import type { AuthSettingsView } from '../../domain/api'
import { apiSend } from '../../lib/api'
import { browser } from '../../lib/browser'
import { providerErrorKey } from '../../lib/providerReturn'
import { copyText } from '../../lib/clipboard'
import { useToast } from '../../lib/notifyState'
import { CLIENT_MODULES } from '../../modules/client'
import { AUTH_WRITES, reloadingAuth, useAdminWrite, usersQuery } from '../admin/adminQuery'
import { Field } from '../admin/ui/Field'
import { Select } from '../admin/ui/Select'
import { useSingleFlight } from '../admin/useSingleFlight'
import { CurrentPasswordField } from './CurrentPasswordField'
import { useCurrentPassword } from './useCurrentPassword'

/** The refusal a test sign-in came back with (`?sign_in_error=` on this page), read once */
const returnedError = () => new URLSearchParams(window.location.search).get('sign_in_error')

/**
 * The switch to the identity provider, from the family password: the setup as the server reads it (or what is missing),
 * the redirect URI to register, a manager's test sign-in at the provider, then the family password to switch.
 */
export function OidcSwitch({ view, onCancel }: { view: AuthSettingsView; onCancel?: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const setup = view.switchToOidc
  const usable = setup.configured && setup.problem === null
  const users = useQuery({ ...usersQuery, enabled: usable })
  const write = useAdminWrite(AUTH_WRITES)
  const password = useCurrentPassword()
  const [run, busy] = useSingleFlight()
  const [selected, setSelected] = useState<number | null>(null)
  const [refused] = useState(returnedError)
  const provider = setup.provider ?? t('auth.oidcInvite.provider')
  const managers = users.data?.users.filter(u => u.rights.manage) ?? []
  const chosen = selected ?? managers[0]?.id ?? null
  const proof = setup.proof?.manage ? setup.proof : null

  async function test() {
    if (chosen === null) return
    await run(() => write(async () => {
      const { url } = await apiSend<{ url: string }>('/api/auth/oidc/test', 'POST', { userId: chosen, return: window.location.pathname })
      browser.go(url)
    }, null, t('data.common.saveFailed')))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!password.current || busy) return
    password.reset()
    await run(() => reloadingAuth(write)(() => apiSend('/api/auth-settings/mode', 'POST', { mode: 'oidc', current: password.current }),
      t('users.signIn.oidc.done', { provider }), t('data.common.saveFailed'), password.handled))
  }

  async function copy(text: string) {
    if (await copyText(text)) toast.success(t('users.copied'))
    else toast.error(t('users.copyFailed'))
  }

  const cancel = onCancel && <button type="button" className="btn btn--ghost" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
  return (
    <Card plain className="mb-2">
      <div className="form-stack">
        <h3 className="card-hd">{t('users.signIn.oidc.title')}</h3>
        {!usable ? <>
          <p role="alert" className="note note--help note--error">{t(`users.signIn.oidc.problem.${setup.problem ?? 'issuer_missing'}`)}</p>
          {cancel && <div className="form-actions form-actions--start">{cancel}</div>}
        </> : <>
          <p className="note note--help">{t('users.signIn.oidc.intro')}</p>
          {setup.redirectUri && <div className="family-row">
            <div><h4>{t('users.signIn.oidc.redirectUri')}</h4><p className="family-invite-link">{setup.redirectUri}</p></div>
            <button type="button" className="btn btn--ghost" onClick={() => void copy(setup.redirectUri!)}>{t('users.copy')}</button>
          </div>}
          {refused && <p role="alert" className="note note--help note--error">{t(providerErrorKey(refused))}</p>}
          {proof ? (
            <form className="form-stack" onSubmit={event => void submit(event)}>
              <p role="status"><Chip color="success">{proof.provider
                ? t('users.signIn.oidc.confirmed', { member: proof.member, provider, name: proof.provider })
                : t('users.signIn.oidc.confirmedNoName', { member: proof.member, provider })}</Chip></p>
              {CLIENT_MODULES.flatMap(({ key, signInSwitchNotice: Warning }) => (Warning ? [<Suspense key={key} fallback={null}><Warning /></Suspense>] : []))}
              <p className="note note--help">{t('users.signIn.oidc.confirmText', { provider })}</p>
              <CurrentPasswordField label={t('users.signIn.switch.confirmPassword')} password={password} />
              <div className="form-actions">
                {cancel}
                <button type="submit" className="btn btn--primary" disabled={busy || !password.current}>{t('users.signIn.oidc.button', { provider })}</button>
              </div>
            </form>
          ) : users.data && !managers.length ? <p className="note note--help">{t('users.signIn.oidc.noManager')}</p> : <>
            <Field variant="inset" label={t('users.signIn.oidc.profile')}>
              <Select value={chosen ?? ''} disabled={busy || !managers.length} onChange={event => setSelected(Number(event.target.value))}>
                {managers.map(user => <option key={user.id} value={user.id}>{user.member}</option>)}
              </Select>
            </Field>
            <div className="form-actions">
              {cancel}
              <button type="button" className="btn btn--primary" disabled={busy || chosen === null} onClick={() => void test()}>{t('users.signIn.oidc.test', { provider })}</button>
            </div>
          </>}
        </>}
      </div>
    </Card>
  )
}
