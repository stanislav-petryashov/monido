import { describe, expect, it } from 'vitest'
import {
  accountsFor, balanceCheck, closingWrites, draftFromRows, suggestedAccounts, draftTotals, flowHintsFor, hintsFor, incompleteMonths, loanPaymentsFor, newDraftAccount, openMonths, parseDraft, prevFinishedMonth, problemsIn, typedLoanLines,
  type DraftLoanPayment, type DraftRow,
} from '../../src/domain/monthClose'
import { computeSchedule } from '../../src/domain/loans'
import type { AssetInput, CashflowInput } from '../../src/domain/types'
import { earlyPaymentRow, loanRow } from '../helpers/rows'

const day = (iso: string) => new Date(`${iso}T12:00:00Z`)
const bal = (date: string, name: string, value: number, member: string | null = 'Robin', currency = 'USD', cls = 'bank'): AssetInput =>
  ({ date, class: cls, name, value, currency, member })
const flow = (date: string, bank: string, member = 'Robin'): CashflowInput =>
  ({ date, bank, member, active_income: 1, passive_income: 0, expense: 1, currency: 'USD' })
const row = (o: Partial<DraftRow> = {}): DraftRow => ({
  name: 'Quillmark Bank', member: 'Robin', currency: 'USD', class: 'bank',
  balance: 240, active: 30, passive: 0, expense: 14, closing: false, added: false, ...o,
})

describe('openMonths', () => {
  it('lists finished months after the last closed one, oldest first', () => {
    expect(openMonths(['2030-04', '2030-05'], day('2030-10-05'))).toEqual(['2030-06', '2030-07', '2030-08', '2030-09'])
  })
  it('does not offer the running month, even on its last day', () => {
    expect(openMonths(['2030-08'], day('2030-09-30'))).toEqual([])
    expect(openMonths(['2030-08'], new Date('2030-10-01T00:00:00Z'))).toEqual(['2030-09'])
  })
  it('crosses a year boundary', () => {
    expect(openMonths(['2029-11'], day('2030-02-10'))).toEqual(['2029-12', '2030-01'])
  })
  it('starts an empty history with the month that has just finished', () => {
    expect(openMonths([], day('2030-10-05'))).toEqual(['2030-09'])
    expect(prevFinishedMonth(day('2030-01-15'))).toBe('2029-12')
  })
  it('is empty when everything is closed', () => {
    expect(openMonths(['2030-09'], day('2030-10-05'))).toEqual([])
  })
  it('ignores the order and duplicates of the closed list', () => {
    expect(openMonths(['2030-08', '2030-07', '2030-08'], day('2030-10-05'))).toEqual(['2030-09'])
  })
})

