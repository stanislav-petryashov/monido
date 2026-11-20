import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { DemoDataResult } from '../domain/api'
import type { Language } from '../i18n/languages'
import { authSettingsQuery, useLoadFailedToast } from '../pages/admin/adminQuery'
import { apiSend } from './api'
import { reloadAuth, useAuth } from './authState'
import { useCan } from './rights'
import { clearStoredStep } from './setup'

/**
 * Wipes the family and writes the fictional one (POST /api/demo-data). `language` becomes the family language (the
 * wizard's pick; without it the server keeps the current one); `password` is the new family password, given only when
 * none is stored. An undefined field is dropped by JSON, so the body is `{ confirm: true }` at least.
 */
export function loadDemoData(language?: Language, password?: string): Promise<DemoDataResult> {
  return apiSend<DemoDataResult>('/api/demo-data', 'POST', { confirm: true, language, password })
}

/**
 * The landing after a load: every query dropped and read again, /api/auth read again (the new family language, the mode
 * and the setup state), then Overview.
 */
export async function afterDemoData(queryClient: QueryClient, navigate: (path: string) => void): Promise<void> {
  // the load marks the setup done: a wizard run in this tab is over
  clearStoredStep()
  void queryClient.resetQueries()
  await reloadAuth()
  navigate('/')
}

export interface DemoDataAvailability {
  /** the load can be offered: no reason against it and the Sign-in settings are read */
  available: boolean
  /** why not: the public demo or no manage right */
  reason: 'demo' | 'no_manage' | null
  /** no family password is stored and the sign-in is the app's: the dialog asks for one */
  needsPassword: boolean
  /** the load ends Telegram sign-in: the dialog says so */
  endsTelegram: boolean
  /** the load ends sign-in through the identity provider (it switches to the family password) */
  endsProvider: boolean
  /** the Sign-in settings could not be read: the offer is off for that, not for a reason of the server's */
  failed: boolean
  /** reads them again */
  retry: () => void
}

/**
 * Whether "Load test data" can be offered here, and what its dialog must ask, from the sign-in state and the Sign-in
 * settings (GET /api/auth-settings, not read in the demo or without manage). Shared by the Danger zone and the
 * first-run wizard. A failed read is told by the "Could not load data" notification, unless `reportLoadFailure` is
 * false: the dialog, whose host (the zone, the wizard) already tells it, so that one failure is one notification.
 */
export function useDemoDataAvailability({ reportLoadFailure = true }: { reportLoadFailure?: boolean } = {}): DemoDataAvailability {
  const { mode } = useAuth()
  const canManage = useCan('manage')
  const reason = mode === 'demo' ? 'demo' : !canManage ? 'no_manage' : null
  const query = useQuery({ ...authSettingsQuery, enabled: reason === null })
  useLoadFailedToast(...(reportLoadFailure ? [query] : []))
  const view = query.data
  return {
    available: reason === null && view !== undefined,
    reason,
    needsPassword: mode !== 'none' && view?.password.set === false,
    endsTelegram: mode === 'telegram',
    endsProvider: mode === 'oidc',
    failed: query.isError && query.data === undefined,
    retry: () => { void query.refetch() },
  }
}
