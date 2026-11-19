import { describe, expect, it } from 'vitest'
import { monthChange, type MonthChangeInput } from '../../src/domain/capitalChange'
import { round2 } from '../../src/domain/fx'
import type { ScheduleRow } from '../../src/domain/loans'
import type { AccountValue, CapitalSnapshot, CashflowRowBase, LoanBalance, MonthChange, RealEstateValue } from '../../src/domain/types'

// A RUB family; the dollar is 92 ₽ at the end of February and 82 ₽ at the end of March.
const START = '2026-02-28', END = '2026-03-31', MONTH = '2026-03'
const usdIn = (date: string) => (date <= START ? 92 : 82)
const rateAt = (date: string) => ({ RUB: usdIn(date) })
const rub = (currency: string, date: string) => (currency === 'USD' ? usdIn(date) : 1)

const acc = (date: string, name: string, value: number, o: Partial<AccountValue> = {}): AccountValue => {
  const currency = o.currency ?? 'RUB'
  return { name, member: o.member ?? 'Ira', class: o.class ?? 'bank', currency, value, valueBase: round2(value * rub(currency, date)), ...o }
}
const home = (name: string, value: number): RealEstateValue => ({ name, member: '', currency: 'RUB', value, valueBase: value })
const debt = (date: string, name: string, balance: number, currency = 'RUB'): LoanBalance => ({
  name, member: 'Oleg', type: 'mortgage', currency, rate: 10, balance, balanceBase: round2(balance * rub(currency, date)),
  payment: 0, paymentBase: 0, repaidPct: null, interestNext12m: 0, interestNext12mBase: 0,
})
const cap = (date: string, accounts: AccountValue[], realEstate: RealEstateValue[] = [], loans: LoanBalance[] = []): CapitalSnapshot => {
  const sum = (xs: (number | null)[]) => round2(xs.reduce<number>((a, b) => a + (b ?? 0), 0))
  const assets = sum([...accounts.map(a => a.valueBase), ...realEstate.map(r => r.valueBase)])
  const liabilities = sum(loans.map(l => l.balanceBase))
  return { date, assets, liabilities, netWorth: round2(assets - liabilities), liquid: 0, byClass: [], byCurrency: [], byMember: [], accounts, realEstate, loans, securedLoans: [] }
}
const flow = (bank: string, o: { active?: number; passive?: number; expense?: number; currency?: string; member?: string; loan?: true } = {}): CashflowRowBase => {
  const currency = o.currency ?? 'RUB', r = rub(currency, '2026-03-01')
  const [active, passive, expense] = [o.active ?? 0, o.passive ?? 0, o.expense ?? 0]
  return { month: MONTH, bank, member: o.member ?? 'Ira', currency, ...(o.loan ? { loan: true as const } : {}),
    active, passive, expense, activeBase: round2(active * r), passiveBase: round2(passive * r), expenseBase: round2(expense * r) }
}
const srow = (date: string, principalPart: number, early = 0, earlyPrincipal = early): ScheduleRow => ({
  rowNum: 1, date, openingBalance: 0, scheduledPayment: principalPart, principalPart, interest: 0, earlyPayment: early, earlyPrincipal, closingBalance: 0,
})

const input = (start: CapitalSnapshot | null, end: CapitalSnapshot, o: Partial<MonthChangeInput> = {}): MonthChangeInput => ({
  month: MONTH, start, end, startComplete: true, endComplete: true, rateAt, base: 'RUB',
  flows: [], schedules: new Map(), transfers: [], ...o,
})
const total = (m: MonthChange) => round2(Object.values(m.rows).reduce((a, b) => a + (b ?? 0), 0))
const change = (i: MonthChangeInput) => monthChange(i) as MonthChange

