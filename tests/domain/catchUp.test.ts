import { catchUpMonths, catchUpProblems, cellHint, catchUpRows, catchUpWrites, draftHasData, type CatchUpRow } from '../../src/domain/catchUp'
import type { DraftRow, MonthDraft } from '../../src/domain/monthClose'
import type { AssetInput } from '../../src/domain/types'

const balance = (date: string, name: string, value: number): AssetInput => ({ date, class: 'bank', name, value, currency: 'USD', member: 'Ryan' })
const draftRow = (name: string, o: Partial<DraftRow> = {}): DraftRow => ({
  name, member: 'Ryan', currency: 'USD', class: 'bank', balance: null, active: null, passive: null, expense: null, closing: false, added: false, ...o,
})
const draft = (_month: string, rows: DraftRow[], loans?: MonthDraft['loans']): MonthDraft => ({ rows, ...(loans ? { loans } : {}) })
const row = (name: string, cells: (number | null)[]): CatchUpRow => ({ name, member: 'Ryan', currency: 'USD', class: 'bank', cells })

describe('catchUpMonths', () => {
  const queue = ['2026-07', '2026-08', '2026-09', '2026-10']

  it('takes every open month but the newest', () => {
    expect(catchUpMonths(queue, () => false)).toEqual({ months: ['2026-07', '2026-08', '2026-09'], leftOut: null })
  })

  it('stops at the first month that already has income or expense data and names it', () => {
    expect(catchUpMonths(queue, m => m === '2026-08')).toEqual({ months: ['2026-07'], leftOut: '2026-08' })
    expect(catchUpMonths(queue, m => m === '2026-07')).toEqual({ months: [], leftOut: '2026-07' })
  })

  it('offers nothing below two open months', () => {
    expect(catchUpMonths(['2026-10'], () => false)).toEqual({ months: [], leftOut: null })
    expect(catchUpMonths([], () => false)).toEqual({ months: [], leftOut: null })
  })
})

describe('draftHasData', () => {
  it('is false for balances only, true for any income, expense, transfer, loan amount, added or closing row', () => {
    expect(draftHasData(null)).toBe(false)
    expect(draftHasData(draft('2026-07', [draftRow('Bank', { balance: 100 })]))).toBe(false)
    expect(draftHasData(draft('2026-07', [draftRow('Bank', { expense: 0 })]))).toBe(true)
    expect(draftHasData(draft('2026-07', [draftRow('Bank', { deposited: 50 })]))).toBe(true)
    expect(draftHasData(draft('2026-07', [draftRow('Bank')], [{ name: 'Car', amount: 0 }]))).toBe(true)
    expect(draftHasData(draft('2026-07', [draftRow('Bank')], [{ name: 'Car', amount: null }]))).toBe(false)
    expect(draftHasData(draft('2026-07', [draftRow('Bank', { added: true })]))).toBe(true)
    expect(draftHasData(draft('2026-07', [draftRow('Bank', { closing: true })]))).toBe(true)
  })
})

describe('catchUpRows', () => {
  const months = ['2026-07', '2026-08']
  const assets = [balance('2026-06-30', 'Bank', 9870), balance('2026-06-30', 'Card', -320), balance('2026-06-30', 'Old', 5)]
  const closures = [{ name: 'Old', member: 'Ryan', closedMonth: '2026-06' }]

  it('asks for the accounts of the month before, not one closed then, cells empty', () => {
    expect(catchUpRows('2026-06', months, assets, [], closures, {})).toEqual([row('Bank', [null, null]), row('Card', [null, null])])
  })

  it('starts a cell from a balance already entered for that month, else from a balances-only draft', () => {
    const entered = [...assets, balance('2026-07-31', 'Bank', 10520)]
    const drafts = { '2026-08': draft('2026-08', [draftRow('Card', { balance: -150 })]) }
    expect(catchUpRows('2026-06', months, entered, [], closures, drafts)).toEqual([row('Bank', [10520, null]), row('Card', [null, -150])])
  })
})

describe('catchUpProblems', () => {
  const months = ['2026-07', '2026-08']

  it('names the months with empty cells and how many, oldest first', () => {
    expect(catchUpProblems(months, [row('Bank', [1, null]), row('Card', [2, null])])).toEqual([{ month: '2026-08', missing: 2 }])
  })

  it('accepts a negative balance', () => {
    expect(catchUpProblems(months, [row('Card', [-320, 0])])).toEqual([])
  })
})

describe('catchUpWrites', () => {
  it('writes a month-end balance per account per month and nothing else', () => {
    expect(catchUpWrites(['2026-07', '2026-08'], [row('Bank', [10520, 10900])])).toEqual([
      { month: '2026-07', assets: [{ date: '2026-07-31', class: 'bank', name: 'Bank', value: 10520, currency: 'USD', member: 'Ryan' }] },
      { month: '2026-08', assets: [{ date: '2026-08-31', class: 'bank', name: 'Bank', value: 10900, currency: 'USD', member: 'Ryan' }] },
    ])
  })
})

describe('cellHint', () => {
  it('is the nearest typed cell to the left, else the last known balance', () => {
    expect(cellHint(row('Bank', [10520, null, null]), 2, 9870)).toBe(10520)
    expect(cellHint(row('Bank', [null, null]), 1, 9870)).toBe(9870)
    expect(cellHint(row('Bank', [null]), 0, undefined)).toBeUndefined()
  })
})
