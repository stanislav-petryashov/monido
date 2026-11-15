import { loadTestAuthRuntime } from '../helpers/auth'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { saveAvailability, readAvailability, removeAvailability } from '../../src/server/availability'
import type { Actor } from '../../src/server/http'
const editor: Actor = { name: 'Editor', source: 'admin', userId: null, rights: { edit: true, manage: true, vote: true } }
const assessment = { month: '2024-03', name: 'Cash', member: '', currency: 'USD', balance: 100, available: true, reserve: 20, goals: 30, commitments: 10 }
const opened: TestDb[] = []
afterEach(() => opened.splice(0).forEach(db => db.close()))
function setup() { const db = createTestDb(); opened.push(db); db.sqlite.exec("INSERT INTO assets VALUES ('2024-03-31', 'bank', 'Cash', 100, 'USD', ''); INSERT INTO closed_months (month, closed_at, closed_by) VALUES ('2024-03', 'now', 'test')"); return db }
describe('availability persistence', () => {
  it('journals create/update/delete and preserves exactly one assessment', async () => {
    const db = setup()
    await saveAvailability(db, editor, assessment)
    await saveAvailability(db, editor, { ...assessment, reserve: 10 })
    expect(await readAvailability(db)).toEqual([{ ...assessment, reserve: 10 }])
    await removeAvailability(db, editor, assessment)
    expect(await readAvailability(db)).toEqual([])
    expect(db.sqlite.prepare("SELECT op FROM change_log WHERE table_name = 'availability_assessments'").all().map(r => r.op)).toEqual(['insert', 'update', 'delete'])
  })
  it('rejects read-only writes, stale balances, wrong currencies, open months and overallocations atomically', async () => {
    const db = setup()
    await expect(saveAvailability(db, { ...editor, rights: { edit: false, manage: false, vote: false } }, assessment)).rejects.toMatchObject({ status: 403 })
    for (const change of [{ balance: 101 }, { currency: 'EUR' }, { month: '2024-04' }, { reserve: 101 }, { available: false }, { reserve: -1 }]) await expect(saveAvailability(db, editor, { ...assessment, ...change })).rejects.toBeDefined()
    expect(await readAvailability(db)).toEqual([])
    expect(db.sqlite.prepare('SELECT * FROM change_log').all()).toEqual([])
  })
})

