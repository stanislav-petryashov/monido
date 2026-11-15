import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { DbReadConflict, openDatabase as openRaw } from '../../src/server/db'
import { withTempDirs } from '../helpers/tmp'

const opened: ReturnType<typeof openRaw>[] = []
// registered before the afterEach below, so it runs after it: the databases close before their folders go
const tempDir = withTempDirs('ffd-')

/** A database that afterEach closes. */
function openDatabase(file: string) {
  const db = openRaw(file)
  opened.push(db)
  return db
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close()
})

describe('openDatabase', () => {
  it('runs prepare/all/first/run on node:sqlite and reports last_row_id and changes', async () => {
    const db = openDatabase(':memory:')
    await db.prepare('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)').run()
    const inserted = await db.prepare('INSERT INTO t (name) VALUES (?)').bind('a').run()
    expect(inserted.meta).toEqual({ last_row_id: 1, changes: 1 })
    expect((await db.prepare('SELECT name FROM t').all()).results).toEqual([{ name: 'a' }])
    expect(await db.prepare('SELECT name FROM t WHERE id = ?').bind(2).first()).toBeNull()
  })

  it('batch is one transaction: a failing statement rolls back the earlier ones', async () => {
    const db = openDatabase(':memory:')
    await db.prepare('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)').run()
    await expect(db.batch([
      db.prepare("INSERT INTO t (name) VALUES ('ok')"),
      db.prepare('INSERT INTO t (name) VALUES (NULL)'),
    ])).rejects.toThrow(/NOT NULL/)
    expect((await db.prepare('SELECT COUNT(*) AS n FROM t').all()).results).toEqual([{ n: 0 }])
  })

  it('batch is isolated: a concurrent run() is neither inside nor rolled back with a failing batch', async () => {
    const db = openDatabase(':memory:')
    await db.prepare('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)').run()
    const failing = db.batch([
      db.prepare("INSERT INTO t (name) VALUES ('batch-ok')"),
      db.prepare('INSERT INTO t (name) VALUES (NULL)'),
    ])
    const single = db.prepare("INSERT INTO t (name) VALUES ('single')").run()
    const [b, s] = await Promise.allSettled([failing, single])
    expect(b.status).toBe('rejected')
    expect(s.status).toBe('fulfilled')
    expect((await db.prepare('SELECT name FROM t ORDER BY id').all()).results).toEqual([{ name: 'single' }])
  })

  it('two concurrent batches both commit', async () => {
    const db = openDatabase(':memory:')
    await db.prepare('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)').run()
    const ins = (name: string) => db.prepare('INSERT INTO t (name) VALUES (?)').bind(name)
    await Promise.all([db.batch([ins('a1'), ins('a2')]), db.batch([ins('b1'), ins('b2')])])
    expect((await db.prepare('SELECT COUNT(*) AS n FROM t').first())).toEqual({ n: 4 })
  })

  it('waits up to 5 s for a lock held by another connection (busy_timeout)', async () => {
    const db = openDatabase(':memory:')
    expect(await db.prepare('PRAGMA busy_timeout').first()).toEqual({ timeout: 5000 })
  })

  it('opens a file in WAL mode with foreign keys on', async () => {
    const file = join(tempDir(), 'finance.sqlite')
    const db = openDatabase(file)
    expect(await db.prepare('PRAGMA journal_mode').first()).toEqual({ journal_mode: 'wal' })
    expect(await db.prepare('PRAGMA foreign_keys').first()).toEqual({ foreign_keys: 1 })
  })
})


describe('guardedBatch', () => {
  it('commits unchanged reads and reports statement results', async () => {
    const db = openDatabase(':memory:')
    db.sqlite.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
    const token = db.readToken()
    await db.prepare('SELECT * FROM t').all()
    expect(await db.guardedBatch(token, [db.prepare("INSERT INTO t VALUES (1, 'kept')")]))
      .toEqual([{ results: [], meta: { last_row_id: 1, changes: 1 } }])
    expect(await db.prepare('SELECT name FROM t').first()).toEqual({ name: 'kept' })
  })

  it.each(['own', 'external'])('rejects reads invalidated by an %s connection write before changing anything', async source => {
    const file = join(tempDir(), 'guard.sqlite')
    const db = openDatabase(file)
    db.sqlite.exec('CREATE TABLE t (name TEXT)')
    const writer = source === 'own' ? db : openDatabase(file)
    const token = db.readToken()
    await writer.prepare("INSERT INTO t VALUES ('unrelated')").run()
    await expect(db.guardedBatch(token, [db.prepare("INSERT INTO t VALUES ('stale')")])).rejects.toBeInstanceOf(DbReadConflict)
    expect((await db.prepare('SELECT name FROM t').all()).results).toEqual([{ name: 'unrelated' }])
    await db.guardedBatch(db.readToken(), [db.prepare("INSERT INTO t VALUES ('fresh')")])
    expect((await db.prepare('SELECT name FROM t').all()).results).toHaveLength(2)
  })

  it('rejects tokens and statements from another connection', async () => {
    const db = openDatabase(':memory:')
    const other = openDatabase(':memory:')
    db.sqlite.exec('CREATE TABLE t (name TEXT)')
    other.sqlite.exec('CREATE TABLE t (name TEXT)')
    await expect(db.guardedBatch(other.readToken(), [db.prepare("INSERT INTO t VALUES ('foreign token')")])).rejects.toThrow(/token.*database/)
    await expect(db.guardedBatch(db.readToken(), [db.prepare("INSERT INTO t VALUES ('local')"), other.prepare("INSERT INTO t VALUES ('foreign statement')")])).rejects.toThrow(/statements.*database/)
    expect((await db.prepare('SELECT * FROM t').all()).results).toEqual([])
    expect((await other.prepare('SELECT * FROM t').all()).results).toEqual([])
  })

  it('rolls back rows and journal entries without admitting concurrent unguarded writes', async () => {
    const db = openDatabase(':memory:')
    db.sqlite.exec('CREATE TABLE t (name TEXT NOT NULL); CREATE TABLE journal (name TEXT)')
    const failed = db.guardedBatch(db.readToken(), [
      db.prepare("INSERT INTO t VALUES ('rolled back')"),
      db.prepare("INSERT INTO journal VALUES ('rolled back')"),
      db.prepare('INSERT INTO t VALUES (NULL)'),
    ])
    const unrelated = db.prepare("INSERT INTO t VALUES ('unrelated')").run()
    const results = await Promise.allSettled([failed, unrelated])
    expect(results[0]).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('NOT NULL') }) })
    expect(results[1].status).toBe('fulfilled')
    expect((await db.prepare('SELECT * FROM t').all()).results).toEqual([{ name: 'unrelated' }])
    expect((await db.prepare('SELECT * FROM journal').all()).results).toEqual([])
  })
})
