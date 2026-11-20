// Properties of the catch-up grid (src/domain/catchUp.ts): which months it takes, its rows and what closing writes.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { accountKey } from '../../../src/domain/accounts'
import { catchUpMonths, catchUpProblems, catchUpRows, catchUpWrites } from '../../../src/domain/catchUp'
import { monthEnd, shiftMonth } from '../../../src/domain/dates'
import type { AssetInput } from '../../../src/domain/types'
import { cents, currency, month, months, runs } from '../../helpers/arbitraries'

const RUNS = runs(200)

describe('catchUpMonths', () => {
  it('takes the open months in order up to the first with data, never the newest one', () => {
    fc.assert(fc.property(months(0, 14), fc.array(fc.boolean(), { minLength: 14, maxLength: 14 }), (queue, data) => {
      const hasData = (m: string) => data[queue.indexOf(m)]
      const { months: grid, leftOut } = catchUpMonths(queue, hasData)
      expect(grid).not.toContain(queue.at(-1))
      expect(grid).toEqual(queue.slice(0, grid.length))
      expect(grid.some(hasData)).toBe(false)
      if (leftOut !== null) {
        expect(leftOut).toBe(queue[grid.length])
        expect(hasData(leftOut)).toBe(true)
      } else if (queue.length >= 2) expect(grid).toEqual(queue.slice(0, -1))
      else expect(grid).toEqual([])
    }), RUNS)
  })
})

/** The accounts of the month before the grid, some balances already entered for grid months, and the cells typed */
const grid = fc.record({
  prev: month(),
  count: fc.integer({ min: 1, max: 6 }),
  accounts: fc.uniqueArray(fc.record({ name: fc.constantFrom('Checking', 'Savings', 'Broker', 'Cash'), member: fc.constantFrom('Robin', 'Noa', ''), currency: currency() }),
    { minLength: 1, maxLength: 4, selector: a => accountKey(a.name, a.member) }),
  stored: fc.array(fc.option(cents(-1_000, 100_000), { freq: 2 }), { minLength: 24, maxLength: 24 }),
  typed: fc.array(cents(-1_000, 100_000), { minLength: 24, maxLength: 24 }),
}).map(({ prev, count, accounts, stored, typed }) => {
  const grid = Array.from({ length: count }, (_, i) => shiftMonth(prev, i + 1))
  const assets: AssetInput[] = accounts.map(a => ({ date: monthEnd(prev), class: 'bank', name: a.name, value: 1, currency: a.currency, member: a.member || null }))
  accounts.forEach((a, i) => grid.forEach((m, j) => {
    const v = stored[(i * 6 + j) % stored.length]
    if (v !== null) assets.push({ date: monthEnd(m), class: 'bank', name: a.name, value: v, currency: a.currency, member: a.member || null })
  }))
  return { prev, grid, accounts, assets, typed }
})

describe('catchUpRows and catchUpWrites', () => {
  it('one row per account of the month before, a cell per grid month holding the balance entered for it', () => {
    fc.assert(fc.property(grid, ({ prev, grid, accounts, assets }) => {
      const rows = catchUpRows(prev, grid, assets, [], [], {})
      expect(rows.map(r => accountKey(r.name, r.member)).sort()).toEqual(accounts.map(a => accountKey(a.name, a.member)).sort())
      for (const r of rows) {
        expect(r.cells).toHaveLength(grid.length)
        grid.forEach((m, j) => {
          const entered = assets.find(a => a.date === monthEnd(m) && accountKey(a.name, a.member ?? '') === accountKey(r.name, r.member))
          expect(r.cells[j]).toBe(entered ? entered.value : null)
        })
      }
      // an empty cell is what keeps Close off, month by month
      const missing = grid.map((_, j) => rows.filter(r => r.cells[j] === null).length)
      expect(catchUpProblems(grid, rows)).toEqual(grid.flatMap((m, j) => (missing[j] ? [{ month: m, missing: missing[j] }] : [])))
    }), RUNS)
  })

  it('a filled grid writes exactly its cells: one month-end balance per account and month, nothing else', () => {
    fc.assert(fc.property(grid, ({ prev, grid, assets, typed }) => {
      const rows = catchUpRows(prev, grid, assets, [], [], {}).map((r, i) => ({ ...r, cells: r.cells.map((c, j) => c ?? typed[(i * 6 + j) % typed.length]) }))
      expect(catchUpProblems(grid, rows)).toEqual([])
      const writes = catchUpWrites(grid, rows)
      expect(writes.map(w => w.month)).toEqual(grid)
      writes.forEach((w, j) => {
        expect(w.assets).toHaveLength(rows.length)
        expect(w.assets).toEqual(rows.map(r => ({
          date: monthEnd(grid[j]), class: r.class, name: r.name, value: r.cells[j], currency: r.currency, member: r.member || null,
        })))
      })
    }), RUNS)
  })
})
