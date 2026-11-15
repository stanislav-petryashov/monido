import { describe, expect, it } from 'vitest'
import { allocatedByFlow, allocationExcess, allocationSummary, categorisedMonths, mandatorySpending, totalsOfLines } from '../../src/domain/spending'
import type { CashflowRowBase, CategorySpendingInput, FlowLineInput, ManualMandatory, RateLookup, SpendingCategory, Warning } from '../../src/domain/types'

const rateAt: RateLookup = () => ({ RUB: 75, EUR: 0.9 })
const CATS: SpendingCategory[] = [
  { id: 1, name: 'loan_payments', kind: 'loan_payment', flow: 'expense', oneOff: false },
  { id: 2, name: 'Groceries', kind: 'mandatory', flow: 'expense', oneOff: false },
  { id: 3, name: 'Cinema', kind: 'optional', flow: 'expense', oneOff: false },
  { id: 4, name: 'Rent', kind: 'mandatory', flow: 'expense', oneOff: false },
]
/** The expense months of free-source rows only, as before account lines existed. */
const spendingMonths = (rows: CategorySpendingInput[], categories: SpendingCategory[], cfRows: CashflowRowBase[], rates: RateLookup, base: string) =>
  categorisedMonths({ categorySpending: rows, flowLines: [] }, categories, cfRows, 'expense', rates, base)
const spend = (date: string, category_id: number, amount: number, source = 'Bank A', currency = 'USD'): CategorySpendingInput =>
  ({ date, category_id, source, amount, currency })
const cf = (month: string, expense: number, loan = false): CashflowRowBase => ({
  month, bank: loan ? 'Car' : 'A', member: 'Robin', currency: 'USD', ...(loan ? { loan: true as const } : {}),
  active: 0, passive: 0, expense, activeBase: 0, passiveBase: 0, expenseBase: expense,
})

describe('categorisedMonths: free sources (expenses as before)', () => {
  it('two sources of one month add up per category', () => {
    const [m] = spendingMonths([spend('2031-05-01', 2, 100, 'Bank A'), spend('2031-05-01', 2, 50, 'Bank B'), spend('2031-05-01', 3, 20)], CATS, [], rateAt, 'USD')
    expect(m.month).toBe('2031-05')
    expect(m.categories).toEqual([
      { categoryId: 2, name: 'Groceries', kind: 'mandatory', flow: 'expense', oneOff: false, amountBase: 150 },
      { categoryId: 3, name: 'Cinema', kind: 'optional', flow: 'expense', oneOff: false, amountBase: 20 },
    ])
    expect(m.allocatedBase).toBe(170)
  })

  it('lists the months with data, oldest first, converting at the rate of the first day', () => {
    const months = spendingMonths([spend('2031-06-01', 2, 7500, 'Bank A', 'RUB'), spend('2031-04-01', 2, 10)], CATS, [], rateAt, 'USD')
    expect(months.map(m => m.month)).toEqual(['2031-04', '2031-06'])
    expect(months[1].categories[0].amountBase).toBe(100)
  })

  it('coverage is the categorised total over the month’s expenses, loan rows included', () => {
    const [m] = spendingMonths([spend('2031-05-01', 2, 600), spend('2031-05-01', 1, 200)], CATS, [cf('2031-05', 800), cf('2031-05', 200, true), cf('2031-04', 5000)], rateAt, 'USD')
    expect(m.totalBase).toBe(1000)
    expect(m.coveragePct).toBe(80)
  })

  it('has no coverage without expenses in the month', () => {
    const [m] = spendingMonths([spend('2031-05-01', 2, 600)], CATS, [], rateAt, 'USD')
    expect(m.totalBase).toBeNull()
    expect(m.coveragePct).toBeNull()
  })

  it('a category in a currency without a rate is null and left out of the total', () => {
    const [m] = spendingMonths([spend('2031-05-01', 2, 100), spend('2031-05-01', 3, 50, 'Bank A', 'GBP')], CATS, [], rateAt, 'USD')
    expect(m.categories.find(c => c.categoryId === 3)?.amountBase).toBeNull()
    expect(m.allocatedBase).toBe(100)
  })

  it('ignores a row of an unknown category', () => {
    expect(spendingMonths([spend('2031-05-01', 99, 100)], CATS, [], rateAt, 'USD')).toEqual([])
  })
})

