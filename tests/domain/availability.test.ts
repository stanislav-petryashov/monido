import { describe, expect, it } from 'vitest'
import { aggregateAvailability, validAssessment, type AvailabilityAssessment } from '../../src/domain/availability'
import type { AccountValue } from '../../src/domain/types'
const account: AccountValue = { name: 'Cash', member: '', class: 'bank', currency: 'USD', value: 100, valueBase: 200 }
const assessment: AvailabilityAssessment = { month: '2024-03', name: 'Cash', member: '', currency: 'USD', balance: 100, available: true, reserve: 20, goals: 30, commitments: 10 }
describe('availability', () => {
  it('blocks confirmed totals when an expected account balance is missing', () => {
    expect(aggregateAvailability('2024-03', [account], [assessment], false)).toMatchObject({ available: null, reserve: null, free: null, incomplete: true })
  })
  it('does not claim zero known funds without account evidence', () => {
    expect(aggregateAvailability('2024-03', [], []).free).toBeNull()
    expect(aggregateAvailability(null, [account], [assessment]).free).toBeNull()
  })
  it('partitions each account once and converts at the snapshot valuation', () => {
    expect(aggregateAvailability('2024-03', [account], [assessment])).toMatchObject({ available: 200, reserve: 40, goals: 60, commitments: 20, free: 80, unknown: 0 })
  })
  it('excludes negative balances from spending capacity', () => {
    expect(aggregateAvailability('2024-03', [{ ...account, value: -10 }], [])).toMatchObject({ available: 0, free: 0, unknown: 0 })
  })
  it.each([{ balance: 99 }, { currency: 'EUR' }, { month: '2024-02' }])('blocks stale signatures %o', change => {
    expect(aggregateAvailability('2024-03', [account], [{ ...assessment, ...change }])).toMatchObject({ free: null, stale: 1 })
  })
  it('blocks unknown and missing FX rather than treating them as zero', () => {
    expect(aggregateAvailability('2024-03', [account], [])).toMatchObject({ free: null, unknown: 1 })
    expect(aggregateAvailability('2024-03', [{ ...account, valueBase: null }], [assessment]).free).toBeNull()
  })
  it('validates mutually exclusive nonnegative earmarks', () => {
    expect(validAssessment(assessment)).toBe(true)
    for (const change of [{ reserve: 101 }, { goals: -1 }, { commitments: NaN }, { available: false }, { balance: -1 }]) expect(validAssessment({ ...assessment, ...change })).toBe(false)
    expect(validAssessment({ ...assessment, available: false, reserve: 0, goals: 0, commitments: 0 })).toBe(true)
  })
})

import { reserveSpendingBaseline } from '../../src/domain/availability'
import type { FinanceSnapshot, CashflowRowBase } from '../../src/domain/types'
const spendingRow = (month: string, expenseBase: number | null): CashflowRowBase => ({ month, bank: 'Cash', member: '', currency: 'USD', active: 0, passive: 0, expense: expenseBase ?? 1, activeBase: 0, passiveBase: 0, expenseBase })
const baselineSnapshot = (rows: CashflowRowBase[]) => ({
  asOf: { capitalDate: '2024-03-31', closedMonth: '2024-03' }, trackFlows: true, income: { months: [] }, warnings: [],
  cashflow: { rows, closedMonth: { month: '2024-03' } },
}) as unknown as FinanceSnapshot
describe('reserve spending baseline', () => {
  it('uses exactly three consecutive complete closed months including debt expenses once', () => {
    expect(reserveSpendingBaseline(baselineSnapshot([spendingRow('2024-01', 10), spendingRow('2024-02', 20), spendingRow('2024-03', 30)]))).toEqual({ perMonth: 20, months: ['2024-01', '2024-02', '2024-03'] })
  })
  it('blocks gaps, insufficient history, unknown FX, incomplete cashflow and zero spending', () => {
    const complete = [spendingRow('2024-01', 10), spendingRow('2024-02', 20), spendingRow('2024-03', 30)]
    for (const rows of [complete.slice(1), [complete[0], complete[2]], [complete[0], complete[1], spendingRow('2024-03', null)], complete.map(r => ({ ...r, expenseBase: 0 }))]) expect(reserveSpendingBaseline(baselineSnapshot(rows))).toBeNull()
    const later = baselineSnapshot(complete)
    later.asOf.capitalDate = '2024-04-30'
    expect(reserveSpendingBaseline(later)).toBeNull()
  })
})

it('reserve coverage rejects incomplete or missing historical month completeness metadata', () => {
  const rows = [spendingRow('2024-01', 10), spendingRow('2024-02', 20), spendingRow('2024-03', 30)]
  const snapshot = baselineSnapshot(rows)
  snapshot.analysisMonths = [{ month: '2024-01', capital: true, cashflow: true }, { month: '2024-02', capital: true, cashflow: false }, { month: '2024-03', capital: true, cashflow: true }]
  expect(reserveSpendingBaseline(snapshot)).toBeNull()
  snapshot.analysisMonths.splice(1, 1)
  expect(reserveSpendingBaseline(snapshot)).toBeNull()
  snapshot.analysisMonths.push({ month: '2024-02', capital: true, cashflow: true })
  expect(reserveSpendingBaseline(snapshot)?.perMonth).toBe(20)
})

