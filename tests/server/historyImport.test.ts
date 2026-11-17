import { beforeEach, describe, expect, it } from 'vitest'
import { importHistory, previewHistoryImport, removeImportedHistory } from '../../src/server/historyImport'
import { getMonthCloseState, reopenMonth } from '../../src/server/monthClose'
import { getSnapshot } from '../../src/server/snapshot'
import type { Actor } from '../../src/server/http'
import { createTestDb, type TestDb } from '../helpers/db'

const actor: Actor = { name: 'owner@example.com', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null }
const NOW = new Date('2031-08-10T09:00:00Z')
const all = (db: TestDb, sql: string) => db.sqlite.prepare(sql).all().map(r => ({ ...(r as Record<string, unknown>) }))
const bank = { name: 'Quillmark Bank', member: 'Robin', class: 'bank', currency: 'RUB' }
const broker = { name: 'Quillmark Broker', member: '', class: 'broker', currency: 'RUB' }
/** Feb–Apr 2031 before the migrated May: the bank continues into May, the broker ends in March */
const body = {
  accounts: [bank, broker],
  months: [
    { month: '2031-02', values: [70, 10] },
    { month: '2031-03', values: [80, 20] },
    { month: '2031-04', values: [90, null] },
  ],
}

let db: TestDb
beforeEach(() => {
  db = createTestDb()
  db.sqlite.exec(`
    INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-05-31', 'bank', 'Quillmark Bank', 100, 'RUB', 'Robin');
    INSERT INTO closed_months VALUES ('2031-05', 't', 'migration');
    INSERT OR IGNORE INTO members (name) VALUES ('Robin');
    INSERT OR IGNORE INTO currencies (code) VALUES ('RUB');
  `)
})

describe('history import on SQLite', () => {
  it('a dry run counts what the import would write and writes nothing', async () => {
    const before = all(db, 'SELECT count(*) AS n FROM assets')
    expect(await previewHistoryImport(db, body, NOW)).toEqual({ months: ['2031-02', '2031-03', '2031-04'], balances: 5, closures: 1, newAccounts: 1, problems: [] })
    expect(all(db, 'SELECT count(*) AS n FROM assets')).toEqual(before)
    expect(all(db, "SELECT count(*) AS n FROM change_log WHERE op = 'history_import'")).toEqual([{ n: 0 }])
  })

  it('imports balances, the ended account’s closure and the closed months in one batch with one journal entry', async () => {
    expect(await importHistory(db, body, actor, NOW)).toEqual({ months: ['2031-02', '2031-03', '2031-04'], balances: 5 })
    expect(all(db, "SELECT date, name, value FROM assets WHERE date < '2031-05-01' ORDER BY name, date")).toEqual([
      { date: '2031-02-28', name: 'Quillmark Bank', value: 70 }, { date: '2031-03-31', name: 'Quillmark Bank', value: 80 }, { date: '2031-04-30', name: 'Quillmark Bank', value: 90 },
      { date: '2031-02-28', name: 'Quillmark Broker', value: 10 }, { date: '2031-03-31', name: 'Quillmark Broker', value: 20 },
    ])
    expect(all(db, 'SELECT name, closed_month FROM account_closures')).toEqual([{ name: 'Quillmark Broker', closed_month: '2031-03' }])
    expect(all(db, "SELECT month FROM closed_months WHERE closed_by = '' ORDER BY month").map(r => r.month)).toEqual(['2031-02', '2031-03', '2031-04'])
    expect(all(db, "SELECT actor, op, after_json FROM change_log WHERE op = 'history_import'"))
      .toEqual([{ actor: 'owner@example.com', op: 'history_import', after_json: '{"first":"2031-02","last":"2031-04","balances":5}' }])
    // the wizard goes on after the history it already had; the page learns where a next import must end and what was imported
    const state = await getMonthCloseState(db, NOW)
    expect(state.queue).toEqual(['2031-06', '2031-07'])
    expect(state.history).toMatchObject({ endsAt: '2031-01', until: '2031-07', imported: { first: '2031-02', last: '2031-04' } })
    expect(state.history.accounts.map(a => a.name)).toEqual(['Quillmark Bank', 'Quillmark Broker'])
  })

  it('the dashboard reads the imported months as balances only: no flows invented, no warnings, every month whole', async () => {
    // every amount in RUB, shown in RUB: no rate is needed
    await importHistory(db, body, actor, NOW)
    const s = await getSnapshot(db, { now: NOW, currency: 'RUB', download: false })
    expect(s.history.map(h => [h.date, h.netWorth])).toEqual([['2031-02-28', 80], ['2031-03-31', 100], ['2031-04-30', 90], ['2031-05-31', 100]])
    // the broker ended in March: April and May are whole, not partial
    expect(s.warnings.filter(w => w.code === 'missing_balance' || w.code === 'missing_cashflow')).toEqual([])
    expect(s.cashflow.avg12m.months).toBe(0)
  })

  it('refuses a sheet with problems and writes nothing; the dry run names them', async () => {
    const bad = { ...body, months: body.months.slice(0, 2) }
    expect((await previewHistoryImport(db, bad, NOW)).problems).toEqual([{ code: 'not_adjacent', params: { month: '2031-04' } }])
    await expect(importHistory(db, bad, actor, NOW)).rejects.toMatchObject({ code: 'history_has_problems', status: 422 })
    expect(all(db, "SELECT count(*) AS n FROM closed_months WHERE closed_by = ''")).toEqual([{ n: 0 }])
    await expect(previewHistoryImport(db, { accounts: 'x' }, NOW)).rejects.toMatchObject({ code: 'invalid_json' })
  })

  it('a wizard month closed by a member named "import" is wizard history: reopenable, never removed with the imports', async () => {
    db.sqlite.exec("INSERT INTO closed_months VALUES ('2031-06', 't', 'import')")
    expect((await getMonthCloseState(db, NOW)).lastClosed).toEqual({ month: '2031-06', reopenable: true })
    await expect(removeImportedHistory(db, actor, NOW)).rejects.toMatchObject({ code: 'no_imported_history' })
  })

  it('an imported month is not reopened one by one; removing the history takes every imported month back', async () => {
    db.sqlite.exec("DELETE FROM closed_months; DELETE FROM assets")
    await importHistory(db, { accounts: [bank], months: [{ month: '2031-06', values: [5] }, { month: '2031-07', values: [6] }] }, actor, NOW)
    await expect(reopenMonth(db, '2031-07', actor, NOW)).rejects.toMatchObject({ code: 'reopen_imported' })
    expect(await removeImportedHistory(db, actor, NOW)).toEqual({ months: ['2031-06', '2031-07'], balances: 2 })
    expect(all(db, 'SELECT count(*) AS n FROM assets')).toEqual([{ n: 0 }])
    expect(all(db, 'SELECT count(*) AS n FROM closed_months')).toEqual([{ n: 0 }])
    expect(all(db, "SELECT op FROM change_log WHERE op LIKE 'history_%' ORDER BY id").map(r => r.op)).toEqual(['history_import', 'history_remove'])
    await expect(removeImportedHistory(db, actor, NOW)).rejects.toMatchObject({ code: 'no_imported_history' })
  })
})
