import { capitalMovements, periodBridge, forecastCash, historicalBudget, monthFlow } from '../../src/domain/financialAnalysis'
import { makeSnapshot } from '../helpers/snapshot'
import type { CategorisedMonth } from '../../src/domain/spending'

const categoryMonth = (month: string, amount: number): CategorisedMonth => ({
  month, categories: [{ categoryId: 1, name: 'Food', kind: 'optional', flow: 'expense', oneOff: false, amountBase: amount }],
  allocatedBase: amount, totalBase: amount, unallocatedBase: 0, coveragePct: 100,
})

it('reconciles a capital bridge without describing its residual as investment return', () => {
  const s = makeSnapshot()
  s.capital = { ...s.capital!, date: '2031-06-30', netWorth: 1400 }
  s.history = [{ date: '2031-05-31', assets: 1000, liabilities: 0, netWorth: 1000 }, { date: '2031-06-30', assets: 1400, liabilities: 0, netWorth: 1400 }]
  s.cashflow.closedMonth = { month: '2031-06', active: 500, passive: 0, income: 500, expense: 300, net: 200 }
  s.cashflow.rows = [{ month: '2031-06', bank: 'Bank', member: '', currency: 'USD', active: 500, passive: 0, expense: 300, activeBase: 500, passiveBase: 0, expenseBase: 300 }]
  s.warnings = []
  expect(periodBridge(s, ['2031-06'])).toEqual({ from: '2031-05', to: '2031-06', start: 1000, end: 1400, saving: 200, other: 200 })
  s.history[0].date = '2031-04-30'
  expect(periodBridge(s, ['2031-06'])).toBeNull()
})

it('rejects absent period history and unknown exchange rates', () => {
  const s = makeSnapshot()
  s.cashflow.closedMonth = { ...s.cashflow.closedMonth!, month: '2020-01' }
  expect(periodBridge(s, ['2031-06'])).toBeNull()
  s.cashflow.rows = ['2019-11', '2019-12', '2020-01'].map(month => ({ month, bank: 'Bank', member: '', currency: 'USD', active: 100, passive: 0, expense: 80, activeBase: 100, passiveBase: 0, expenseBase: 80 }))
  s.cashflow.rows[0].expenseBase = null
  expect(historicalBudget(s)).toBeNull()
})

const input = { month: '2031-06', horizon: 6 as const, starting: 1000, income: 500, expense: 400, reserve: 800, incomeLossPct: 100, lossMonths: 2, expenseIncreasePct: 0, purchase: 0, purchaseMonth: 1, goalContribution: 0 }
it('compares temporary income loss with baseline and recovers afterwards', () => {
  const result = forecastCash(input)!
  expect(result.points.map(p => p.stress)).toEqual([1000, 600, 200, 300, 400, 500, 600])
  expect(result.points.at(-1)?.baseline).toBe(1600)
  expect(result.belowReserve).toBe('2031-07')
  expect(result.negative).toBeNull()
  expect(result.minimum).toBe(200)
})

it('deducts purchase once, distinguishes exhausted reserve from negative cash and rejects invalid inputs', () => {
  const result = forecastCash({ ...input, incomeLossPct: 0, purchase: 1500, purchaseMonth: 2 })!
  expect(result.points.map(p => p.stress)).toEqual([1000, 1100, -300, -200, -100, 0, 100])
  expect(result.negative).toBe('2031-08')
  expect(forecastCash({ ...input, expense: NaN })).toBeNull()
  expect(forecastCash({ ...input, incomeLossPct: 101 })).toBeNull()
})

