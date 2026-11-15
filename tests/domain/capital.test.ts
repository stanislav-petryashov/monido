import { describe, expect, it, vi } from 'vitest'
import { capitalAt, capitalHistory, type CapitalInputs } from '../../src/domain/capital'
import { computeSchedule, type LoanRow } from '../../src/domain/loans'
import { shiftMonth, monthEnd } from '../../src/domain/dates'
import type { AssetInput, RateLookup, Rates } from '../../src/domain/types'
import { buildFamily, DEMO_FAMILIES } from '../../src/demo/family'
import { earlyPaymentRow, loanRow } from '../helpers/rows'

const RATES: Rates = { RUB: 75, EUR: 75 / 90 }
const rateAt: RateLookup = () => RATES
const empty: CapitalInputs = { assets: [], realEstate: [], loans: [], earlyPayments: [] }

function asset(date: string, name: string, value: number, currency = 'USD', cls = 'bank', member: string | null = 'Robin'): AssetInput {
  return { date, class: cls, name, value, currency, member }
}

const loan = (o: Partial<LoanRow> = {}) => loanRow({ name: 'Loan', ...o })

describe('capitalAt', () => {
  const march = [
    asset('2030-03-31', 'Lumiora Bank', 90000, 'RUB'),
    asset('2030-03-31', 'Brisaluna Bank', 1400, 'EUR', 'bank', 'Noa'),
    asset('2030-03-31', 'Ottergate Brokerage', 6400, 'USD', 'broker', 'Shared'),
  ]

  it('converts accounts at the month-end rate and totals assets, liquid and net worth', () => {
    const lookup = vi.fn(rateAt)
    const c = capitalAt({ ...empty, assets: march }, '2030-03', lookup, 'USD')
    expect(lookup).toHaveBeenCalledWith('2030-03-31')
    expect(c.date).toBe('2030-03-31')
    expect(c.accounts.find(a => a.name === 'Lumiora Bank')?.valueBase).toBe(1200)
    expect(c.assets).toBe(9280)
    expect(c.liquid).toBe(2880)
    expect(c.liabilities).toBe(0)
    expect(c.netWorth).toBe(9280)
    expect(c.byClass).toEqual([{ class: 'broker', valueBase: 6400 }, { class: 'bank', valueBase: 2880 }])
  })

  it('excludes currencies without a rate but keeps the original amount', () => {
    const c = capitalAt({ ...empty, assets: [asset('2030-03-31', 'Tarn Savings', 140, 'GBP')] }, '2030-03', rateAt, 'USD')
    expect(c.accounts[0]).toMatchObject({ value: 140, valueBase: null })
    expect(c.assets).toBe(0)
  })

  it('takes the latest row when an account has several rows in a month', () => {
    const c = capitalAt({ ...empty, assets: [asset('2030-03-12', 'A', 130), asset('2030-03-31', 'A', 260)] }, '2030-03', rateAt, 'USD')
    expect(c.accounts).toHaveLength(1)
    expect(c.accounts[0].value).toBe(260)
  })

  it('normalizes legacy account classes', () => {
    const c = capitalAt({ ...empty, assets: [asset('2030-03-31', 'Ottergate Brokerage', 180, 'USD', 'investments')] }, '2030-03', rateAt, 'USD')
    expect(c.accounts[0].class).toBe('broker')
  })

  it('values property by the latest valuation up to that year, else by purchase price after purchase', () => {
    const realEstate = [{
      name: 'City apartment', purchase_date: '2028-09-01', purchase_price: 184000, purchase_currency: 'USD',
      valuation_year: 2030, value: 197000, currency: 'USD', member: null,
    }]
    expect(capitalAt({ ...empty, realEstate }, '2028-08', rateAt, 'USD').realEstate).toEqual([])
    expect(capitalAt({ ...empty, realEstate }, '2029-03', rateAt, 'USD').realEstate).toEqual([
      { name: 'City apartment', member: '', currency: 'USD', value: 184000, valueBase: 184000 },
    ])
    const later = capitalAt({ ...empty, realEstate }, '2031-03', rateAt, 'USD')
    expect(later.realEstate[0]).toMatchObject({ value: 197000, valueBase: 197000 })
    expect(later.byClass).toEqual([{ class: 'real_estate', valueBase: 197000 }])
  })

  it('selects the latest eligible valuation from unordered rows and preserves the first tie', () => {
    const property = { name: 'City apartment', purchase_date: '2028-09-01', purchase_price: 184000, purchase_currency: 'USD', currency: 'USD', member: null }
    const realEstate = [
      { ...property, valuation_year: 2032, value: 240000 },
      { ...property, valuation_year: 2030, value: 197000 },
      { ...property, valuation_year: 2029, value: 190000 },
      { ...property, valuation_year: 2030, value: 210000 },
    ]
    const before = structuredClone(realEstate)
    expect(capitalAt({ ...empty, realEstate }, '2031-03', rateAt, 'USD').realEstate[0].value).toBe(197000)
    expect(realEstate).toEqual(before)
  })

  it('does not count property before its purchase date, even with a valuation of that year', () => {
    const realEstate = [{
      name: 'City apartment', purchase_date: '2031-06-15', purchase_price: 300000, purchase_currency: 'USD',
      valuation_year: 2031, value: 320000, currency: 'USD', member: null,
    }]
    expect(capitalAt({ ...empty, realEstate }, '2031-05', rateAt, 'USD').realEstate).toEqual([])
    expect(capitalAt({ ...empty, realEstate }, '2031-06', rateAt, 'USD').realEstate[0]).toMatchObject({ value: 320000 })
  })

  it('breaks assets down by currency and member, largest first, without rate-less rows', () => {
    const c = capitalAt({ ...empty, assets: [...march, asset('2030-03-31', 'Tarn Savings', 140, 'GBP')] }, '2030-03', rateAt, 'USD')
    expect(c.byCurrency).toEqual([{ currency: 'USD', valueBase: 6400 }, { currency: 'EUR', valueBase: 1680 }, { currency: 'RUB', valueBase: 1200 }])
    expect(c.byMember).toEqual([
      { member: 'Shared', valueBase: 6400 }, { member: 'Noa', valueBase: 1680 }, { member: 'Robin', valueBase: 1200 },
    ])
  })

  it('counts real estate under its own currency and, without an owner, under no member like an account without one', () => {
    const realEstate = [{
      name: 'Lake cabin', purchase_date: '2028-09-01', purchase_price: 90000, purchase_currency: 'EUR',
      valuation_year: 2030, value: 100000, currency: 'EUR', member: null,
    }]
    const c = capitalAt({ ...empty, assets: [asset('2030-03-31', 'Cash', 500, 'USD', 'bank', null)], realEstate }, '2030-03', rateAt, 'USD')
    expect(c.byCurrency).toEqual([{ currency: 'EUR', valueBase: 120000 }, { currency: 'USD', valueBase: 500 }])
    expect(c.byMember).toEqual([{ member: '', valueBase: 120500 }])
    expect(c.realEstate[0].member).toBe('')
  })

  it('counts a property with an owner under that member', () => {
    const property = (name: string, value: number, member: string | null) => ({
      name, purchase_date: '2028-09-01', purchase_price: value, purchase_currency: 'USD',
      valuation_year: 2030, value, currency: 'USD', member,
    })
    const realEstate = [property('City apartment', 200000, 'Noa'), property('Lake cabin', 90000, null)]
    const c = capitalAt({ ...empty, assets: [asset('2030-03-31', 'Cash', 500, 'USD', 'bank', 'Noa')], realEstate }, '2030-03', rateAt, 'USD')
    expect(c.byMember).toEqual([{ member: 'Noa', valueBase: 200500 }, { member: '', valueBase: 90000 }])
    expect(c.realEstate.map(r => r.member)).toEqual(['Noa', ''])
  })

  it('includes loan balances from the schedule, converted at the month-end rate', () => {
    const expected = computeSchedule(loan(), [])[0].closingBalance
    const c = capitalAt({ ...empty, loans: [loan()] }, '2031-03', rateAt, 'USD')
    expect(c.loans).toHaveLength(1)
    expect(c.loans[0].balance).toBeCloseTo(expected, 2)
    expect(c.loans[0].balanceBase).toBeCloseTo(expected / 75, 2)
    expect(c.liabilities).toBeCloseTo(expected / 75, 2)
    expect(c.netWorth).toBeCloseTo(-expected / 75, 2)
    expect(capitalAt({ ...empty, loans: [loan()] }, '2031-01', rateAt, 'USD').loans).toEqual([])
  })
})