describe('accountsFor', () => {
  const balances = [bal('2030-05-31', 'Quillmark Bank', 240), bal('2030-05-31', 'Pinecrown Wallet', 730), bal('2030-04-30', 'Dormant', 1), bal('2030-05-31', 'Brisaluna Savings', 7, null, 'EUR', 'broker')]

  it('asks for every account that had a balance in the previous month', () => {
    const rows = accountsFor('2030-05', balances, [], [], null)
    expect(rows.map(r => `${r.name}|${r.member}`)).toEqual(['Brisaluna Savings|', 'Pinecrown Wallet|Robin', 'Quillmark Bank|Robin'])
    expect(rows[0]).toMatchObject({ currency: 'EUR', class: 'broker', balance: null, active: null, closing: false, added: false })
  })
  it('drops an account closed in the previous month or earlier', () => {
    const rows = accountsFor('2030-05', balances, [], [{ name: 'Pinecrown Wallet', member: 'Robin', closedMonth: '2030-05' }], null)
    expect(rows.map(r => r.name)).not.toContain('Pinecrown Wallet')
  })
  it('asks again for an account whose name was closed earlier and is in use again', () => {
    // «Pinecrown Wallet» was closed in April; in May a new one opened under the same name
    const rows = accountsFor('2030-05', balances, [], [{ name: 'Pinecrown Wallet', member: 'Robin', closedMonth: '2030-04' }], null)
    expect(rows.map(r => r.name)).toContain('Pinecrown Wallet')
  })

  it('keeps what was typed for an account whose stored name has a stray space', () => {
    const spaced = [bal('2030-05-31', 'Quillmark Bank ', 240)]
    const draft = { rows: [row({ name: 'Quillmark Bank ', balance: 310 })] }
    expect(accountsFor('2030-05', spaced, [], [], draft)[0]).toMatchObject({ name: 'Quillmark Bank ', balance: 310 })
  })

  it('keeps the values and flags typed into the draft, and the accounts added there', () => {
    const draft = { rows: [row({ name: 'Quillmark Bank', balance: 310, closing: true }), row({ name: 'New', added: true, balance: null })] }
    const rows = accountsFor('2030-05', balances, [], [], draft)
    expect(rows.find(r => r.name === 'Quillmark Bank')).toMatchObject({ balance: 310, closing: true, added: false })
    expect(rows.find(r => r.name === 'New')).toMatchObject({ added: true, balance: null })
  })
  it('forgets a draft row for an account that is no longer required and was not added in the draft', () => {
    const draft = { rows: [row({ name: 'Ghost' })] }
    expect(accountsFor('2030-05', balances, [], [], draft).map(r => r.name)).not.toContain('Ghost')
  })
  it('tells apart two members with the same account name', () => {
    const both = [bal('2030-05-31', 'Quillmark Bank', 1, 'Robin'), bal('2030-05-31', 'Quillmark Bank', 2, 'Noa')]
    expect(accountsFor('2030-05', both, [], [], null)).toHaveLength(2)
  })
  it('also asks for an account that had only income and expenses last month, with no balance', () => {
    const flows = [{ ...flow('2030-05-01', 'Lumiora Bank', 'Noa'), currency: 'USD' }, flow('2030-04-01', 'Retired Card')]
    const rows = accountsFor('2030-05', balances, flows, [], null)
    expect(rows.find(r => r.name === 'Lumiora Bank')).toMatchObject({ member: 'Noa', currency: 'USD', class: 'bank', added: false })
    expect(rows.map(r => r.name)).not.toContain('Retired Card')
    // an account with both a balance and flows is asked for once
    expect(accountsFor('2030-05', balances, [flow('2030-05-01', 'Quillmark Bank')], [], null).filter(r => r.name === 'Quillmark Bank')).toHaveLength(1)
  })

  it('with no history has only the accounts added in the draft', () => {
    expect(accountsFor(null, [], [], [], { rows: [row({ added: true })] })).toHaveLength(1)
    expect(accountsFor(null, [], [], [], null)).toEqual([])
  })
})

describe('suggestedAccounts', () => {
  it('offers accounts seen in the last year that the month does not ask for, newest details first', () => {
    const assets = [bal('2030-03-31', 'Holiday Jar', 5, 'Shared', 'EUR'), bal('2030-05-31', 'Quillmark Bank', 1), bal('2028-01-31', 'Ancient', 1)]
    const flows = [flow('2030-04-01', 'Debit Card', 'Noa')]
    const current = [row({ name: 'Quillmark Bank' })]
    expect(suggestedAccounts('2030-05', assets, flows, [], current)).toEqual([
      { name: 'Debit Card', member: 'Noa', currency: 'USD', class: 'bank' },
      { name: 'Holiday Jar', member: 'Shared', currency: 'EUR', class: 'bank' },
    ])
  })
  it('does not offer an account that was closed, or anything on an empty history', () => {
    const assets = [bal('2030-03-31', 'Pinecrown Wallet', 5)]
    expect(suggestedAccounts('2030-05', assets, [], [{ name: 'Pinecrown Wallet', member: 'Robin', closedMonth: '2030-03' }], [])).toEqual([])
    expect(suggestedAccounts(null, [], [], [], [])).toEqual([])
  })
})

describe('draftFromRows', () => {
  it('turns rows already stored for a month into a draft, flow-only accounts included', () => {
    const assets = [bal('2030-06-30', 'Quillmark Bank', 310), bal('2030-05-31', 'Quillmark Bank', 240)]
    const flows = [{ ...flow('2030-06-01', 'Quillmark Bank'), active_income: 30, expense: 14 }, flow('2030-06-01', 'Debit Card', 'Noa')]
    const draft = draftFromRows('2030-06', assets, flows, new Set(['["Quillmark Bank","Robin"]']), new Set())
    expect(draft.rows).toEqual([
      expect.objectContaining({ name: 'Quillmark Bank', balance: 310, active: 30, passive: 0, expense: 14, added: false }),
      expect.objectContaining({ name: 'Debit Card', member: 'Noa', balance: null, active: 1, added: true }),
    ])
  })
})