it('averages three complete months and excludes known one-off receipts while keeping loan payments once', () => {
  const s = makeSnapshot()
  s.warnings = []
  s.cashflow.closedMonth = { month: '2031-06', active: 100, passive: 0, income: 100, expense: 50, net: 50 }
  s.cashflow.rows = ['2031-04', '2031-05', '2031-06'].flatMap(month => [
    { month, bank: 'Bank', member: '', currency: 'USD', active: 100, passive: 0, expense: 30, activeBase: 100, passiveBase: 0, expenseBase: 30 },
    { month, bank: 'Loan', member: '', currency: 'USD', loan: true as const, active: 0, passive: 0, expense: 20, activeBase: 0, passiveBase: 0, expenseBase: 20 },
  ])
  s.income.months = [{ ...categoryMonth('2031-06', 60), categories: [{ categoryId: 2, name: 'Bonus', kind: 'optional', flow: 'active', oneOff: true, amountBase: 60 }] }]
  expect(historicalBudget(s)).toMatchObject({ income: 80, expense: 50, months: ['2031-04', '2031-05', '2031-06'] })
  // a gap elsewhere in the history does not void three known months (the same baseline as the reserve's)
  s.warnings = [{ code: 'missing_balance', params: { month: '2030-01' } }]
  expect(historicalBudget(s)).toMatchObject({ income: 80, expense: 50 })
  s.cashflow.rows = s.cashflow.rows.filter(r => r.month !== '2031-05')
  expect(historicalBudget(s)).toBeNull()
})

it('shows recorded capital movements without treating them as causes of investment returns', () => {
  const s = makeSnapshot()
  const account = { name: 'Bank', member: 'Alex', class: 'bank' as const, currency: 'USD', value: 100, valueBase: 100 }
  s.capital = { ...s.capital!, date: '2031-06-30', accounts: [{ ...account, value: 140, valueBase: 140 }], realEstate: [], loans: [] }
  s.previousCapital = { ...s.capital, date: '2031-05-31', accounts: [account] }
  s.warnings = []
  expect(capitalMovements(s)).toEqual([{ kind: 'account', name: 'Bank', member: 'Alex', start: 100, end: 140, change: 40 }])
  s.previousCapital.accounts[0].valueBase = null
  expect(capitalMovements(s)).toBeNull()
})

it('does not compare capital records across missing months or incomplete balances', () => {
  const s = makeSnapshot()
  s.previousCapital = { ...s.capital!, date: '2030-01-31' }
  expect(capitalMovements(s)).toBeNull()
  s.previousCapital.date = '2031-05-31'
  s.warnings = [{ code: 'missing_balance' }]
  expect(capitalMovements(s)).toBeNull()
})

it('keeps observed balance changes available without cashflow and keys property by name', () => {
  const s = makeSnapshot()
  s.warnings = [{ code: 'missing_cashflow' }]
  const property = s.capital!.realEstate[0]
  s.capital = { ...s.capital!, accounts: [], loans: [], realEstate: [{ ...property, member: 'Ilya', valueBase: 100000 }] }
  s.previousCapital = { ...s.capital, date: '2031-05-31', realEstate: [{ ...property, member: 'Anna', valueBase: 100000 }] }
  expect(capitalMovements(s)).toEqual([])
  s.capital.realEstate[0].valueBase = 110000
  expect(capitalMovements(s)).toEqual([{ kind: 'realEstate', name: property.name, member: 'Ilya', start: 100000, end: 110000, change: 10000 }])
})

it('gives the flow of a month only when all its flows are known and the month is complete', () => {
  const s = makeSnapshot()
  const row = { month: '2031-06', bank: 'Bank', member: '', currency: 'USD', active: 500, passive: 20, expense: 300, activeBase: 500, passiveBase: 20, expenseBase: 300 }
  s.cashflow.rows = [row, { ...row, bank: 'Cash', activeBase: 100, passiveBase: 0, expenseBase: 50 }]
  s.analysisMonths = [{ month: '2031-06', capital: true, cashflow: true }]
  expect(monthFlow(s, '2031-06')).toEqual({ income: 620, expense: 350 })
  expect(monthFlow(s, '2031-05')).toBeNull()
  s.analysisMonths = [{ month: '2031-06', capital: true, cashflow: false }]
  expect(monthFlow(s, '2031-06')).toBeNull()
  s.analysisMonths = undefined
  s.cashflow.rows[1].expenseBase = null
  expect(monthFlow(s, '2031-06')).toBeNull()
})