describe('the scheduled payment of a loan', () => {
  it('a loan’s payment is the schedule’s for the month, not loans.monthly_payment, after a reduce_payment early payment', () => {
    const ep = earlyPaymentRow({ loan_name: 'Loan', payment_date: '2031-04-24', amount: 30000, strategy: 'reduce_payment', new_payment: 6000 })
    const l = loan({ monthly_payment: 8400 })
    const schedule = computeSchedule(l, [ep])
    const expected = schedule.find(r => r.date.startsWith('2031-06'))!.scheduledPayment
    expect(expected).toBe(6000)
    const c = capitalAt({ ...empty, loans: [l], earlyPayments: [ep] }, '2031-06', rateAt, 'USD')
    expect(c.loans[0].payment).toBeCloseTo(expected, 2)
    expect(c.loans[0].paymentBase).toBeCloseTo(expected / 75, 2)
  })

  it('has no base amount for a currency without a rate', () => {
    const c = capitalAt({ ...empty, loans: [loan({ currency: 'GBP' })] }, '2031-06', rateAt, 'USD')
    expect(c.loans[0].payment).toBeGreaterThan(0)
    expect(c.loans[0].paymentBase).toBeNull()
  })

  it('a finished loan is not listed, so it has no payment', () => {
    const done = loan({ status: 'closed', closed_date: '2031-04-18' })
    expect(capitalAt({ ...empty, loans: [done] }, '2031-06', rateAt, 'USD').loans).toEqual([])
  })
})