describe('hintsFor', () => {
  it('gives last month’s balance per account', () => {
    expect(hintsFor('2030-05', [bal('2030-05-31', 'Quillmark Bank', 240), bal('2030-04-30', 'Quillmark Bank', 210)])).toEqual({ '["Quillmark Bank","Robin"]': 240 })
    expect(hintsFor(null, [])).toEqual({})
  })
})

describe('flowHintsFor', () => {
  const cf = (date: string, active: number, passive: number, expense: number, bank = 'Quillmark Bank'): CashflowInput =>
    ({ date, bank, member: 'Robin', active_income: active, passive_income: passive, expense, currency: 'USD' })
  const KEY = '["Quillmark Bank","Robin"]'
  const months = ['2030-03', '2030-04', '2030-05']

  it('gives last month’s figure of each flow, steady when it repeats in one of the two closed months before', () => {
    const flows = [cf('2030-05-01', 5000, 0, 3100), cf('2030-04-01', 5000, 0, 2900), cf('2030-03-01', 4800, 12, 3100)]
    expect(flowHintsFor(months, flows, () => false)).toEqual({ [KEY]: {
      active: { last: 5000, steady: true }, passive: { last: 0, steady: true }, expense: { last: 3100, steady: true },
    } })
  })

  it('a figure seen once is a hint, not steady; an account without last month’s row gets nothing', () => {
    const flows = [cf('2030-05-01', 5200, 0, 3000), cf('2030-04-01', 5000, 7, 2900), cf('2030-04-01', 10, 0, 1, 'Orb Card')]
    const hints = flowHintsFor(months, flows, () => false)
    expect(hints[KEY]).toEqual({ active: { last: 5200, steady: false }, passive: { last: 0, steady: false }, expense: { last: 3000, steady: false } })
    expect(hints['["Orb Card","Robin"]']).toBeUndefined()
  })

  it('only the last three closed months count, and with no closed month there is nothing', () => {
    const flows = [cf('2030-05-01', 5000, 0, 1), cf('2030-01-01', 5000, 0, 1)]
    expect(flowHintsFor(['2030-01', ...months], flows, () => false)[KEY].active).toEqual({ last: 5000, steady: false })
    expect(flowHintsFor([], flows, () => false)).toEqual({})
  })

  it('an expense is not steady against a month whose expenses still held the loan payments', () => {
    const flows = [cf('2030-05-01', 5000, 0, 3100), cf('2030-04-01', 5000, 0, 3100)]
    const legacy = (month: string) => month === '2030-04'
    expect(flowHintsFor(months, flows, legacy)[KEY]).toEqual({
      active: { last: 5000, steady: true }, passive: { last: 0, steady: true }, expense: { last: 3100, steady: false },
    })
  })
})

describe('problemsIn', () => {
  it('accepts zeros and a negative balance', () => {
    expect(problemsIn([row({ balance: -80, active: 0, passive: 0, expense: 0 })])).toEqual([])
  })
  it('names each empty field', () => {
    const [p] = problemsIn([row({ balance: null, expense: null })])
    expect(p).toEqual({ key: '["Quillmark Bank","Robin"]', name: 'Quillmark Bank', member: 'Robin', problem: { code: 'missing', fields: ['balance', 'expense'] } })
  })
  it('rejects negative flows and non-finite numbers', () => {
    expect(problemsIn([row({ active: -1 })])[0].problem).toEqual({ code: 'negative', fields: ['active'] })
    expect(problemsIn([row({ balance: Number.NaN })])[0].problem).toEqual({ code: 'missing', fields: ['balance'] })
  })
  it('rejects the same account twice and an account without a name or currency', () => {
    expect(problemsIn([row(), row()]).map(p => p.problem)).toContainEqual({ code: 'duplicate' })
    expect(problemsIn([row({ name: '  ' })])[0].problem).toEqual({ code: 'no_name' })
    expect(problemsIn([row({ currency: '' })])[0].problem).toEqual({ code: 'no_currency' })
  })
  it('says an empty month cannot be closed', () => {
    expect(problemsIn([])).toEqual([{ key: '', name: '', member: '', problem: { code: 'no_accounts' } }])
  })
  it('names an account whose lines by category exceed a total, after the other problems; not without cash flow', () => {
    const excess = [{ name: 'Quillmark Bank', member: 'Robin', flow: 'expense' as const, lines: 900, total: 800 }]
    expect(problemsIn([row()], true, [], excess)).toEqual([
      { key: '["Quillmark Bank","Robin"]', name: 'Quillmark Bank', member: 'Robin', problem: { code: 'over_allocated', flow: 'expense', lines: 900, total: 800 } },
    ])
    expect(problemsIn([row()], false, [], excess)).toEqual([])
  })
})

