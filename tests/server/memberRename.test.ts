import { describe, expect, it, vi } from 'vitest'
import { renameMember } from '../../src/server/memberRename'
import { revertChange } from '../../src/server/rows'
import type { Actor } from '../../src/server/http'
import { createTestDb } from '../helpers/db'

const actor: Actor = { name: 'family', source: 'admin', rights: { edit: true, manage: true, vote: true }, userId: null }
const setup = () => {
  const db = createTestDb()
  db.sqlite.exec(`INSERT INTO members (rowid, name) VALUES (1, 'Robin');
    INSERT INTO assets VALUES ('2026-01-31', 'bank', 'Bank', 100, 'USD', 'Robin');
    INSERT INTO monthly_cashflow (date, bank, member, currency) VALUES ('2026-01-01', 'Bank', 'Robin', 'USD');
    INSERT INTO account_closings VALUES ('Bank', 'Robin', '2026-01');
    INSERT INTO availability_assessments VALUES ('2026-01', 'Bank', 'Robin', 'USD', 100, 1, 10, 20, 30);
    INSERT INTO users (member, invite_hash, invite_expires_at, created_at, updated_at) VALUES ('Robin', 'secret', 'future', 'created', 'updated');
    INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member) VALUES ('Loan', '2026-01-01', 100, 0, 10, 10, 'USD', 'Robin');
    INSERT INTO real_estate (name, purchase_date, purchase_price, purchase_currency, valuation_year, value, currency, member) VALUES ('House', '2026-01-01', 100, 'USD', 2026, 100, 'USD', 'Robin');
    INSERT INTO flow_lines VALUES ('2026-01-01', 'Bank', 'Robin', 1, 10);
    INSERT INTO account_transfers VALUES ('2026-01-01', 'Bank', 'Robin', 10, 'USD');`)
  const draft = { rows: [{ name: 'Bank', member: 'Robin', currency: 'USD', class: 'bank', balance: 100, active: 0, passive: 0, expense: 0, closing: false, added: false }] }
  db.sqlite.prepare('INSERT INTO month_drafts VALUES (?, ?, ?)').run('2026-02', JSON.stringify(draft), 'before')
  return db
}