describe('mandatorySpending', () => {
  const months = (rows: CategorySpendingInput[]) => spendingMonths(rows, CATS, [], rateAt, 'USD')
  const manual: ManualMandatory = { amount: 900, currency: 'EUR', updated_at: '2031-03-10' }

  it('a loan_payment category counts toward coverage but never toward mandatory', () => {
    const rows = [spend('2031-06-01', 2, 500), spend('2031-06-01', 1, 400), spend('2031-06-01', 3, 90)]
    const [m] = spendingMonths(rows, CATS, [cf('2031-06', 1000)], rateAt, 'USD')
    expect(m.coveragePct).toBe(99)
    expect(mandatorySpending([m], '2031-06', null, {}, 'USD')).toEqual({ perMonthBase: 500, source: 'categories', months: 1, updatedAt: null })
  })

  it('mandatory averages the mandatory categories over the closed months of the last three that have data', () => {
    const m = months([spend('2031-04-01', 2, 300), spend('2031-06-01', 2, 500), spend('2031-06-01', 3, 80)])
    expect(mandatorySpending(m, '2031-06', null, {}, 'USD')).toEqual({ perMonthBase: 400, source: 'categories', months: 2, updatedAt: null })
  })

  it('a month older than the three-month window is ignored', () => {
    const m = months([spend('2031-02-01', 2, 9000), spend('2031-04-01', 2, 300), spend('2031-06-01', 2, 500)])
    expect(mandatorySpending(m, '2031-06', null, {}, 'USD')).toMatchObject({ perMonthBase: 400, months: 2 })
  })

  it('without category data the manual amount is used at today’s rate, with its date', () => {
    expect(mandatorySpending([], '2031-06', manual, { EUR: 0.9 }, 'USD')).toEqual({ perMonthBase: 1000, source: 'manual', months: 0, updatedAt: '2031-03-10' })
  })

  it('falls back to the manual amount when the data is all older than the window', () => {
    const m = months([spend('2031-01-01', 2, 300)])
    expect(mandatorySpending(m, '2031-06', manual, { EUR: 0.9 }, 'USD')).toMatchObject({ source: 'manual', perMonthBase: 1000 })
  })

  it('a manual amount in the base currency needs no rate', () => {
    expect(mandatorySpending([], null, { amount: 700, currency: 'USD', updated_at: 't' }, {}, 'USD')).toMatchObject({ perMonthBase: 700, source: 'manual' })
  })

  it('a manual amount in a currency without a rate gives null', () => {
    expect(mandatorySpending([], '2031-06', { ...manual, currency: 'GBP' }, { EUR: 0.9 }, 'USD')).toBeNull()
  })

  it('nothing at all gives null', () => {
    expect(mandatorySpending([], null, null, {}, 'USD')).toBeNull()
  })

  it('without a mandatory-kind amount in the window the average does not count: the manual amount is used, or nothing', () => {
    const m = months([spend('2031-06-01', 3, 80), spend('2031-06-01', 1, 400)])
    expect(mandatorySpending(m, '2031-06', manual, { EUR: 0.9 }, 'USD')).toMatchObject({ source: 'manual', perMonthBase: 1000 })
    expect(mandatorySpending(m, '2031-06', null, {}, 'USD')).toBeNull()
  })

  it('a mandatory amount without a rate in the window gives null, not a sum without it and not the manual amount', () => {
    const m = months([spend('2031-05-01', 2, 300), spend('2031-06-01', 4, 500, 'Bank A', 'GBP')])
    expect(mandatorySpending(m, '2031-06', manual, { EUR: 0.9 }, 'USD')).toBeNull()
  })

  it('an optional amount without a rate does not matter', () => {
    const m = months([spend('2031-06-01', 2, 300), spend('2031-06-01', 3, 50, 'Bank A', 'GBP')])
    expect(mandatorySpending(m, '2031-06', null, {}, 'USD')).toMatchObject({ perMonthBase: 300 })
  })

  it('categories win over the manual amount', () => {
    const m = months([spend('2031-06-01', 4, 650)])
    expect(mandatorySpending(m, '2031-06', manual, { EUR: 0.9 }, 'USD')).toMatchObject({ perMonthBase: 650, source: 'categories' })
  })
})