describe('closingWrites', () => {
  it('dates the balance on the last day and the flows on the first', () => {
    const w = closingWrites('2032-02', [row({ member: '' })])
    expect(w.assets).toEqual([{ date: '2032-02-29', class: 'bank', name: 'Quillmark Bank', value: 240, currency: 'USD', member: null }])
    expect(w.cashflow).toEqual([{ date: '2032-02-01', bank: 'Quillmark Bank', member: '', active_income: 30, passive_income: 0, expense: 14, currency: 'USD' }])
  })
  it('writes zeros explicitly and records a closing account', () => {
    const w = closingWrites('2030-06', [row({ balance: 0, active: 0, passive: 0, expense: 0, closing: true })])
    expect(w.assets[0].value).toBe(0)
    expect(w.cashflow[0]).toMatchObject({ active_income: 0, expense: 0 })
    expect(w.closures).toEqual([{ name: 'Quillmark Bank', member: 'Robin', closedMonth: '2030-06' }])
  })
  it('writes the account name exactly as it is stored, so the next month finds the same account', () => {
    expect(closingWrites('2030-06', [row({ name: 'Quillmark Bank ' })]).assets[0].name).toBe('Quillmark Bank ')
  })
})

describe('draftTotals', () => {
  it('sums by currency and compares balances with last month, counting only filled rows', () => {
    const rows = [row({ balance: 310, active: 30, passive: 4, expense: 14 }), row({ name: 'Pinecrown Wallet', balance: null, active: null }), row({ name: 'Euro', currency: 'EUR', balance: 9, active: 0, passive: 0, expense: 0 })]
    expect(draftTotals(rows, { '["Quillmark Bank","Robin"]': 240, '["Pinecrown Wallet","Robin"]': 730 })).toEqual([
      { currency: 'EUR', income: 0, expense: 0, balanceChange: 9 },
      { currency: 'USD', income: 34, expense: 14, balanceChange: 70 },
    ])
  })
})

describe('incompleteMonths', () => {
  it('counts accounts of the previous month that have no balance or no flows, only in migrated months', () => {
    const assets = [bal('2030-04-30', 'Quillmark Bank', 1), bal('2030-04-30', 'Pinecrown Wallet', 1), bal('2030-05-31', 'Quillmark Bank', 1)]
    const cashflow = [flow('2030-04-01', 'Quillmark Bank'), flow('2030-04-01', 'Pinecrown Wallet'), flow('2030-05-01', 'Quillmark Bank')]
    const months = [{ month: '2030-04', source: 'migration' as const }, { month: '2030-05', source: 'migration' as const }]
    expect(incompleteMonths(months, assets, cashflow)).toEqual([{ month: '2030-05', missing: 1 }])
    expect(incompleteMonths(months.map(m => ({ ...m, source: 'wizard' as const })), assets, cashflow)).toEqual([])
  })
})

describe('parseDraft', () => {
  it('accepts numbers and nulls and normalises the rest', () => {
    const d = parseDraft({ rows: [{ name: 'Quillmark Bank', member: 'Robin', currency: 'USD', class: 'bank', balance: 1, active: null, passive: null, expense: null, closing: false, added: true }] })
    expect(d.rows[0]).toMatchObject({ balance: 1, active: null, added: true })
  })
  it.each([
    [null], [{}], [{ rows: 'x' }], [{ rows: [{ name: 1 }] }],
    [{ rows: [{ name: 'A', member: '', currency: 'USD', class: 'nope', balance: null, active: null, passive: null, expense: null, closing: false, added: false }] }],
    [{ rows: [{ name: 'A', member: '', currency: 'USD', class: 'bank', balance: '5', active: null, passive: null, expense: null, closing: false, added: false }] }],
  ])('rejects a malformed draft %#', body => {
    expect(() => parseDraft(body)).toThrow()
  })
  it('refuses an unreasonable number of rows', () => {
    const one = { name: 'A', member: '', currency: 'USD', class: 'bank', balance: null, active: null, passive: null, expense: null, closing: false, added: false }
    expect(() => parseDraft({ rows: Array.from({ length: 201 }, (_, i) => ({ ...one, name: `A${i}` })) })).toThrow()
  })
})