import { updateAccount, deleteAccount } from '../../src/server/accountOperations'
import { deleteRow, updateRow } from '../../src/server/rows'
import { wipeFamilyData } from '../../src/server/wipe'
import { exportBackup } from '../../src/server/backup'
import { restoreBackup } from '../../src/server/restore'
import { openDatabase } from '../../src/server/db'
import { initializeSchema } from '../../src/server/schema'
import { SCHEMA_FILE, testConfig } from '../helpers/db'
import { withTempDirs } from '../helpers/tmp'
import { join } from 'node:path'
import { createApp } from '../../src/server/app'
import { authFor } from '../helpers/auth'
import { FAMILY_PASSWORD, familyCookie } from '../helpers/session'
const tempDir = withTempDirs('availability-test-')
describe('availability lifecycle', () => {
  it('rolls back confirmation when its journal fails', async () => {
    const db = setup()
    db.sqlite.exec("CREATE TRIGGER fail_availability_log BEFORE INSERT ON change_log WHEN NEW.table_name = 'availability_assessments' BEGIN SELECT RAISE(ABORT, 'injected'); END")
    await expect(saveAvailability(db, editor, assessment)).rejects.toThrow()
    expect(await readAvailability(db)).toEqual([])
  })
  it('renames with an account but blocks currency correction and deletion until explicit clearing', async () => {
    const db = setup()
    await saveAvailability(db, editor, assessment)
    const to = { name: 'Renamed', member: 'Other', currency: 'USD', class: 'bank' }
    await updateAccount(db, editor, { from: assessment, values: to })
    expect(await readAvailability(db)).toEqual([{ ...assessment, name: to.name, member: to.member }])
    await expect(updateAccount(db, editor, { from: to, values: { ...to, currency: 'EUR' } })).rejects.toMatchObject({ code: 'availability_reconcile' })
    await expect(deleteAccount(db, editor, to)).rejects.toMatchObject({ code: 'availability_reconcile' })
    await removeAvailability(db, editor, { ...assessment, ...to })
    await deleteAccount(db, editor, to)
    expect(db.sqlite.prepare('SELECT * FROM assets').all()).toEqual([])
  })
  it('generic currency and asset edits cannot silently reinterpret confirmed earmarks', async () => {
    const db = setup()
    await saveAvailability(db, editor, assessment)
    const row = db.sqlite.prepare('SELECT rowid FROM assets').get()!
    await expect(updateRow(db, 'assets', Number(row.rowid), { currency: 'EUR' }, editor)).rejects.toMatchObject({ code: 'availability_reconcile' })
    await expect(deleteRow(db, 'assets', Number(row.rowid), editor)).rejects.toMatchObject({ code: 'availability_reconcile' })
    await updateRow(db, 'assets', Number(row.rowid), { value: 80 }, editor)
    expect((await readAvailability(db))[0].balance).toBe(100)
  })
  it('API reads confirmations and writes through signed-in editor routes', async () => {
    const db = setup()
    const config = testConfig({ password: FAMILY_PASSWORD })
    const auth = authFor(config)
    const app = createApp({ db, config, auth, ratesOnline: false })
    expect((await app.request('/api/availability')).status).toBe(401)
    const headers = { Cookie: await familyCookie(auth), 'Content-Type': 'application/json' }
    const saved = await app.request('/api/availability', { method: 'PUT', headers, body: JSON.stringify(assessment) })
    expect(saved.status).toBe(200)
    expect(await (await app.request('/api/availability', { headers })).json()).toEqual({ assessments: [assessment] })
  })
  it('wipe removes all monthly confirmations', async () => {
    const db = setup()
    await saveAvailability(db, editor, assessment)
    await wipeFamilyData(db, editor, new Date())
    expect(await readAvailability(db)).toEqual([])
  })
  it('backup and restore preserve confirmations and signatures', async () => {
    const dir = tempDir()
    const source = openDatabase(join(dir, 'source.sqlite')); opened.push(source)
    initializeSchema(source, SCHEMA_FILE)
    source.sqlite.exec("INSERT INTO assets VALUES ('2024-03-31', 'bank', 'Cash', 100, 'USD', ''); INSERT INTO closed_months (month, closed_at, closed_by) VALUES ('2024-03', 'now', 'test')")
    await saveAvailability(source, editor, assessment)
    const backup = new Uint8Array(await (await exportBackup(source)).arrayBuffer())
    const target = openDatabase(join(dir, 'target.sqlite')); opened.push(target)
    initializeSchema(target, SCHEMA_FILE)
    await restoreBackup(target, backup, { schemaFile: SCHEMA_FILE, dataDir: dir, actor: editor, now: new Date() })
    expect(await readAvailability(target)).toEqual([assessment])
  })
})

import { userCookie } from '../helpers/session'
import { planSharedPassword } from '../../src/server/authSettings'
import { loadDemoData } from '../../src/server/demoData'
describe('availability authorization and reset', () => {
  it('viewers can read but cannot PUT or DELETE even with a manager-like request body', async () => {
    const db = setup()
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Viewer'); INSERT INTO users (member, telegram_id, can_edit, can_vote, can_manage, created_at, updated_at) VALUES ('Viewer', '101', 0, 0, 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')")
    const config = testConfig({ mode: 'telegram', TELEGRAM_BOT_TOKEN: '1:x' })
    const auth = authFor(config)
    const app = createApp({ db, config, auth, ratesOnline: false })
    const headers = { Cookie: await userCookie(auth, 1), 'Content-Type': 'application/json' }
    expect((await app.request('/api/availability', { headers })).status).toBe(200)
    for (const method of ['PUT', 'DELETE']) expect((await app.request('/api/availability', { method, headers, body: JSON.stringify({ ...assessment, rights: { edit: true } }) })).status).toBe(403)
    expect(await readAvailability(db)).toEqual([])
  })
  it('demo replacement clears real-family confirmations instead of applying them to demo names', async () => {
    const db = setup()
    await saveAvailability(db, editor, assessment)
    const config = testConfig({ password: FAMILY_PASSWORD })
    const auth = await loadTestAuthRuntime(db, config, { log() {} })
    const plan = await planSharedPassword(auth, editor, {})
    loadDemoData(db, { actor: editor, language: 'en-US', now: new Date('2024-04-01T00:00:00Z'), plan })
    expect(await readAvailability(db)).toEqual([])
  })
})