describe('interest over the next 12 months', () => {
  it('sums the schedule, so an amortising loan costs less than balance × rate', () => {
    const long = loan({ term_months: 36 })
    const schedule = computeSchedule(long, [])
    const c = capitalAt({ ...empty, loans: [long] }, '2031-03', rateAt, 'USD')
    const expected = schedule.filter(r => r.date > '2031-03-31' && r.date <= '2032-03-31').reduce((sum, r) => sum + r.interest, 0)
    expect(c.loans[0].interestNext12m).toBeCloseTo(expected, 2)
    expect(c.loans[0].interestNext12mBase).toBeCloseTo(expected / 75, 2)
    expect(c.loans[0].interestNext12m).toBeLessThan(c.loans[0].balance * 0.09)
    expect(c.loans[0].interestNext12m).toBeGreaterThan(0)
  })

  it('counts only the payments that are left when the loan ends sooner', () => {
    const schedule = computeSchedule(loan(), [])
    const c = capitalAt({ ...empty, loans: [loan()] }, '2031-10', rateAt, 'USD')
    const left = schedule.filter(r => r.date > '2031-10-31').reduce((sum, r) => sum + r.interest, 0)
    expect(c.loans[0].interestNext12m).toBeCloseTo(left, 2)
  })

  it('is the same whether the schedule is passed in or built on the spot', () => {
    const long = loan({ term_months: 36 })
    const withSchedule = capitalAt({ ...empty, loans: [long] }, '2031-03', rateAt, 'USD', new Map([[long.name, computeSchedule(long, [])]]))
    expect(withSchedule.loans[0].interestNext12m).toBe(capitalAt({ ...empty, loans: [long] }, '2031-03', rateAt, 'USD').loans[0].interestNext12m)
  })
})

describe('capitalHistory', () => {
  function monthly(from: string, count: number): AssetInput[] {
    return Array.from({ length: count }, (_, i) => asset(monthEnd(shiftMonth(from, i)), 'A', 2400 + i * 15))
  }

  it('builds one snapshot per month with balances', () => {
    const history = capitalHistory({ ...empty, assets: monthly('2030-03', 2) }, rateAt, 'USD')
    expect(history.map(c => c.date)).toEqual(['2030-03-31', '2030-04-30'])
    expect(history.map(c => c.netWorth)).toEqual([2400, 2415])
  })

  it('gives the repaid share of each loan: 1 − balance / principal, none without a principal', () => {
    const inputs: CapitalInputs = { ...empty, assets: monthly('2031-01', 14), loans: [loan(), loan({ name: 'Zero', principal: 0 })], earlyPayments: [] }
    const [first, zero] = [capitalAt(inputs, '2031-06', rateAt, 'USD').loans.find(l => l.name === 'Loan'), capitalAt(inputs, '2031-06', rateAt, 'USD').loans.find(l => l.name === 'Zero')]
    expect(first!.repaidPct).toBeCloseTo((1 - first!.balance / Number(loan().principal)) * 100, 3)
    expect(first!.repaidPct).toBeGreaterThan(0)
    expect(first!.repaidPct).toBeLessThan(100)
    expect(zero).toBeDefined()
    expect(zero!.repaidPct).toBeNull()
  })

  it('clamps the repaid share to 0–100: a balance above the principal is 0, a repaid loan 100', () => {
    const inputs: CapitalInputs = { ...empty, assets: monthly('2031-01', 14), loans: [loan({ name: 'Over' }), loan({ name: 'Repaid' })], earlyPayments: [] }
    const row = (closingBalance: number) => [{ rowNum: 1, date: '2031-03-18', openingBalance: 96000, scheduledPayment: 0, principalPart: 0, interest: 0, earlyPayment: 0, closingBalance }]
    const schedules = new Map([['Over', row(120000)], ['Repaid', row(0)]])
    const loans = capitalAt(inputs, '2031-06', rateAt, 'USD', schedules).loans
    expect(loans.find(l => l.name === 'Over')!.repaidPct).toBe(0)
    expect(loans.find(l => l.name === 'Repaid')!.repaidPct).toBe(100)
  })

  it('gives the same loan balances as month-by-month capitalAt, early payments included', () => {
    const ep = earlyPaymentRow({ loan_name: 'Loan', payment_date: '2031-06-24', amount: 24000 })
    const inputs: CapitalInputs = {
      ...empty,
      assets: monthly('2031-01', 14),
      loans: [loan(), loan({ name: 'Car loan', principal: 54000, issue_date: '2031-02-25', payment_day: 25 })],
      earlyPayments: [ep],
    }
    const history = capitalHistory(inputs, rateAt, 'USD')
    expect(history.map(c => c.loans)).toEqual(history.map(c => capitalAt(inputs, c.date.slice(0, 7), rateAt, 'USD').loans))
    expect(history[1].loans).toHaveLength(2)
    const credit = (h: typeof history, i: number) => h[i].loans.find(l => l.name === 'Loan')!.balance
    expect(credit(history, 5)).toBeLessThan(credit(capitalHistory({ ...inputs, earlyPayments: [] }, rateAt, 'USD'), 5))
  })
})