describe('without cash flow', () => {
  const r = row({ balance: 260, active: null, passive: null, expense: null })
  it('only the balance is required', () => {
    expect(problemsIn([r], false)).toEqual([])
    expect(problemsIn([r])[0].problem.code).toBe('missing')
  })
  it('does not reject a negative flow that is hidden', () => {
    expect(problemsIn([{ ...r, expense: -1 }], false)).toEqual([])
    expect(problemsIn([{ ...r, active: 0, passive: 0, expense: -1 }])[0].problem).toEqual({ code: 'negative', fields: ['expense'] })
  })
  it('closing writes balances only', () => {
    expect(closingWrites('2030-05', [r], false).cashflow).toEqual([])
    expect(closingWrites('2030-05', [r], false).assets).toHaveLength(1)
    expect(closingWrites('2030-05', [r]).cashflow).toHaveLength(1)
  })
  it('totals carry no income or expense', () => {
    expect(draftTotals([{ ...r, active: 9, passive: 0, expense: 6 }], {}, false)[0]).toMatchObject({ income: 0, expense: 0, balanceChange: 260 })
  })
  it('history is complete with balances alone', () => {
    const months = [{ month: '2030-01', source: 'migration' as const }, { month: '2030-02', source: 'migration' as const }]
    const assets = ['2030-01-31', '2030-02-28'].map(date => ({ date, class: 'bank', name: 'Quillmark Bank', value: 1, currency: 'USD', member: 'Robin' }))
    expect(incompleteMonths(months, assets, [], false)).toEqual([])
    expect(incompleteMonths(months, assets, [])).toEqual([{ month: '2030-02', missing: 1 }])
  })
})

describe('balanceCheck', () => {
  it('gives the difference from last month and no warning for an ordinary change', () => {
    expect(balanceCheck(424700, 412300)).toEqual({ diff: 12400, warning: null, times: null })
  })

  it('rounds the difference like every amount: a half cent away from zero, never -0', () => {
    expect(balanceCheck(100, 100.125).diff).toBe(-0.13)
    expect(balanceCheck(100.125, 100).diff).toBe(0.13)
    expect(Object.is(balanceCheck(100, 100.001).diff, 0)).toBe(true)
  })

  it('warns about a balance five or more times larger or smaller: a zero too many or too few', () => {
    expect(balanceCheck(4247000, 412300)).toEqual({ diff: 3834700, warning: 'magnitude', times: 10 })
    expect(balanceCheck(41230, 412300)).toMatchObject({ warning: 'magnitude', times: 10 })
    expect(balanceCheck(-5000, -1000)).toMatchObject({ warning: 'magnitude', times: 5 })
    expect(balanceCheck(4000, 1000)).toMatchObject({ warning: null, times: null })
  })

  it('warns about a changed sign', () => {
    expect(balanceCheck(-500, 412300)).toEqual({ diff: -412800, warning: 'sign', times: null })
    expect(balanceCheck(500, -412300)).toMatchObject({ warning: 'sign' })
  })

  it('zero is a value, not a warning: the account was emptied; nothing to compare with a zero last month', () => {
    expect(balanceCheck(0, 412300)).toEqual({ diff: -412300, warning: null, times: null })
    expect(balanceCheck(500, 0)).toEqual({ diff: 500, warning: null, times: null })
  })
})