describe('monthChange', () => {
  // saved 85 000 (income 200 000, expenses 55 000, the mortgage payment 60 000 of which 22 000 principal), a USD deposit
  const march = input(
    cap(START, [acc(START, 'Checking', 1_000_000), acc(START, 'USD deposit', 29_000, { currency: 'USD' })], [], [debt(START, 'Mortgage', 5_000_000)]),
    cap(END, [acc(END, 'Checking', 1_085_000), acc(END, 'USD deposit', 29_000, { currency: 'USD' })], [], [debt(END, 'Mortgage', 4_978_000)]),
    { flows: [flow('Checking', { active: 200_000, expense: 55_000 }), flow('Mortgage', { expense: 60_000, loan: true, member: 'Oleg' })], schedules: new Map([['Mortgage', [srow('2026-03-15', 22_000)]]]) },
  )

  it('adds up to the net-worth change to the cent', () => {
    const m = change(march)
    expect(total(m)).toBe(round2(m.end - m.start))
  })

  it('puts the rate move of a USD deposit into fx: 29 000 $ at 92 → 82 is −290 000', () => {
    const m = change(march)
    expect(m.rows).toMatchObject({ saved: 85_000, debtPaid: 22_000, fx: -290_000, unexplained: 0 })
    expect(m.items.fx).toContainEqual(expect.objectContaining({ name: 'USD deposit', amount: -290_000, native: 29_000 }))
    expect(m.rates).toEqual([{ currency: 'USD', start: 92, end: 82 }])
  })

  it('counts only scheduled principal as debtPaid and the rate move of a foreign-currency loan as fx', () => {
    const m = change(input(
      cap(START, [acc(START, 'Checking', 1_000_000)], [], [debt(START, 'Car loan', 10_000, 'USD')]),
      cap(END, [acc(END, 'Checking', 1_075_400)], [], [debt(END, 'Car loan', 9_800, 'USD')]),
      { flows: [flow('Checking', { active: 100_000 }), flow('Car loan', { expense: 300, currency: 'USD', loan: true })], schedules: new Map([['Car loan', [srow('2026-03-10', 200)]]]) },
    ))
    expect(m.rows).toMatchObject({ saved: 75_400, debtPaid: 16_400, fx: 100_000, unexplained: 0 })
  })

  const earlyMonth = (income: number, checkingEnd: number, credited = 300_000) => input(
    cap(START, [acc(START, 'Checking', 1_000_000)], [], [debt(START, 'Mortgage', 5_000_000)]),
    cap(END, [acc(END, 'Checking', checkingEnd)], [], [debt(END, 'Mortgage', 5_000_000 - 22_000 - credited)]),
    { flows: [flow('Checking', { active: income, expense: 55_000 }), flow('Mortgage', { expense: 60_000, loan: true, member: 'Oleg' })],
      schedules: new Map([['Mortgage', [srow('2026-03-15', 22_000, 300_000, credited)]]]) },
  )

  it('treats an early repayment from past savings as a neutral pair', () => {
    const m = change(earlyMonth(200_000, 785_000))
    expect(m.rows).toMatchObject({ saved: 85_000, debtPaid: 22_000, moves: 0, unexplained: 0 })
    expect(m.pairs).toContainEqual({ kind: 'early', name: 'Mortgage', amount: 300_000 })
    expect(m.pairs).toContainEqual({ kind: 'accounts', name: '', amount: -300_000 })
  })

  it('treats an early repayment from the income of this month the same way', () => {
    expect(change(earlyMonth(500_000, 1_085_000)).rows).toMatchObject({ saved: 385_000, debtPaid: 22_000, moves: 0, unexplained: 0 })
  })

  it('shows the interest of an early repayment as its own negative row', () => {
    const m = change(earlyMonth(200_000, 785_000, 296_500))
    expect(m.rows).toMatchObject({ earlyInterest: -3_500, unexplained: 0 })
    expect(total(m)).toBe(round2(m.end - m.start))
  })

  it('makes a flat bought with a mortgage a zero row with its pairs', () => {
    const m = change(input(
      cap(START, [acc(START, 'Checking', 1_000_000)]),
      cap(END, [acc(END, 'Checking', 500_000)], [home('Flat', 6_500_000)], [debt(END, 'New mortgage', 6_000_000)]),
      { flows: [flow('Checking')] },
    ))
    expect(m.rows).toMatchObject({ moves: 0, unexplained: 0 })
    expect(m.pairs.map(p => p.kind)).toEqual(['purchase', 'newLoan', 'accounts'])
    expect(m.pairs.map(p => p.amount)).toEqual([6_500_000, -6_000_000, -500_000])
    expect(m.candidates).toEqual([])
  })

  const brokerMonth = (transfers: MonthChangeInput['transfers']) => input(
    cap(START, [acc(START, 'Checking', 1_000_000), acc(START, 'Broker', 1_000_000, { class: 'broker' })]),
    cap(END, [acc(END, 'Checking', 1_070_000), acc(END, 'Broker', 1_060_000, { class: 'broker' })]),
    { flows: [flow('Checking', { active: 100_000 }), flow('Broker', { passive: 5_000 })], transfers },
  )

  it('takes the investment result net of deposits and of the dividends of the account', () => {
    const m = change(brokerMonth([{ name: 'Broker', member: 'Ira', amount: 30_000 }]))
    expect(m.rows).toMatchObject({ saved: 105_000, investments: 25_000, unexplained: 0 })
  })

  it('leaves an investment account without a transfer row to unexplained and names it', () => {
    const m = change(brokerMonth([]))
    expect(m.rows).toMatchObject({ investments: 0, unexplained: 25_000 })
    expect(m.candidates).toContainEqual({ name: 'Broker', member: 'Ira', reason: 'no_transfer', change: 60_000 })
  })

  it('names an account that moved with no income or expense recorded as a candidate', () => {
    const m = change(input(
      cap(START, [acc(START, 'Checking', 1_000_000), acc(START, 'Cash', 10_000)]),
      cap(END, [acc(END, 'Checking', 1_000_000), acc(END, 'Cash', 19_000)]),
      { flows: [flow('Checking'), flow('Cash')] },
    ))
    expect(m.rows.unexplained).toBe(9_000)
    expect(m.candidates).toEqual([{ name: 'Cash', member: 'Ira', reason: 'no_record', change: 9_000 }])
  })

  it('gives no fx for an account opened during the month', () => {
    const m = change(input(
      cap(START, [acc(START, 'Checking', 1_000_000)]),
      cap(END, [acc(END, 'Checking', 918_000), acc(END, 'New USD account', 1_000, { currency: 'USD' })]),
      { flows: [flow('Checking'), flow('New USD account', { currency: 'USD' })] },
    ))
    expect(m.items.fx ?? []).toEqual([])
    expect(m.rows).toMatchObject({ fx: 0, unexplained: 0 })
  })

  it('does not count a closed account twice', () => {
    const m = change(input(
      cap(START, [acc(START, 'Checking', 1_000_000), acc(START, 'Savings', 200_000)]),
      cap(END, [acc(END, 'Checking', 1_200_000)]),
      { flows: [flow('Checking')] },
    ))
    expect(m.rows.unexplained).toBe(0)
    expect(total(m)).toBe(round2(m.end - m.start))
  })

  it('revalues a property only between two valuations, at the end rate', () => {
    const m = change(input(
      cap(START, [acc(START, 'Checking', 100)], [home('Flat', 6_000_000)]),
      cap(END, [acc(END, 'Checking', 100)], [home('Flat', 6_500_000)]),
      { flows: [flow('Checking')] },
    ))
    expect(m.rows).toMatchObject({ property: 500_000, unexplained: 0 })
  })

  it('uses the balances form without flows', () => {
    const b = change({ ...march, flows: null })
    expect(b.form).toBe('balances')
    expect(b.rows).toMatchObject({ accounts: 85_000, debtPaid: 22_000, fx: -290_000, property: 0 })
    expect(b.rows.saved).toBeUndefined()
    expect(b.rows.unexplained).toBeUndefined()
    expect(total(b)).toBe(round2(b.end - b.start))
  })

  it('returns a gap, never zeros, without a rate', () => {
    const end = cap(END, [acc(END, 'Checking', 1_085_000), { ...acc(END, 'USD deposit', 29_000, { currency: 'USD' }), valueBase: null }])
    expect(monthChange({ ...march, end, endComplete: false })).toEqual({ month: MONTH, reason: 'no_rate' })
  })

  it('returns a gap for a missing balance', () => {
    expect(monthChange({ ...march, endComplete: false })).toEqual({ month: MONTH, reason: 'no_balance' })
  })

  it('names the previous month when its balance is the one missing', () => {
    expect(monthChange({ ...march, startComplete: false })).toEqual({ month: MONTH, reason: 'no_balance', at: '2026-02' })
  })

  it('returns a gap for the first month of history', () => {
    expect(monthChange({ ...march, start: null })).toEqual({ month: MONTH, reason: 'no_previous' })
  })
})
