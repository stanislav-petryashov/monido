import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase, type SqliteDatabase } from '../../src/server/db'
import { InputError } from '../../src/server/http'
import { commitMutation } from '../../src/server/mutations'

const opened: SqliteDatabase[] = []
function database() {
  const db = openDatabase(':memory:')
  opened.push(db)
  db.sqlite.exec("CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER); INSERT INTO counters VALUES ('main', 0)")
  return db
}
afterEach(() => { for (const db of opened.splice(0)) db.close() })

describe('commitMutation', () => {
  it('rebuilds once after an own-connection conflict and preserves the intervening write', async () => {
    const db = database()
    let calls = 0
    const result = await commitMutation(db, async () => {
      calls++
      const row = await db.prepare("SELECT value FROM counters WHERE name = 'main'").first<{ value: number }>()
      if (calls === 1) await db.prepare("UPDATE counters SET value = 10 WHERE name = 'main'").run()
      return { statements: [db.prepare("UPDATE counters SET value = ? WHERE name = 'main'").bind(row!.value + 1)], result: row!.value + 1 }
    })
    expect(calls).toBe(2)
    expect(result).toBe(11)
    expect(await db.prepare('SELECT value FROM counters').first()).toEqual({ value: 11 })
  })

  it.each([undefined, 'draft_conflict'])('stops after three conflicts with code %s', async code => {
    const db = database()
    let calls = 0
    await expect(commitMutation(db, async () => {
      calls++
      await db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'main'").run()
      return { statements: [db.prepare("UPDATE counters SET value = 100 WHERE name = 'main'")], result: null }
    }, code)).rejects.toMatchObject({ code: code ?? 'data_conflict', status: 409 })
    expect(calls).toBe(3)
    expect(await db.prepare('SELECT value FROM counters').first()).toEqual({ value: 3 })
  })

  it('propagates validation errors without retries or writes', async () => {
    const db = database()
    let calls = 0
    const failure = new InputError('invalid_value')
    await expect(commitMutation(db, async () => { calls++; throw failure })).rejects.toBe(failure)
    expect(calls).toBe(1)
    expect(await db.prepare('SELECT value FROM counters').first()).toEqual({ value: 0 })
  })

  it('propagates commit errors immediately and rolls back the whole plan', async () => {
    const db = database()
    let calls = 0
    await expect(commitMutation(db, async () => {
      calls++
      return { statements: [db.prepare("UPDATE counters SET value = 5"), db.prepare("INSERT INTO counters VALUES ('main', 2)")], result: null }
    })).rejects.toThrow(/UNIQUE/)
    expect(calls).toBe(1)
    expect(await db.prepare('SELECT value FROM counters').first()).toEqual({ value: 0 })
  })
})