describe('loan payments', () => {
  const line = (o: Partial<DraftLoanPayment> = {}): DraftLoanPayment => ({ name: 'Test loan', currency: 'RUB', scheduled: 8000, amount: 8000, ...o })
  const march = computeSchedule(loanRow(), [])[0].scheduledPayment

  it('loanPaymentsFor prefills each active loan with the month’s scheduled payment, sorted by name', () => {
    const loans = [loanRow({ name: 'Zeta' }), loanRow({ name: 'Alpha', currency: 'USD' })]
    const lines = loanPaymentsFor('2031-03', loans, [], null)
    expect(lines.map(l => l.name)).toEqual(['Alpha', 'Zeta'])
    expect(lines[0]).toEqual({ name: 'Alpha', currency: 'USD', scheduled: Math.round(march * 100) / 100, amount: Math.round(march * 100) / 100 })
  })

  it('a loan whose schedule has no payment in the month gets no line', () => {
    // finished (the term ends in 2032-02), and issued after the month
    expect(loanPaymentsFor('2032-03', [loanRow()], [], null)).toEqual([])
    expect(loanPaymentsFor('2031-02', [loanRow()], [], null)).toEqual([])
    expect(loanPaymentsFor('2031-03', [loanRow({ status: 'closed', closed_date: '2031-03-10' })], [], null)).toHaveLength(1)
    expect(loanPaymentsFor('2031-04', [loanRow({ status: 'closed', closed_date: '2031-03-10' })], [], null)).toEqual([])
    // closed without a close date: the schedule still asks
    expect(loanPaymentsFor('2031-04', [loanRow({ status: 'closed', closed_date: null })], [], null)).toHaveLength(1)
  })

  it('uses the loan’s own early payments', () => {
    const early = [earlyPaymentRow({ loan_name: 'Test loan', payment_date: '2031-03-05', amount: 90000, strategy: 'reduce_term' }), earlyPaymentRow({ loan_name: 'Other', amount: 1 })]
    const lines = loanPaymentsFor('2031-04', [loanRow()], early, null)
    expect(lines).toEqual([])
  })

  it('a typed amount wins over the schedule, and a typed null stays null', () => {
    const typed = { rows: [], loans: [{ name: 'Test loan', amount: 123 }] }
    expect(loanPaymentsFor('2031-03', [loanRow()], [], typed)[0]).toMatchObject({ amount: 123, scheduled: Math.round(march * 100) / 100 })
    expect(loanPaymentsFor('2031-03', [loanRow()], [], { rows: [], loans: [{ name: 'Test loan', amount: null }] })[0].amount).toBeNull()
    // a typed line for a loan with no payment this month stays; an entry for an unknown loan is dropped
    const none = loanPaymentsFor('2032-03', [loanRow()], [], { rows: [], loans: [{ name: 'Test loan', amount: 0 }, { name: 'Gone', amount: 5 }] })
    expect(none).toEqual([{ name: 'Test loan', currency: 'RUB', scheduled: 0, amount: 0 }])
  })

  it('problemsIn reports loan_payment for an empty or negative amount; zero is a value', () => {
    const problems = problemsIn([row()], true, [line({ amount: null }), line({ name: 'B', amount: -1 }), line({ name: 'C', amount: 0 })])
    expect(problems).toEqual([
      { key: 'loan:Test loan', name: '', member: '', problem: { code: 'loan_payment', name: 'Test loan' } },
      { key: 'loan:B', name: '', member: '', problem: { code: 'loan_payment', name: 'B' } },
    ])
    expect(problemsIn([row()], true, [line({ amount: 0 })])).toEqual([])
  })

  it('closingWrites writes one loan_payments row per line, zero included, dated the 1st; none without flows', () => {
    const lines = [line({ amount: 0 }), line({ name: 'B', currency: 'USD', amount: 55.5 }), line({ name: 'C', amount: null })]
    expect(closingWrites('2030-06', [row()], true, lines).loanPayments).toEqual([
      { date: '2030-06-01', loan_name: 'Test loan', amount: 0, currency: 'RUB' },
      { date: '2030-06-01', loan_name: 'B', amount: 55.5, currency: 'USD' },
      { date: '2030-06-01', loan_name: 'C', amount: 0, currency: 'RUB' },
    ])
    expect(closingWrites('2030-06', [row()], false, lines).loanPayments).toEqual([])
    expect(closingWrites('2030-06', [row()]).loanPayments).toEqual([])
  })

  it('draftTotals adds the loan amounts to the expense of their currency', () => {
    const totals = draftTotals([row({ balance: 240 })], { '["Quillmark Bank","Robin"]': 240 }, true, [line({ currency: 'USD', amount: 100 }), line({ name: 'B', currency: 'EUR', amount: 7 }), line({ name: 'C', currency: 'USD', amount: null })])
    expect(totals).toEqual([
      { currency: 'EUR', income: 0, expense: 7, balanceChange: 0 },
      { currency: 'USD', income: 30, expense: 114, balanceChange: 0 },
    ])
    expect(draftTotals([row()], {}, false, [line({ amount: 100 })])[0].expense).toBe(0)
  })

  it('draftFromRows puts the stored loan payments of the month into the draft', () => {
    const payments = [
      { date: '2030-06-01', loan_name: 'B', amount: 55.5, currency: 'USD' }, { date: '2030-06-01', loan_name: 'A', amount: 0, currency: 'RUB' },
      { date: '2030-05-01', loan_name: 'A', amount: 9, currency: 'RUB' },
    ]
    expect(draftFromRows('2030-06', [], [], new Set(), new Set(), payments).loans).toEqual([{ name: 'B', amount: 55.5 }, { name: 'A', amount: 0 }])
    expect(draftFromRows('2030-06', [], [], new Set(), new Set()).loans).toBeUndefined()
  })

  it('parseDraft accepts loans and rejects a non-numeric amount naming the line', () => {
    expect(parseDraft({ rows: [], loans: [{ name: 'A', amount: 5, extra: 1 }, { name: 'B', amount: null }] }).loans).toEqual([{ name: 'A', amount: 5 }, { name: 'B', amount: null }])
    expect(parseDraft({ rows: [] }).loans).toBeUndefined()
    expect(() => parseDraft({ rows: [], loans: [{ name: 'A', amount: 1 }, { name: 'B', amount: '5' }] })).toThrow('Invalid amount in loan 2')
    expect(() => parseDraft({ rows: [], loans: [{ name: 1, amount: 1 }] })).toThrow('Invalid name in loan 1')
    expect(() => parseDraft({ rows: [], loans: 'x' })).toThrow()
    expect(() => parseDraft({ rows: [], loans: Array.from({ length: 51 }, (_, i) => ({ name: `L${i}`, amount: 1 })) })).toThrow('Too many loans')
  })
})

