import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, apiFetch, apiSend } from '../lib/api'
import { useAuth } from '../lib/authState'
import { browser } from '../lib/browser'
import { errorMessage } from '../i18n/client'
import { useSingleFlight } from './admin/useSingleFlight'
import { LoginShell } from './Login'

type Invite = { state: 'loading' } | { state: 'ready'; member: string } | { state: 'failed'; message: string }

const messageOf = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.code ? errorMessage(error.code, error.params, fallback) : fallback

/**
 * `/invite/oidc/<code>`: whom the invitation is for, and a button that goes to the provider. Opening the link alone binds
 * nothing: a provider session already open in this browser must not be linked by a mere visit.
 */
export function OidcInvite({ code }: { code: string }) {
  const { t } = useTranslation()
  const { provider } = useAuth()
  const [invite, setInvite] = useState<Invite>({ state: 'loading' })
  const [run, busy] = useSingleFlight()
  const name = provider ?? t('auth.oidcInvite.provider')
  const url = `/api/auth/oidc/invite/${encodeURIComponent(code)}`
  useEffect(() => {
    let live = true
    apiFetch<{ member: string }>(url)
      .then(({ member }) => { if (live) setInvite({ state: 'ready', member }) })
      .catch((error: unknown) => { if (live) setInvite({ state: 'failed', message: messageOf(error, t('auth.oidc.error.oidc_invite_invalid')) }) })
    return () => { live = false }
  }, [url, t])

  async function go() {
    await run(async () => {
      try {
        const { url: next } = await apiSend<{ url: string }>(url, 'POST', {})
        browser.go(next)
      } catch (error) {
        setInvite({ state: 'failed', message: messageOf(error, t('auth.oidc.error.oidc_failed')) })
      }
    })
  }

  return (
    <LoginShell>
      <div className="form-stack">
        <h1 className="login__title">{t('auth.oidcInvite.title')}</h1>
        {invite.state === 'loading' && <p className="note note--help" aria-busy="true">{'…'}</p>}
        {invite.state === 'ready' && <>
          <p className="login__subtitle">{t('auth.oidcInvite.text', { provider: name, member: invite.member })}</p>
          <p className="note note--help">{t('auth.oidcInvite.hint')}</p>
          <div className="form-actions">
            <button type="button" className="btn btn--primary login__submit" disabled={busy} onClick={() => void go()}>{t('auth.oidcInvite.continue', { provider: name })}</button>
          </div>
        </>}
        {invite.state === 'failed' && <>
          <p role="alert" className="login__error">{invite.message}</p>
          <a className="link-accent" href="/">{t('auth.oidcInvite.home')}</a>
        </>}
      </div>
    </LoginShell>
  )
}
