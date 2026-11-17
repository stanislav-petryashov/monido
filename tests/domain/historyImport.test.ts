import { describe, expect, it } from 'vitest'
import { planHistoryImport, type HistoryContext, type HistoryInput } from '../../src/domain/historyImport'

const TODAY = new Date('2031-05-15T12:00:00Z')
const ctxOf = (over: Partial<HistoryContext> = {}): HistoryContext =>
  ({ closedMonths: [], accounts: [], currencies: ['USD', 'EUR'], members: ['Robin', 'Noa'], today: TODAY, ...over })
const bank = { name: 'Lumiora Bank', member: 'Robin', class: 'bank' as const, currency: 'USD' }
const broker = { name: 'Brisaluna Broker', member: '', class: 'broker' as const, currency: 'EUR' }
const sheet = (rows: [string, ...(number | null)[]][], accounts = [bank, broker]): HistoryInput =>
  ({ accounts, months: rows.map(([month, ...values]) => ({ month, values })) })
const codes = (input: HistoryInput, ctx = ctxOf()) => planHistoryImport(input, ctx).problems.map(p => p.code)

describe('planHistoryImport', () => {
  it('writes month-end balances of every month, oldest first, from rows in any order', () => {
    const plan = planHistoryImport(sheet([['2031-02', 200, 20], ['2031-01', 100, 10]]), ctxOf())
    expect(plan.problems).toEqual([])
    expect(plan.months).toEqual(['2031-01', '2031-02'])
    expect(plan.newAccounts).toBe(2)
    expect(plan.balances).toEqual([
      { date: '2031-01-31', class: 'bank', name: 'Lumiora Bank', value: 100, currency: 'USD', member: 'Robin' },
      { date: '2031-02-28', class: 'bank', name: 'Lumiora Bank', value: 200, currency: 'USD', member: 'Robin' },
      { date: '2031-01-31', class: 'broker', name: 'Brisaluna Broker', value: 10, currency: 'EUR', member: null },
      { date: '2031-02-28', class: 'broker', name: 'Brisaluna Broker', value: 20, currency: 'EUR', member: null },
    ])
    // nothing closed after it: open accounts stay open, the wizard asks for them next
    expect(plan.closures).toEqual([])
  })

  it('an account blank before its first balance opens later; blank after its last one ends there', () => {
    const plan = planHistoryImport(sheet([['2031-01', 100, null], ['2031-02', 200, 20], ['2031-03', null, 30]]), ctxOf())
    expect(plan.problems).toEqual([])
    expect(plan.balances.filter(b => b.name === 'Brisaluna Broker').map(b => b.date)).toEqual(['2031-02-28', '2031-03-31'])
    expect(plan.closures).toEqual([{ name: 'Lumiora Bank', member: 'Robin', closedMonth: '2031-02' }])
  })

  it('a blank between two balances would leave the month partial', () => {
    expect(planHistoryImport(sheet([['2031-01', 100, 1], ['2031-02', null, 2], ['2031-03', 300, 3]]), ctxOf()).problems)
      .toEqual([{ code: 'blank_inside', params: { name: 'Lumiora Bank', month: '2031-02' } }])
  })

  it('before a closed history: ends right before its first month; new accounts close, recorded ones must reach the end', () => {
    const ctx = ctxOf({ closedMonths: ['2031-03', '2031-04'], accounts: [{ ...bank }] })
    const plan = planHistoryImport(sheet([['2031-01', 100, 10], ['2031-02', 200, 20]]), ctx)
    expect(plan.problems).toEqual([])
    expect(plan.newAccounts).toBe(1)
    // the broker is not in the history after the import: closed at its last balance, or March would be partial
    expect(plan.closures).toEqual([{ name: 'Brisaluna Broker', member: '', closedMonth: '2031-02' }])
    // the bank continues into March: a blank at the end would leave February partial
    expect(planHistoryImport(sheet([['2031-01', 100, 10], ['2031-02', null, 20]]), ctx).problems)
      .toEqual([{ code: 'blank_inside', params: { name: 'Lumiora Bank', month: '2031-02' } }])
  })

  it('refuses months it cannot close in order: closed, not adjacent, missing, future, duplicated, malformed', () => {
    const closed = ctxOf({ closedMonths: ['2031-03'] })
    expect(codes(sheet([['2031-02', 1, 1], ['2031-03', 1, 1]]), closed)).toEqual(['not_before_closed'])
    expect(planHistoryImport(sheet([['2031-01', 1, 1]]), closed).problems).toEqual([{ code: 'not_adjacent', params: { month: '2031-02' } }])
    expect(planHistoryImport(sheet([['2031-01', 1, 1], ['2031-04', 1, 1]]), ctxOf()).problems.map(p => p.params?.month)).toEqual(['2031-02', '2031-03'])
    // in May the last finished month is April
    expect(planHistoryImport(sheet([['2031-04', 1, 1], ['2031-05', 1, 1]]), ctxOf()).problems).toEqual([{ code: 'future_month', params: { month: '2031-05' } }])
    expect(codes(sheet([['2031-01', 1, 1], ['2031-01', 2, 2]]))).toEqual(['duplicate_month'])
    expect(codes(sheet([['2031-13', 1, 1]]))).toEqual(['bad_month'])
    expect(codes(sheet([['2031-01', 1]]))).toEqual(['bad_row'])
    expect(codes({ accounts: [bank], months: [] })).toEqual(['no_months'])
  })

  it('refuses accounts it cannot record: no name, a duplicate, an unknown currency or member, a class or currency unlike the recorded one', () => {
    expect(codes(sheet([['2031-01', 1, 1]], [bank, { ...bank, name: ' ' }]))).toEqual(['bad_account'])
    expect(codes(sheet([['2031-01', 1, 1]], [bank, { ...bank }]))).toEqual(['duplicate_account'])
    expect(codes(sheet([['2031-01', 1, 1]], [bank, { ...broker, currency: 'GBP' }]))).toEqual(['unknown_currency'])
    expect(codes(sheet([['2031-01', 1, 1]], [bank, { ...broker, member: 'Ash' }]))).toEqual(['unknown_member'])
    expect(codes(sheet([['2031-01', 1, 1]]), ctxOf({ accounts: [{ ...bank, currency: 'EUR' }] }))).toEqual(['account_mismatch'])
  })

  it('refuses a column without any balance and a value that is not a number; writes nothing then', () => {
    const plan = planHistoryImport(sheet([['2031-01', 1, null], ['2031-02', Number.NaN, null]]), ctxOf())
    expect(plan.problems).toEqual([
      { code: 'bad_value', params: { name: 'Lumiora Bank', month: '2031-02' } },
      { code: 'no_values', params: { name: 'Brisaluna Broker' } },
    ])
    expect(plan).toMatchObject({ months: [], balances: [], closures: [] })
  })
})