describe('newDraftAccount', () => {
  const values = { name: ' Card ', member: 'Robin', currency: 'USD', class: 'bank' as const }
  const existing = newDraftAccount({ ...values, name: 'Card' }, [])

  it('trims the name and adds the row with empty amounts', () => {
    expect(existing).toEqual({ row: { name: 'Card', member: 'Robin', currency: 'USD', class: 'bank', balance: null, active: null, passive: null, expense: null, closing: false, added: true } })
  })

  it('names the problem: no name, no currency, the same name and member', () => {
    const rows = 'row' in existing ? [existing.row] : []
    expect(newDraftAccount({ ...values, name: '  ' }, [])).toEqual({ problem: 'nameRequired' })
    expect(newDraftAccount({ ...values, currency: '' }, [])).toEqual({ problem: 'currencyRequired' })
    expect(newDraftAccount(values, rows)).toEqual({ problem: 'duplicate' })
    expect('row' in newDraftAccount({ ...values, member: 'Noa' }, rows)).toBe(true)
  })
})

describe('typedLoanLines', () => {
  const lines: DraftLoanPayment[] = [
    { name: 'Car', currency: 'USD', scheduled: 100, amount: 100 },
    { name: 'Home', currency: 'USD', scheduled: 500, amount: 650 },
    { name: 'Study', currency: 'USD', scheduled: 50, amount: null },
  ]

  it('keeps the lines that differ from the schedule', () => {
    expect(typedLoanLines(lines)).toEqual([{ name: 'Home', amount: 650 }, { name: 'Study', amount: null }])
  })

  it('also keeps the edited ones, even back at the schedule', () => {
    expect(typedLoanLines(lines, { Car: 100 })).toEqual([{ name: 'Car', amount: 100 }, { name: 'Home', amount: 650 }, { name: 'Study', amount: null }])
  })
})

describe('account tuple identity', () => {
  it('keeps pipe-colliding identities distinct', () => {
    const assets = [bal('2030-05-31', 'A|B', 10, 'C'), bal('2030-05-31', 'A', 20, 'B|C')]
    const closures = [{ name: 'A|B', member: 'C', closedMonth: '2030-05' }]
    expect(accountsFor('2030-05', assets, [], closures, null).map(r => [r.name, r.member])).toEqual([['A', 'B|C']])
    const draft = draftFromRows('2030-05', assets, [], new Set(), new Set(['["A|B","C"]']))
    expect(draft.rows.map(r => [r.name, r.balance, r.closing])).toEqual([['A|B', 10, true], ['A', 20, false]])
    expect(draftTotals([row({ name: 'A|B', member: 'C', balance: 15 }), row({ name: 'A', member: 'B|C', balance: 27 })], hintsFor('2030-05', assets))[0].balanceChange).toBe(12)
  })
})