it('rounds converted earmarks to currency precision', () => {
  const account = { name: 'A', member: '', class: 'bank' as const, currency: 'EUR', value: 100, valueBase: 33.33 }
  const assessment = { month: '2031-06', name: 'A', member: '', currency: 'EUR', balance: 100, available: true, reserve: 25, goals: 0, commitments: 0 }
  expect(aggregateAvailability('2031-06', [account], [assessment]).reserve).toBe(8.33)
})

import { accountParts, availabilityParts, cardOrder, confirmationProgress } from '../../src/domain/availability'
describe('what the page draws', () => {
  const usd: AccountValue = { name: 'Checking', member: 'A', class: 'bank', currency: 'USD', value: 1000, valueBase: 1000 }
  const eur: AccountValue = { name: 'Euro', member: 'B', class: 'bank', currency: 'EUR', value: 100, valueBase: 110 }
  const pension: AccountValue = { name: '401k', member: 'A', class: 'other', currency: 'USD', value: 5000, valueBase: 5000 }
  const debt: AccountValue = { name: 'Overdraft', member: 'A', class: 'bank', currency: 'USD', value: -50, valueBase: -50 }
  const of = (a: AccountValue, over: Partial<AvailabilityAssessment> = {}): AvailabilityAssessment => ({ month: '2024-03', name: a.name, member: a.member, currency: a.currency, balance: a.value, available: true, reserve: 0, goals: 0, commitments: 0, ...over })
  const assessments = [of(usd, { reserve: 300, commitments: 200 }), of(eur, { goals: 50 }), of(pension, { available: false })]
  const accounts = [usd, eur, pension, debt]

  it('splits the money on the accounts into five parts that sum to the total, free as the aggregate says', () => {
    const aggregate = aggregateAvailability('2024-03', accounts, assessments)
    const drawn = availabilityParts(aggregate)!
    expect(drawn.total).toBe(6110)
    expect(drawn.parts.map(p => p.key)).toEqual(['unavailable', 'reserve', 'goals', 'commitments', 'free'])
    expect(drawn.parts.map(p => p.amount)).toEqual([5000, 300, 55, 200, 555])
    expect(drawn.parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(drawn.total, 8)
    expect(drawn.parts.at(-1)!.amount).toBe(aggregate.free)
    expect(drawn.parts.reduce((s, p) => s + p.share, 0)).toBeCloseTo(100, 8)
    expect(drawn).toMatchObject({ available: 1110, availableShare: 1110 / 6110 * 100 })
  })
  it('names the accounts holding each part; an unavailable one lands in unavailable; a negative one nowhere', () => {
    const parts = availabilityParts(aggregateAvailability('2024-03', accounts, assessments))!.parts
    const names = Object.fromEntries(parts.map(p => [p.key, p.accounts.map(a => a.name)]))
    expect(names).toEqual({ unavailable: ['401k'], reserve: ['Checking'], goals: ['Euro'], commitments: ['Checking'], free: ['Checking', 'Euro'] })
  })
  it('is null while the totals are blocked', () => {
    expect(availabilityParts(aggregateAvailability('2024-03', accounts, assessments.slice(1)))).toBeNull()
    expect(availabilityParts(aggregateAvailability('2024-03', [{ ...usd, valueBase: null }], [of(usd)]))).toBeNull()
  })
  it('gives an account its own-currency parts, none when unavailable or unassessed', () => {
    expect(accountParts(usd, assessments[0])).toEqual({ reserve: 300, goals: 0, commitments: 200, setAside: 500, free: 500 })
    expect(accountParts(pension, assessments[2])).toBeNull()
    expect(accountParts(usd, undefined)).toBeNull()
  })
  it('counts the month\'s confirmations without the negative accounts; a confirmed account without a rate is confirmed', () => {
    const progress = confirmationProgress(aggregateAvailability('2024-03', [usd, { ...eur, valueBase: null }, pension, debt], [assessments[0], assessments[1]]))
    expect(progress).toMatchObject({ total: 3, confirmed: 2, waiting: [pension] })
    expect(progress.accounts.map(a => a.confirmed)).toEqual([true, true, false])
  })
  it('orders the card: available at once, then not available, then the rest, keeping the order inside each', () => {
    const extra: AccountValue = { ...usd, name: 'New' }
    const ordered = cardOrder(aggregateAvailability('2024-03', [pension, extra, debt, usd, eur], assessments)).accounts.map(r => r.account.name)
    expect(ordered).toEqual(['Checking', 'Euro', '401k', 'New', 'Overdraft'])
  })
})