describe('renameMember', () => {
  it('moves every ownership reference and draft together, keeps credentials, and journals a non-revertible operation', async () => {
    const db = setup()
    await expect(renameMember(db, 1, { name: ' Robin New ' }, actor)).resolves.toEqual({ rowid: 1, name: 'Robin New' })
    for (const table of ['assets', 'monthly_cashflow', 'loans', 'real_estate', 'flow_lines', 'account_transfers', 'account_closings', 'availability_assessments', 'users']) {
      expect(db.sqlite.prepare(`SELECT member FROM ${table}`).get()).toEqual({ member: 'Robin New' })
    }
    expect(db.sqlite.prepare('SELECT invite_hash, created_at FROM users').get()).toEqual({ invite_hash: 'secret', created_at: 'created' })
    expect(JSON.parse(String(db.sqlite.prepare('SELECT payload FROM month_drafts').get()?.payload)).rows[0]).toMatchObject({ member: 'Robin New', balance: 100 })
    expect(db.sqlite.prepare('SELECT revision FROM month_draft_revisions').get()?.revision).toBe(1)
    const log = db.sqlite.prepare('SELECT * FROM change_log').get()!
    expect(log.table_name).toBe('member_rename')
    expect(JSON.stringify(log)).not.toContain('secret')
    await expect(revertChange(db, Number(log.id), actor)).rejects.toMatchObject({ code: 'not_revertible' })
  })

  it('requires edit, and manage for a member with access', async () => {
    const db = setup()
    await expect(renameMember(db, 1, { name: 'New' }, { ...actor, rights: { ...actor.rights, edit: false } })).rejects.toMatchObject({ code: 'no_right_edit' })
    await expect(renameMember(db, 1, { name: 'New' }, { ...actor, rights: { ...actor.rights, manage: false } })).rejects.toMatchObject({ code: 'no_right_manage' })
    expect(db.sqlite.prepare('SELECT name FROM members').get()?.name).toBe('Robin')
    db.sqlite.exec('DELETE FROM users')
    await expect(renameMember(db, 1, { name: 'New' }, { ...actor, rights: { ...actor.rights, manage: false } })).resolves.toEqual({ rowid: 1, name: 'New' })
  })

  it('rejects another member and orphan destination references without merging records', async () => {
    const db = setup()
    db.sqlite.exec("INSERT INTO members VALUES ('Existing')")
    await expect(renameMember(db, 1, { name: 'Existing' }, actor)).rejects.toMatchObject({ code: 'data_conflict', status: 409 })
    db.sqlite.exec("INSERT INTO assets VALUES ('2026-01-31', 'bank', 'Other', 50, 'USD', 'Orphan')")
    await expect(renameMember(db, 1, { name: 'Orphan' }, actor)).rejects.toMatchObject({ code: 'data_conflict', status: 409 })
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM change_log').get()?.n).toBe(0)
  })

  it('refuses "migration", the mark of months entered before the wizard, on a rename and on an insert', async () => {
    const db = setup()
    await expect(renameMember(db, 1, { name: 'migration' }, actor)).rejects.toMatchObject({ code: 'reserved_name', status: 409 })
    const { insertRow } = await import('../../src/server/rows')
    await expect(insertRow(db, 'members', { name: 'migration' }, actor)).rejects.toMatchObject({ code: 'reserved_name', status: 409 })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM members WHERE name = 'migration'").get()?.n).toBe(0)
  })

  it('rolls every update back if the journal fails', async () => {
    const db = setup()
    db.sqlite.exec("CREATE TRIGGER fail_log BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT, 'journal failed'); END")
    await expect(renameMember(db, 1, { name: 'New' }, actor)).rejects.toThrow('journal failed')
    expect(db.sqlite.prepare('SELECT name FROM members').get()?.name).toBe('Robin')
    expect(db.sqlite.prepare('SELECT member FROM users').get()?.member).toBe('Robin')
    expect(String(db.sqlite.prepare('SELECT payload FROM month_drafts').get()?.payload)).toContain('Robin')
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM month_draft_revisions').get()?.n).toBe(0)
  })

  it('refuses orphan destination names in drafts and malformed drafts without touching ownership', async () => {
    const db = setup()
    const draft = JSON.parse(String(db.sqlite.prepare('SELECT payload FROM month_drafts').get()?.payload))
    draft.rows.push({ ...draft.rows[0], name: 'Other', member: 'New' })
    db.sqlite.prepare('UPDATE month_drafts SET payload = ?').run(JSON.stringify(draft))
    await expect(renameMember(db, 1, { name: 'New' }, actor)).rejects.toMatchObject({ code: 'data_conflict' })
    db.sqlite.exec("UPDATE month_drafts SET payload = 'broken'")
    await expect(renameMember(db, 1, { name: 'New' }, actor)).rejects.toMatchObject({ code: 'draft_conflict' })
    expect(db.sqlite.prepare('SELECT name FROM members').get()?.name).toBe('Robin')
    expect(db.sqlite.prepare('SELECT member FROM assets').get()?.member).toBe('Robin')
  })

  it('covers every current table with a member name link', async () => {
    const db = setup()
    const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      .map(row => String(row.name))
      .filter(table => db.sqlite.prepare(`PRAGMA table_info("${table}")`).all().some(column => column.name === 'member'))
    expect(tables.sort()).toEqual(['assets', 'loans', 'real_estate', 'monthly_cashflow', 'flow_lines', 'account_transfers', 'account_closings', 'availability_assessments', 'users'].sort())
  })

  it('rechecks destination references if another write lands during preflight', async () => {
    const db = setup()
    const commit = db.guardedBatch.bind(db)
    vi.spyOn(db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
      await db.prepare("INSERT INTO account_closings VALUES ('Other', 'New', '2026-01')").run()
      return commit(token, statements)
    })
    await expect(renameMember(db, 1, { name: 'New' }, actor)).rejects.toMatchObject({ code: 'data_conflict' })
    expect(db.sqlite.prepare('SELECT name FROM members').get()?.name).toBe('Robin')
  })

  it('validates input and treats an unchanged name as a no-op', async () => {
    const db = setup()
    for (const name of ['', '  ', null, 2, 'x'.repeat(201)]) {
      await expect(renameMember(db, 1, { name }, actor)).rejects.toMatchObject({ code: 'invalid_value' })
    }
    await expect(renameMember(db, 999, { name: 'New' }, actor)).rejects.toMatchObject({ code: 'row_not_found' })
    await renameMember(db, 1, { name: 'Robin' }, actor)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM change_log').get()?.n).toBe(0)
  })
})
