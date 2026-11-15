import { parseDraft } from '../domain/monthClose'
import type { Database, PreparedStatement } from './db'
import { advanceDraftRevision } from './draftRevision'
import { InputError, plainObject, requireRight, type Actor } from './http'
import { commitMutation } from './mutations'
import { CHANGE_LOG_INSERT, MEMBER_TABLES } from './rows'

/** A compound, non-revertible rename: reverting one ownership row would split the person's history. */
export async function renameMember(db: Database, rowid: number, body: unknown, actor: Actor): Promise<{ rowid: number; name: string }> {
  requireRight(actor, 'edit')
  const data = plainObject(body)
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 100) throw new InputError('invalid_value', 400, { column: 'name' })
  const name = data.name.trim()
  return commitMutation(db, async () => {
    const before = await db.prepare('SELECT name FROM members WHERE rowid = ?').bind(rowid).first<{ name: string }>()
    if (!before) throw new InputError('row_not_found', 404)
    const result = { rowid, name }
    if (before.name === name) return { statements: [], result }
    if (await db.prepare('SELECT 1 FROM users WHERE member = ?').bind(before.name).first()) requireRight(actor, 'manage')
    if (await db.prepare('SELECT 1 FROM members WHERE name = ?').bind(name).first()) throw new InputError('data_conflict', 409)
    const statements: PreparedStatement[] = []
    for (const table of MEMBER_TABLES) {
      // Orphan references count too: taking their name would merge two owners silently.
      if (await db.prepare(`SELECT 1 FROM ${table} WHERE member = ? LIMIT 1`).bind(name).first()) throw new InputError('data_conflict', 409)
      statements.push(db.prepare(`UPDATE ${table} SET member = ? WHERE member = ?`).bind(name, before.name))
    }
    const { results: drafts } = await db.prepare('SELECT month, payload FROM month_drafts').all<{ month: string; payload: string }>()
    for (const stored of drafts) {
      let draft
      try { draft = parseDraft(JSON.parse(stored.payload)) } catch { throw new InputError('draft_conflict', 409) }
      if (draft.rows.some(row => row.member === name)) throw new InputError('data_conflict', 409)
      if (!draft.rows.some(row => row.member === before.name)) continue
      draft.rows = draft.rows.map(row => row.member === before.name ? { ...row, member: name } : row)
      statements.push(
        db.prepare('UPDATE month_drafts SET payload = ? WHERE month = ?').bind(JSON.stringify(draft), stored.month),
        advanceDraftRevision(db, stored.month),
      )
    }
    statements.push(
      db.prepare('UPDATE members SET name = ? WHERE rowid = ?').bind(name, rowid),
      // Non-data table names already disable both journal UI and server reverts; no credentials enter the audit trail.
      db.prepare(`${CHANGE_LOG_INSERT} VALUES (?, ?, ?, 'member_rename', ?, 'update', ?, ?, NULL)`)
        .bind(new Date().toISOString(), actor.name, actor.source, rowid, JSON.stringify(before), JSON.stringify({ name })),
    )
    return { statements, result }
  })
}
