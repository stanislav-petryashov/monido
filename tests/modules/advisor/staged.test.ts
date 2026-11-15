import { describe, expect, it } from 'vitest'
import { stage, takeStaged } from '../../../src/modules/advisor/tools/staged'
import { createTestDb } from '../../helpers/db'

const T0 = new Date('2026-01-01T00:00:00Z')
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000)

describe('staged store', () => {
  it('is taken once', () => {
    const db = createTestDb()
    const s = stage(db, 'statement', 1, { a: 1 }, T0)
    expect(s.expiresAt).toBe(T0.getTime() + 30 * 60_000)
    expect(takeStaged<{ a: number }>(db, 'statement', 1, s.id, T0)?.payload).toEqual({ a: 1 })
    expect(takeStaged(db, 'statement', 1, s.id, T0)).toBeNull()
  })

  it('expires after 30 minutes', () => {
    const db = createTestDb()
    const s = stage(db, 'loan', 1, 'x', T0)
    expect(takeStaged(db, 'loan', 1, s.id, minutes(31))).toBeNull()
  })

  it('refuses another user, database and unknown id', () => {
    const db = createTestDb()
    const s = stage(db, 'loan', 1, 'x', T0)
    expect(takeStaged(db, 'loan', 2, s.id, T0)).toBeNull()
    expect(takeStaged(createTestDb(), 'loan', 1, s.id, T0)).toBeNull()
    expect(takeStaged(db, 'loan', 1, 'nope', T0)).toBeNull()
    expect(takeStaged(db, 'loan', 1, s.id, T0)).not.toBeNull()
  })

  it('leaves an item of the other kind in place', () => {
    const db = createTestDb()
    const s = stage(db, 'loan', 1, 'x', T0)
    expect(takeStaged(db, 'statement', 1, s.id, T0)).toBeNull()
    expect(takeStaged(db, 'loan', 1, s.id, T0)?.payload).toBe('x')
  })

  it('keeps 20 statements per user, dropping the oldest on the 21st', () => {
    const db = createTestDb()
    const other = stage(db, 'loan', 1, 'loan', T0)
    const theirs = stage(db, 'statement', 2, 'theirs', T0)
    const ids = Array.from({ length: 21 }, (_, i) => stage(db, 'statement', 1, i, T0).id)
    expect(takeStaged(db, 'statement', 1, ids[0], T0)).toBeNull()
    expect(takeStaged(db, 'statement', 1, ids[1], T0)?.payload).toBe(1)
    expect(takeStaged(db, 'statement', 1, ids[20], T0)?.payload).toBe(20)
    expect(takeStaged(db, 'loan', 1, other.id, T0)).not.toBeNull()
    expect(takeStaged(db, 'statement', 2, theirs.id, T0)).not.toBeNull()
  })

  it('keeps 5 loans per user, dropping the oldest on the sixth', () => {
    const db = createTestDb()
    const ids = Array.from({ length: 6 }, (_, i) => stage(db, 'loan', 1, i, T0).id)
    expect(takeStaged(db, 'loan', 1, ids[0], T0)).toBeNull()
    expect(takeStaged(db, 'loan', 1, ids[1], T0)?.payload).toBe(1)
  })
})