describe('asset breakdowns of the fictional family', () => {
  const family = buildFamily({ today: '2026-07-03' })
  const inputs: CapitalInputs = { assets: family.assets, realEstate: family.realEstate, loans: [], earlyPayments: [] }
  const latest = capitalHistory(inputs, rateAt, 'USD').at(-1)!

  it('sums to the assets in both views', () => {
    const total = (list: { valueBase: number }[]) => Math.round(list.reduce((s, x) => s + x.valueBase, 0) * 100) / 100
    expect(latest.assets).toBeGreaterThan(0)
    expect(total(latest.byCurrency)).toBeCloseTo(latest.assets, 1)
    expect(total(latest.byMember)).toBeCloseTo(latest.assets, 1)
  })

  it('has USD and EUR, and both members; every property has an owner', () => {
    expect(latest.byCurrency.map(x => x.currency).sort()).toEqual(['EUR', 'USD'])
    expect(latest.byMember.map(x => x.member).sort()).toEqual([...DEMO_FAMILIES['en-US'].members].sort())
  })

  it('is ordered by value, descending', () => {
    for (const list of [latest.byCurrency, latest.byMember]) {
      expect(list.map(x => x.valueBase)).toEqual([...list.map(x => x.valueBase)].sort((a, b) => b - a))
    }
  })
})

describe('capitalAt: loans secured by a property', () => {
  const family = buildFamily({ today: '2026-10-05' })
  const home = family.realEstate[0].name
  const [mortgage, car] = family.loans.map((l, i) => ({ ...l, rowid: i + 1 }) as LoanRow)
  const eps = family.loanEarlyPayments.map((e, i) => ({ rowid: i + 1, id: i + 1, ...e })) as never[]
  const inputs = (loans: LoanRow[]): CapitalInputs => ({ assets: family.assets, realEstate: family.realEstate, loans, earlyPayments: eps })

  it('carries the schedule balance at the month (early payments included), not the principal or today', () => {
    const c = capitalAt(inputs([{ ...mortgage, secured_by: home }]), '2026-09', rateAt, 'USD')
    expect(c.securedLoans).toEqual([expect.objectContaining({ name: mortgage.name, property: home, principal: 416000, issueDate: String(mortgage.issue_date) })])
    const balance = c.securedLoans[0].balance
    expect(balance).toBe(c.loans.find(l => l.name === mortgage.name)!.balance)
    expect(balance).toBeLessThan(416000)
    // the balance of that month: a year earlier more was owed, and an early payment of the demo lies between
    expect(capitalAt(inputs([{ ...mortgage, secured_by: home }]), '2025-09', rateAt, 'USD').securedLoans[0].balance).toBeGreaterThan(balance)
  })

  it('a loan its schedule has paid off owes 0 in any currency, one without a rate too', () => {
    const paid = { ...car, name: 'Old loan', currency: 'XYZ', issue_date: '2020-01-15', principal: 1200, rate: 0, term_months: 12, monthly_payment: 100 } as LoanRow
    const c = capitalAt(inputs([paid]), '2026-09', rateAt, 'USD')
    expect(c.loans).toEqual([expect.objectContaining({ name: 'Old loan', balance: 0, balanceBase: 0 })])
  })

  it('a closed loan counts 0; an unknown property and a loan not issued yet are left out', () => {
    const closed = { ...car, secured_by: home, status: 'closed', closed_date: '2026-01-01' } as LoanRow
    const c = capitalAt(inputs([closed, { ...mortgage, secured_by: 'Castle' }, { ...mortgage, name: 'Future', issue_date: '2027-01-01', secured_by: home }]), '2026-09', rateAt, 'USD')
    expect(c.securedLoans).toEqual([expect.objectContaining({ name: car.name, balance: 0, balanceBase: 0 })])
    expect(c.loans.some(l => l.name === car.name)).toBe(false)
  })
})
