import { describe, expect, it, vi } from 'vitest'
import {
  closedMonth, convertCashflow, convertLoanPayments, groupCashflow, monthTotals, summarize, trend, windowRows,
} from '../../src/domain/cashflow'
import type { CashflowInput, RateLookup } from '../../src/domain/types'

const rows: CashflowInput[] = [
  { date: '2030-03-01', bank: 'Lumiora Bank', member: 'Robin', active_income: 150000, passive_income: 0, expense: 60000, currency: 'RUB' },
  { date: '2030-03-01', bank: 'Brisaluna Bank', member: 'Noa', active_income: 0, passive_income: 140, expense: 650, currency: 'EUR' },
  { date: '2030-04-01', bank: 'Lumiora Bank', member: 'Robin', active_income: 240000, passive_income: 0, expense: 96000, currency: 'RUB' },
]
const rateAt: RateLookup = d => (d.startsWith('2030-03') ? { RUB: 75, EUR: 75 / 90 } : { RUB: 96, EUR: 96 / 120 })
const converted = convertCashflow(rows, rateAt, 'USD')

describe('convertCashflow', () => {
  it('converts each row at the rate of its own month', () => {
    const lookup = vi.fn(rateAt)
    convertCashflow(rows, lookup, 'USD')
    expect(lookup).toHaveBeenCalledWith('2030-03-01')
    expect(lookup).toHaveBeenCalledWith('2030-04-01')
    expect(converted.find(r => r.month === '2030-03' && r.bank === 'Lumiora Bank')).toMatchObject({ activeBase: 2000, expenseBase: 800 })
    expect(converted.find(r => r.bank === 'Brisaluna Bank')).toMatchObject({ passiveBase: 168, expenseBase: 780 })
    expect(converted.find(r => r.month === '2030-04')).toMatchObject({ activeBase: 2500, expenseBase: 1000, active: 240000 })
  })
  it('a month with an unconvertible row has unknown totals, not that row short', () => {
    const gbp = convertCashflow([{ ...rows[0], currency: 'GBP' }], rateAt, 'USD')
    expect(gbp[0]).toMatchObject({ activeBase: null, expenseBase: null })
    expect(monthTotals(gbp, '2030-03')).toBeNull()
  })
})

describe('closedMonth / monthTotals / trend', () => {
  it('uses the latest month that has rows', () => {
    expect(closedMonth(converted)).toBe('2030-04')
    expect(closedMonth([])).toBeNull()
  })
  it('totals one month in USD', () => {
    expect(monthTotals(converted, '2030-03')).toEqual({ month: '2030-03', income: 2168, active: 2000, passive: 168, expense: 1580, net: 588 })
  })
  it('lists months ascending', () => {
    expect(trend(converted).map(t => t.month)).toEqual(['2030-03', '2030-04'])
  })
  it('groups interleaved months without changing totals or the input order; a rateless month has null totals', () => {
    const rows = [converted[2], converted[0], { ...converted[1], passiveBase: null }]
    const before = structuredClone(rows)
    expect(trend(rows)).toEqual([
      { month: '2030-03', income: null, active: null, passive: null, expense: null, net: null },
      monthTotals(rows, '2030-04'),
    ])
    expect(rows).toEqual(before)
    expect(trend([])).toEqual([])
  })
})

describe('windowRows / summarize', () => {
  it('cuts a window ending at the closed month', () => {
    expect(windowRows(converted, '2030-04', '2030-04').map(r => r.month)).toEqual(['2030-04'])
    expect(windowRows(converted, '2030-04', null)).toHaveLength(3)
    expect(windowRows(converted, null, '2029-05')).toEqual([])
  })
  it('averages over months that have data', () => {
    expect(summarize(converted, '2030-04', 3)).toEqual({
      months: 2, incomePerMonth: 2334, expensePerMonth: 1290, passivePerMonth: 84, netPerMonth: 1044, ratePct: 44.73,
    })
    expect(summarize(converted, '2030-04', 1)).toMatchObject({ months: 1, ratePct: 60 })
  })
  it('has no rate without income', () => {
    expect(summarize([], null, 3)).toEqual({ months: 0, incomePerMonth: 0, expensePerMonth: 0, passivePerMonth: 0, netPerMonth: 0, ratePct: null })
    const noIncome = convertCashflow([{ ...rows[0], active_income: 0 }], rateAt, 'USD')
    expect(summarize(noIncome, '2030-03', 3).ratePct).toBeNull()
  })
})

describe('groupCashflow', () => {
  it('groups by member', () => {
    expect(groupCashflow(converted, 'member')).toEqual([
      { member: 'Noa', income: 168, active: 0, passive: 168, expense: 780 },
      { member: 'Robin', income: 4500, active: 4500, passive: 0, expense: 1800 },
    ])
  })
  it('groups by account (bank + member)', () => {
    expect(groupCashflow(converted, 'account').map(g => [g.bank, g.member])).toEqual([['Brisaluna Bank', 'Noa'], ['Lumiora Bank', 'Robin']])
  })
})

describe('convertLoanPayments', () => {
  it('marks rows as loans and converts at the month’s first day', () => {
    const lookup = vi.fn<RateLookup>((d): Record<string, number> => (d === '2031-05-01' ? { EUR: 0.8 } : {}))
    const out = convertLoanPayments(
      [{ date: '2031-05-01', loan_name: 'Car', amount: 400, currency: 'EUR' }],
      [{ name: 'Car', member: 'Noa' }], lookup, 'USD')
    expect(lookup).toHaveBeenCalledWith('2031-05-01')
    expect(out).toEqual([expect.objectContaining({
      month: '2031-05', bank: 'Car', member: 'Noa', loan: true, expense: 400, expenseBase: 500, activeBase: 0, passiveBase: 0,
    })])
  })
  it('a payment of a deleted loan keeps its row with no member', () => {
    const out = convertLoanPayments([{ date: '2031-05-01', loan_name: 'Gone', amount: 10, currency: 'USD' }], [], () => ({}), 'USD')
    expect(out).toEqual([expect.objectContaining({ bank: 'Gone', member: '', loan: true, expenseBase: 10 })])
  })
  it('a currency without a rate gives a null base amount and unknown totals', () => {
    const out = convertLoanPayments([{ date: '2031-05-01', loan_name: 'Car', amount: 400, currency: 'GBP' }], [], () => ({}), 'USD')
    expect(out[0]).toMatchObject({ expenseBase: null })
    expect(monthTotals(out, '2031-05')).toBeNull()
  })
})
