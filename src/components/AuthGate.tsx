import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { loadAuth, useAuth } from '../lib/authState'
import { lazyWithChunks } from '../i18n/lazyWithChunks'
import { ErrorBoundary } from './ErrorBoundary'
import { PageError } from './PageError'
import { Loading } from './ui/Loading'

// Sign-in forms and their styles are only needed when the session is unauthenticated.
const Login = lazyWithChunks(() => import('../pages/Login').then(m => ({ default: m.Login })))
// only right after a provider sent the browser back: kept out of the first load
const ProviderReturnNotice = lazy(() => import('./ProviderReturnNotice').then(m => ({ default: m.ProviderReturnNotice })))
// its texts come with the records chunk: an invitation is opened once, so they stay out of the first load
const OidcInvite = lazyWithChunks(() => import('../pages/OidcInvite').then(m => ({ default: m.OidcInvite })), 'records')

/** The code of a provider invitation link, `/invite/oidc/<code>`: undefined on any other page, null when it cannot be read */
function inviteCode(): string | null | undefined {
  const raw = /^\/invite\/oidc\/([^/]+)$/.exec(window.location.pathname)?.[1]
  if (raw === undefined) return undefined
  try { return decodeURIComponent(raw) } catch { return null }
}


/** Above the shell: while the mode is unknown — loading; not signed in — the login screen; otherwise the app. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const auth = useAuth()
  const [retrying, setRetrying] = useState(false)
  const pending = useRef(false)
  const retry = () => {
    if (pending.current) return
    pending.current = true
    setRetrying(true)
    void loadAuth().finally(() => { pending.current = false; setRetrying(false) })
  }
  const queryClient = useQueryClient()
  const wasAuthenticated = useRef(false)
  useEffect(() => { if (auth.mode === null && !auth.failed) void loadAuth() }, [auth.mode, auth.failed])
  // sign-out or 401: the previous session's query cache must not show after the next sign-in
  useEffect(() => {
    if (wasAuthenticated.current && !auth.authenticated) queryClient.clear()
    wasAuthenticated.current = auth.authenticated
  }, [auth.authenticated, queryClient])
  if (auth.failed) return <PageError onRetry={retry} retrying={retrying}>{t('auth.serverDown')}</PageError>
  if (auth.mode === null) return <Loading quiet />
  // an invitation is for whoever opens it, signed in or not (a manager checking the link sees the same page)
  const invite = inviteCode()
  if (invite !== undefined) return <ErrorBoundary><Suspense fallback={<Loading quiet />}><OidcInvite code={invite} /></Suspense></ErrorBoundary>
  if (auth.authenticated) return <>{children}{/[?&](sign_in_error|oidc_invite)=/.test(window.location.search) && <Suspense fallback={null}><ProviderReturnNotice /></Suspense>}</>
  return <ErrorBoundary><Suspense fallback={<Loading quiet />}><Login /></Suspense></ErrorBoundary>
}
