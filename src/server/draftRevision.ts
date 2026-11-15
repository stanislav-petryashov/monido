// Opaque draft identity: a persistent write counter plus the authoritative inputs used to edit it.
import { createHash } from 'node:crypto'
import type { Database, PreparedStatement } from './db'
import { InputError } from './http'

/** Object property order is immaterial; array order comes from the domain's deterministic rows. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
  return value
}

/** Source collections are sets of records, independent of their SQLite read order. */
export function revisionRecords(rows: readonly object[]): string[] {
  return rows.map(row => JSON.stringify(canonical(row))).sort()
}

/**
 * The caller supplies domain inputs, never category content, UI labels or save timestamps.
 * pendingSave projects the counter advanced by the same guarded plan, before it commits.
 */
export async function draftRevision(db: Database, month: string, inputs: object, pendingSave = false): Promise<string> {
  const saved = await db.prepare('SELECT revision FROM month_draft_revisions WHERE month = ?').bind(month).first<{ revision: number }>()
  const digest = createHash('sha256').update(JSON.stringify(canonical({ month, ...inputs }))).digest('hex')
  return `${(saved?.revision ?? 0) + (pendingSave ? 1 : 0)}:${digest}`
}

/** Included in the same guarded batch as every draft lifecycle write, even close (which deletes the payload). */
export function advanceDraftRevision(db: Database, month: string): PreparedStatement {
  return db.prepare(`INSERT INTO month_draft_revisions (month, revision) VALUES (?, 1)
    ON CONFLICT(month) DO UPDATE SET revision = revision + 1`).bind(month)
}

/** Older clients must refresh; an omitted token must never become permission to overwrite. */
export function requireDraftRevision(body: unknown, current: string | null): void {
  const expected = body && typeof body === 'object' && 'expectedRevision' in body ? body.expectedRevision : undefined
  if (typeof expected !== 'string' || !expected) throw new InputError('invalid_draft_revision', 400)
  if (expected !== current) throw new InputError('draft_conflict', 409)
}
