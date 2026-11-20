import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { loadAuth, useAuth } from '../lib/authState'
import { lazyWithChunks } from '../i18n/lazyWithChunks'
import { ErrorBoundary } from './ErrorBoundary'
import { PageError } from './PageError'
import { Loading } from './ui/Loading'

// Sign-in forms and their styles are only needed when the session is unauthenticated.
const Login = lazyWithChunks(() => import('../pages/Login').then(m => ({ default: m.Login })))
const OidcInvite = lazyWithChunks(() => import('../pages/OidcInvite').then(m => ({ default: m.OidcInvite })))

/** The code of a provider invitation link, `/invite/oidc/<code>`; null on any other page */
const inviteCode = () => /^\/invite\/oidc\/([^/]+)$/.exec(window.location.pathname)?.[1] ?? null

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
  if (invite !== null) return <ErrorBoundary><Suspense fallback={<Loading quiet />}><OidcInvite code={decodeURIComponent(invite)} /></Suspense></ErrorBoundary>
  if (auth.authenticated) return children
  return <ErrorBoundary><Suspense fallback={<Loading quiet />}><Login /></Suspense></ErrorBoundary>
}
