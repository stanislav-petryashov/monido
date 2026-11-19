import { forecastCash, historicalBudget, monthFlow } from '../../src/domain/financialAnalysis'
import { periodChange } from '../../src/domain/capitalStory'
import { makeSnapshot } from '../helpers/snapshot'
import type { CategorisedMonth } from '../../src/domain/spending'

const categoryMonth = (month: string, amount: number): CategorisedMonth => ({
  month, categories: [{ categoryId: 1, name: 'Food', kind: 'optional', flow: 'expense', oneOff: false, amountBase: amount }],
  allocatedBase: amount, totalBase: amount, unallocatedBase: 0, coveragePct: 100,
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

it('a gap outside the bridge\'s months (a goal in a currency without a rate) does not hide it', async () => {
  const { buildSnapshot } = await import('../../src/domain/snapshot')
  const months = ['2031-06', '2031-07', '2031-08']
  const rows = {
    assets: months.map((m, i) => ({ date: new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).toISOString().slice(0, 10), class: 'bank', name: 'A', value: 10000 + 1000 * i, currency: 'USD', member: 'Robin' })),
    cashflow: months.map(m => ({ date: `${m}-01`, bank: 'A', member: 'Robin', active_income: 3000, passive_income: 0, expense: 2000, currency: 'USD' })),
    loanPayments: [], spendingCategories: [], categorySpending: [], flowLines: [], manualMandatory: null, members: [], realEstate: [], loans: [], earlyPayments: [],
    parameters: {}, closedMonths: months.map(month => ({ month, source: 'wizard' as const })), trackFlows: true, currencies: ['USD', 'KZT'], inflationCurrency: null,
  }
  const bridge = (goals: unknown[]) => periodChange(buildSnapshot({ rows: { ...rows, goals } as never, rateAt: () => ({}), baseCurrency: 'USD', familyCurrency: 'USD', today: new Date('2031-09-10T00:00:00Z') }).capitalChange!, ['2031-07', '2031-08'])
  const plain = bridge([])
  expect(plain).toMatchObject({ start: 10000, end: 12000, rows: { saved: 2000, unexplained: 0 } })
  expect(bridge([{ id: 'g', name: 'Flat', target: 5e7, current: 0, target_date: '2035-01-31', emoji: null, currency: 'KZT' }])).toEqual(plain)
})
