import { describe, expect, it } from 'vitest'
import type { DraftRow } from '../../src/domain/monthClose'
import { applyStatement, carriedFigures } from '../../src/domain/statements'

const row = (over: Partial<DraftRow> = {}): DraftRow => ({
  name: 'Quillmark Bank', member: 'Anna', currency: 'EUR', class: 'bank',
  balance: null, active: null, passive: null, expense: null, closing: false, added: false, ...over,
})
const acc = (over: Partial<{ name: string; member: string; currency: string }> = {}) =>
  ({ name: 'Quillmark Bank', member: 'Anna', currency: 'EUR', ...over })

describe('applyStatement', () => {
  const empty = { rows: [row()], loans: [] as { name: string; amount: number | null }[] }

  it('fills an existing row with all-zero figures as values, not null', () => {
    const out = applyStatement(empty, acc(), { balance: 0, active: 0, passive: 0, expense: 0 }, [])
    expect(out.rows[0]).toMatchObject({ balance: 0, active: 0, passive: 0, expense: 0 })
    expect(empty.rows[0].balance).toBeNull()
  })
  it('keeps fields not given when the row existed', () => {
    const d = { rows: [row({ balance: 5, active: 6, passive: 7, expense: 8 })], loans: [] }
    expect(applyStatement(d, acc(), { balance: 10 }, []).rows[0]).toMatchObject({ balance: 10, active: 6, passive: 7, expense: 8 })
  })
  it('keeps accounts with the same name and another member apart', () => {
    const d = { rows: [row(), row({ member: 'Boris' })], loans: [] }
    const out = applyStatement(d, acc({ member: 'Boris' }), { balance: 9, active: 1, passive: 2, expense: 3 }, [])
    expect(out.rows[0].balance).toBeNull()
    expect(out.rows[1]).toMatchObject({ member: 'Boris', balance: 9 })
  })
  it('sets a loan line, overwrites it, and leaves another loan alone', () => {
    const d = { rows: [row()], loans: [{ name: 'Mortgage', amount: 100 }] }
    const once = applyStatement(d, acc(), { balance: 1 }, [{ name: 'Car', amount: 50 }])
    expect(once.loans).toEqual([{ name: 'Mortgage', amount: 100 }, { name: 'Car', amount: 50 }])
    const twice = applyStatement(once, acc(), { balance: 1 }, [{ name: 'Car', amount: 70 }])
    expect(twice.loans).toEqual([{ name: 'Mortgage', amount: 100 }, { name: 'Car', amount: 70 }])
  })
  it('never writes a loan line\'s bank balance into the draft: only the name and the amount', () => {
    const d = { rows: [row()], loans: [{ name: 'Mortgage', amount: 100 }] }
    const out = applyStatement(d, acc(), { balance: 1 }, [{ name: 'Mortgage', amount: 90, balance: 5000 }, { name: 'Car', amount: 50, balance: 700 }])
    expect(out.loans).toEqual([{ name: 'Mortgage', amount: 90 }, { name: 'Car', amount: 50 }])
  })
  it('throws for an unknown account without added', () => {
    expect(() => applyStatement(empty, acc({ name: 'Nowhere' }), { balance: 1 }, [])).toThrow('unknown_account')
    expect(() => applyStatement(empty, { ...acc({ name: 'Nowhere' }), added: true }, { balance: 1 }, [])).toThrow('unknown_account')
  })
  it('adds a new row with added and a class', () => {
    const out = applyStatement(empty, { ...acc({ name: 'New' }), added: true, class: 'broker' }, { balance: 3, active: 1 }, [])
    expect(out.rows[1]).toEqual({
      name: 'New', member: 'Anna', currency: 'EUR', class: 'broker',
      balance: 3, active: 1, passive: null, expense: null, closing: false, added: true,
    })
  })
})

describe('carriedFigures', () => {
  it('carries the balance with zero flows', () => {
    expect(carriedFigures(120)).toEqual({ balance: 120, active: 0, passive: 0, expense: 0 })
  })
})

it('keeps pipe-colliding identities distinct', () => {
  const draft = { rows: [row({ name: 'A|B', member: 'C', balance: 10 }), row({ name: 'A', member: 'B|C', balance: 20 })], loans: [] }
  const out = applyStatement(draft, acc({ name: 'A|B', member: 'C' }), { balance: 15 }, [])
  expect(out.rows.map(r => r.balance)).toEqual([15, 20])
  expect(draft.rows.map(r => r.balance)).toEqual([10, 20])
})
