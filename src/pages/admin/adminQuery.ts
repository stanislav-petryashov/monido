import { useEffect, useEffectEvent, useRef } from 'react'
import { queryOptions, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { AdminRows, AuthSettingsView, MonthCloseState, Row, UsersView } from '../../domain/api'
import { t } from '../../i18n/client'
import { apiFetch, ApiError } from '../../lib/api'
import { reloadAuth } from '../../lib/authState'
import { useToast } from '../../lib/notifyState'
import { refreshSnapshot } from '../../lib/useFinanceData'

/**
 * The Data section's query options: a screen reads afresh every time it mounts (the app's five-minute cache is for the
 * snapshot), nothing refetches behind the person's back (window focus, reconnect), and a failed load is not retried,
 * so its notification comes at once.
 */
export const ADMIN_QUERY = {
  staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false,
} as const

/** The rows of /api/admin/:table, under the key ['admin', table] */
export const tableQuery = <R = Row>(table: string) => queryOptions({
  queryKey: ['admin', table],
  queryFn: () => apiFetch<AdminRows<R>>(`/api/admin/${table}`),
  ...ADMIN_QUERY,
})

/** The month-close wizard's state: the queue, the current month's draft, the last closed month */
export const monthCloseQuery = queryOptions({
  queryKey: ['admin', 'month-close'],
  queryFn: () => apiFetch<MonthCloseState>('/api/month-close'),
  ...ADMIN_QUERY,
})

/** The Users page's rows: everyone's rights, the mode and the bot as anyone signed in sees them */
export const USERS_KEY = ['admin', 'users'] as const
export const usersQuery = queryOptions({ queryKey: USERS_KEY, queryFn: () => apiFetch<UsersView>('/api/users'), ...ADMIN_QUERY })

/** The Sign-in settings as a manager sees them (GET /api/auth-settings); every Sign-in and Users write invalidates it */
export const AUTH_SETTINGS_KEY = ['admin', 'auth-settings'] as const
export const authSettingsQuery = queryOptions({
  queryKey: AUTH_SETTINGS_KEY,
  queryFn: () => apiFetch<AuthSettingsView>('/api/auth-settings'),
  ...ADMIN_QUERY,
})

/** What a Users or Sign-in write changes: a link or a right may change who can switch to Telegram sign-in, so both views are read again */
export const AUTH_WRITES = [USERS_KEY, AUTH_SETTINGS_KEY] as const

/** How often the view is read again while the bot has no name yet, and for how long at most */
const BOT_NAME_POLL_MS = 2_000
const BOT_NAME_POLL_LIMIT_MS = 60_000
/** When each view query started waiting for the bot's name */
const botNameWaitSince = new WeakMap<object, number>()

/**
 * The refetchInterval of the view's reader (the Sign-in section, or the switch where it stands alone): a saved token's
 * bot introduces itself a moment later (the reader's own getMe), so while the view has a token but neither the bot's
 * name nor a problem it is read again every 2 s, for at most a minute; the name or a problem stops it.
 */
export function botNamePoll(query: { state: { data?: AuthSettingsView } }): number | false {
  const bot = query.state.data?.bot
  if (!bot || bot.source === null || bot.username !== null || bot.problem !== null) {
    botNameWaitSince.delete(query)
    return false
  }
  const since = botNameWaitSince.get(query) ?? Date.now()
  botNameWaitSince.set(query, since)
  return Date.now() - since < BOT_NAME_POLL_LIMIT_MS ? BOT_NAME_POLL_MS : false
}

/** What the load notification needs from a query result */
export interface LoadState {
  error: unknown
  errorUpdatedAt: number
  isFetching: boolean
}

/**
 * One "Could not load data" notification per failed load of a screen, however many of its queries failed:
 * it waits until none of them is fetching. An error cached before the screen mounted is not repeated
 * (a language switch remounts the screen); a failed refetch after a write is reported like a first load.
 */
export function useLoadFailedToast(...queries: LoadState[]): void {
  const toast = useToast()
  const settled = queries.every(q => !q.isFetching)
  const latest = Math.max(0, ...queries.map(q => q.errorUpdatedAt))
  // the newest error; of two stamped in the same millisecond, the later-declared query's
  const error = queries.findLast(q => q.errorUpdatedAt === latest)?.error
  /** The newest error already accounted for; null until the first effect, which takes what the cache had */
  const seen = useRef<number | null>(null)
  const report = useEffectEvent((e: unknown) => toast.error(t('data.common.loadFailed'), e))
  useEffect(() => {
    if (seen.current === null) { seen.current = latest; return }
    if (!settled || latest <= seen.current) return
    seen.current = latest
    report(error)
  }, [settled, latest, error])
}

/** A success notification: the title, or [title, explanation] */
type WriteOk = string | [title: string, text?: string]

interface WriteVars {
  request: () => Promise<unknown>
  ok: WriteOk | null
  fail: string
  /** An error the caller words itself (under a field): true — no notification */
  handled?: (e: unknown) => boolean
}

/** The Parameters tables: a write in any of its blocks refetches all of them */
export const PARAMETER_WRITES = ['parameters', 'currencies', 'members'].map(table => tableQuery(table).queryKey)

/**
 * A Data-section write (useMutation): on success the `ok` notification (null — none) and a refetch of `keys`,
 * awaited, so the screen shows the server's rows when the write resolves; on failure toast.error(fail, e), unless
 * `handled(e)` says the caller shows that error itself. Resolves to true when the request succeeded.
 */
export function useAdminWrite(keys: readonly QueryKey[]) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { mutateAsync } = useMutation({
    mutationFn: ({ request }: WriteVars) => request(),
    onSuccess: async (_answer, { ok }) => {
      if (typeof ok === 'string') toast.success(ok)
      else if (ok) toast.success(...ok)
      await Promise.all(keys.map(queryKey => queryClient.invalidateQueries({ queryKey })))
    },
    onError: async (e, { fail, handled }) => {
      if (!handled?.(e)) toast.error(fail, e)
      // refused for a state the screen did not show (changed elsewhere): read it again before the editor reopens
      if (e instanceof ApiError && e.status === 409) await Promise.all(keys.map(queryKey => queryClient.invalidateQueries({ queryKey })))
    },
  })
  return (request: () => Promise<unknown>, ok: WriteOk | null, fail: string, handled?: (e: unknown) => boolean): Promise<boolean> =>
    mutateAsync({ request, ok, fail, handled }).then(() => true, () => false)
}

export type AdminWrite = ReturnType<typeof useAdminWrite>

/** A write after which the session is read again (`/api/auth`): the signed-in person's own rights, mode or password may have changed */
export function reloadingAuth(write: AdminWrite): AdminWrite {
  return async (...args) => {
    const ok = await write(...args)
    if (ok) void reloadAuth()
    return ok
  }
}

/** A useAdminWrite whose success also refreshes the snapshot: for the writes that change what the dashboard shows (rates, inflation) */
export function useSnapshotWrite(keys: readonly QueryKey[]): AdminWrite {
  const queryClient = useQueryClient()
  const write = useAdminWrite(keys)
  return async (...args) => {
    const done = await write(...args)
    if (done) void refreshSnapshot(queryClient)
    return done
  }
}
