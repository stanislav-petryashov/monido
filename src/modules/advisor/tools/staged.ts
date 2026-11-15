// Previews staged by a preview tool and applied once by its write tool (a statement, a loan, a council proposal): in this server's
// memory, per database, user and kind, for STAGED_TTL_MS, at most STAGED_PER_KIND[kind] per user and kind (a new one drops that
// user's oldest of the kind). Nothing is written to the database: a restart loses them, and Claude prepares the preview again.
import { InputError } from '../../../server/http'
import { randomId } from '../../../server/secrets'
import type { Database } from '../../../server/db'

const STAGED_TTL_MS = 30 * 60_000

/** A staged item no longer fits what it was prepared against: prepare a new preview */
export const stale = () => new InputError('advisor.draft_stale', 409)
type StagedKind = 'statement' | 'loan' | 'proposal'

/** a month's statements are previewed one account and currency at a time, so they get more room */
export const STAGED_PER_KIND: Record<StagedKind, number> = { statement: 20, loan: 5, proposal: 5 }

interface Staged<T> {
  id: string
  userId: number
  kind: StagedKind
  payload: T
  /** ms since the epoch */
  expiresAt: number
}

/** By database (a database dropped takes its items along), then by id in the order they were staged */
const store = new WeakMap<Database, Map<string, Staged<unknown>>>()

/** The database's staged items with the expired ones dropped. */
function live(db: Database, now: Date): Map<string, Staged<unknown>> {
  let map = store.get(db)
  if (!map) {
    map = new Map()
    store.set(db, map)
  }
  for (const [id, item] of map) if (item.expiresAt <= now.getTime()) map.delete(id)
  return map
}

/** Keeps a new item of its user and kind, dropping their oldest of that kind beyond STAGED_PER_KIND[kind]. */
export function stage<T>(db: Database, kind: StagedKind, userId: number, payload: T, now: Date): Staged<T> {
  const map = live(db, now)
  const own = [...map.values()].filter(s => s.userId === userId && s.kind === kind)
  for (const old of own.slice(0, Math.max(0, own.length - STAGED_PER_KIND[kind] + 1))) map.delete(old.id)
  const item: Staged<T> = { id: randomId(16), userId, kind, payload, expiresAt: now.getTime() + STAGED_TTL_MS }
  map.set(item.id, item)
  return item
}

/**
 * Takes `userId`'s live item `id` of `kind` out of the store, so that it is applied once; null — none: unknown, expired,
 * taken, another user's or another database's, of the other kind or one `accept` refuses (left as it is).
 */
export function takeStaged<T>(db: Database, kind: StagedKind, userId: number, id: string, now: Date, accept: (payload: T) => boolean = () => true): Staged<T> | null {
  const map = live(db, now)
  const item = map.get(id)
  if (!item || item.userId !== userId || item.kind !== kind || !accept(item.payload as T)) return null
  map.delete(id)
  return item as Staged<T>
}