describe('categorisedMonths: account lines', () => {
  const SALARY: SpendingCategory = { id: 10, name: 'Salary', kind: 'optional', flow: 'active', oneOff: false }
  const BONUS: SpendingCategory = { id: 11, name: 'Bonus', kind: 'optional', flow: 'active', oneOff: true }
  const DIVIDENDS: SpendingCategory = { id: 12, name: 'Dividends', kind: 'optional', flow: 'passive', oneOff: false }
  const ALL = [...CATS, SALARY, BONUS, DIVIDENDS]
  const line = (bank: string, category_id: number, amount: number, member = 'Robin', date = '2031-05-01'): FlowLineInput => ({ date, bank, member, category_id, amount })
  const account = (bank: string, { active = 0, passive = 0, expense = 0 }: { active?: number; passive?: number; expense?: number }, currency = 'USD'): CashflowRowBase => {
    const rate = currency === 'EUR' ? 1 / 0.9 : 1
    return {
      month: '2031-05', bank, member: 'Robin', currency, active, passive, expense,
      activeBase: active * rate, passiveBase: passive * rate, expenseBase: expense * rate,
    }
  }
  const run = (lines: FlowLineInput[], cfRows: CashflowRowBase[], direction: 'income' | 'expense', free: CategorySpendingInput[] = []) => {
    const warnings: Warning[] = []
    const months = categorisedMonths({ categorySpending: free, flowLines: lines }, ALL, cfRows, direction, rateAt, 'USD', w => warnings.push(w))
    return { months, warnings }
  }

  it('income: the lines by category, the remainder per flow, the one-off sum and the coverage', () => {
    const { months: [m], warnings } = run(
      [line('A', 10, 1000), line('A', 11, 200), line('A', 12, 50), line('A', 2, 300)],
      [account('A', { active: 1500, passive: 50, expense: 800 })], 'income',
    )
    expect(warnings).toEqual([])
    expect(m.categories.map(c => [c.name, c.amountBase, c.oneOff])).toEqual([['Salary', 1000, false], ['Bonus', 200, true], ['Dividends', 50, false]])
    expect(m).toMatchObject({ allocatedBase: 1250, totalBase: 1550, unallocatedBase: 300, oneOffBase: 200, coveragePct: 80.65 })
    expect(m.byFlow).toEqual({
      active: { allocatedBase: 1200, totalBase: 1500, unallocatedBase: 300 },
      passive: { allocatedBase: 50, totalBase: 50, unallocatedBase: 0 },
    })
  })

  it('converts a line in its account row’s currency, at the rate of the month’s first day', () => {
    const { months: [m] } = run([line('A', 10, 900)], [account('A', { active: 900 }, 'EUR')], 'income')
    expect(m.categories[0].amountBase).toBe(1000)
    expect(m.unallocatedBase).toBe(0)
  })

  it('clamps an over-allocated account per account: it does not hide under another account’s remainder', () => {
    const { months: [m], warnings } = run(
      [line('A', 10, 700), line('B', 10, 100)],
      [account('A', { active: 500 }), account('B', { active: 400 })], 'income',
    )
    expect(m.unallocatedBase).toBe(300)
    // only the remainder is clamped: the categories and the coverage keep the full lines, as the warning says
    expect(m).toMatchObject({ allocatedBase: 800, totalBase: 900 })
    expect(m.categories[0].amountBase).toBe(800)
    expect(warnings).toEqual([{ code: 'lines_exceed_total', params: { context: 'active', month: '2031-05', name: 'A', member: 'Robin', lines: 700, total: 500 } }])
  })

  it('leaves out lines whose account row is missing and warns once per month with their count', () => {
    const { months, warnings } = run([line('Gone', 10, 100), line('Gone', 2, 50), line('A', 10, 10)], [account('A', { active: 10 })], 'income')
    expect(months[0].categories.map(c => c.amountBase)).toEqual([10])
    expect(warnings).toEqual([{ code: 'orphan_lines', params: { month: '2031-05', count: 2 } }])
    // a month with only orphaned lines is not listed (no 0 %)
    expect(run([line('Gone', 10, 100)], [account('A', { active: 10 })], 'income').months).toEqual([])
  })

  it('expenses: account lines and free sources add up per category; free sources reduce the pooled remainder', () => {
    const { months: [m], warnings } = run(
      [line('A', 2, 300)],
      [account('A', { expense: 1000 })], 'expense', [spend('2031-05-01', 2, 100, 'Card'), spend('2031-05-01', 3, 50, 'Card')],
    )
    expect(warnings).toEqual([])
    expect(m.categories.map(c => [c.name, c.amountBase])).toEqual([['Groceries', 400], ['Cinema', 50]])
    expect(m).toMatchObject({ allocatedBase: 450, totalBase: 1000, unallocatedBase: 550, coveragePct: 45 })
    expect(m.byFlow).toBeUndefined()
    expect(m.oneOffBase).toBeUndefined()
  })

  it('the pool holds the loan rows’ expense: a legacy card loan_payment line against a loan row gives no warning', () => {
    const loanRow: CashflowRowBase = { ...cf('2031-05', 200, true) }
    const { months: [m], warnings } = run([line('A', 2, 1000)], [account('A', { expense: 1000 }), loanRow], 'expense', [spend('2031-05-01', 1, 200, 'Card')])
    expect(warnings).toEqual([])
    expect(m).toMatchObject({ totalBase: 1200, allocatedBase: 1200, unallocatedBase: 0, coveragePct: 100 })
  })

  it('free-source lines over the pool are clamped to 0 and warned (the soft cap)', () => {
    const { months: [m], warnings } = run([line('A', 2, 900)], [account('A', { expense: 1000 })], 'expense', [spend('2031-05-01', 3, 300, 'Card')])
    expect(m.unallocatedBase).toBe(0)
    expect(warnings).toEqual([{ code: 'lines_exceed_total', params: { context: 'sources', month: '2031-05', lines: 300, total: 100 } }])
  })

  it('income lines never reach the expense months or the mandatory average', () => {
    const { months } = run([line('A', 10, 1000)], [account('A', { active: 1000, expense: 500 })], 'expense')
    expect(months).toEqual([])
    const expense = run([line('A', 2, 300), line('A', 10, 1000)], [account('A', { active: 1000, expense: 500 })], 'expense').months
    expect(expense[0].categories.map(c => c.flow)).toEqual(['expense'])
    expect(mandatorySpending(expense, '2031-05', null, {}, 'USD')).toMatchObject({ perMonthBase: 300 })
  })

  it('an account without a rate gives null amounts and no excess', () => {
    const noRate: CashflowRowBase = { ...account('A', { active: 100 }, 'GBP'), activeBase: null, passiveBase: null, expenseBase: null }
    const { months: [m], warnings } = run([line('A', 10, 500)], [noRate], 'income')
    expect(m.categories[0].amountBase).toBeNull()
    expect(m).toMatchObject({ totalBase: null, unallocatedBase: null, coveragePct: null })
    expect(m.byFlow).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('a month with totals but no lines of the direction is not listed (a month before lines is not 0 %)', () => {
    expect(run([], [account('A', { active: 1000, expense: 500 })], 'income').months).toEqual([])
    expect(run([line('A', 2, 100)], [account('A', { active: 1000, expense: 500 })], 'income').months).toEqual([])
  })
})

describe('allocationExcess and totalsOfLines', () => {
  const CATEGORIES: SpendingCategory[] = [
    ...CATS, { id: 10, name: 'Salary', kind: 'optional', flow: 'active', oneOff: false }, { id: 12, name: 'Dividends', kind: 'optional', flow: 'passive', oneOff: false },
  ]
  it('names each flow whose lines exceed the total, beyond a 0.005 rounding', () => {
    const lines = [{ categoryId: 10, amount: 100.004 }, { categoryId: 12, amount: 60 }, { categoryId: 2, amount: 30.1 }, { categoryId: 3, amount: 0.2 }]
    expect(allocationExcess(lines, CATEGORIES, { active: 100, passive: 50, expense: 30.3 })).toEqual([{ flow: 'passive', lines: 60, total: 50 }])
    expect(allocationExcess(lines, CATEGORIES, { active: 100, passive: 60, expense: 30 })).toEqual([{ flow: 'expense', lines: 30.3, total: 30 }])
  })

  it('a total not filled in caps nothing', () => {
    expect(allocationExcess([{ categoryId: 10, amount: 100 }], CATEGORIES, { active: null, passive: null, expense: null })).toEqual([])
  })

  it('sums lines per flow and refuses an unknown or the reserved category', () => {
    expect(totalsOfLines([{ categoryId: 10, amount: 0.1 }, { categoryId: 10, amount: 0.2 }, { categoryId: 2, amount: 5 }], CATEGORIES)).toEqual({ active: 0.3, passive: 0, expense: 5 })
    expect(() => totalsOfLines([{ categoryId: 99, amount: 1 }], CATEGORIES)).toThrow('invalid_category_flow')
    expect(() => totalsOfLines([{ categoryId: 1, amount: 1 }], CATEGORIES)).toThrow('invalid_category_flow')
  })
})

describe('allocatedByFlow and allocationSummary (the allocation editor\'s header)', () => {
  const CATEGORIES: SpendingCategory[] = [
    ...CATS, { id: 10, name: 'Salary', kind: 'optional', flow: 'active', oneOff: false }, { id: 12, name: 'Dividends', kind: 'optional', flow: 'passive', oneOff: false },
  ]

  it('sums lines per flow and skips a category it does not know (deleted meanwhile)', () => {
    expect(allocatedByFlow([{ categoryId: 10, amount: 0.1 }, { categoryId: 10, amount: 0.2 }, { categoryId: 2, amount: 5 }, { categoryId: 99, amount: 7 }], CATEGORIES))
      .toEqual({ active: 0.3, passive: 0, expense: 5 })
  })

  it('income is both income totals; the rest is per flow, never hidden by another flow', () => {
    const totals = { active: 100, passive: 50, expense: 80 }
    expect(allocationSummary({ active: 90, passive: 0, expense: 80 }, totals, 'income')).toEqual({ total: 150, allocated: 90, rest: 60, over: [] })
    expect(allocationSummary({ active: 90, passive: 0, expense: 80 }, totals, 'expense')).toEqual({ total: 80, allocated: 80, rest: 0, over: [] })
    // active over by 20, passive left whole: the rest is passive's 50, not 150 − 120
    expect(allocationSummary({ active: 120, passive: 0, expense: 0 }, totals, 'income')).toEqual({ total: 150, allocated: 120, rest: 50, over: ['active'] })
    expect(allocationSummary({ active: 100.004, passive: 0, expense: 0 }, totals, 'income').over).toEqual([])
  })

  it('a total not filled in (or no account row) gives no total and no rest', () => {
    expect(allocationSummary({ active: 10, passive: 0, expense: 0 }, { active: 100, passive: null, expense: null }, 'income')).toEqual({ total: null, allocated: 10, rest: null, over: [] })
    expect(allocationSummary({ active: 0, passive: 0, expense: 5 }, null, 'expense')).toEqual({ total: null, allocated: 5, rest: null, over: [] })
  })
})
