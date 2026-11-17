import type { FinanceSnapshot, GrowthBeyondSavings, ReturnMonth } from '../../src/domain/types'
import { shiftMonth } from '../../src/domain/dates'
import { round2 } from '../../src/domain/fx'
import { DEMO_FAMILIES } from '../../src/demo/family'

/** A joint owner beside the family's two members, as a family may record one. */
export const SHARED = 'Shared'

/** The fixture's monthly rate beyond savings: 0.5 % a month, ≈ 6.17 % a year */
export const FIXTURE_MONTHLY_RATE = 0.005

/**
 * Growth beyond savings for the fixture: 14 months considered, May and June 2030 left out without cash flow,
 * twelve used months from July 2030 to June 2031 saving 900 a month at 0.5 % a month.
 */
export function makeGrowthBeyondSavings(over: Partial<GrowthBeyondSavings> = {}): GrowthBeyondSavings {
  const months: ReturnMonth[] = []
  let nw = 120000
  for (let i = 0; i < 12; i++) {
    const saving = 900
    const end = round2(nw + saving + FIXTURE_MONTHLY_RATE * (nw + saving / 2))
    months.push({ month: shiftMonth('2030-07', i), startNetWorth: nw, endNetWorth: end, saving, monthlyRate: FIXTURE_MONTHLY_RATE })
    nw = end
  }
  const growthTotal = Math.pow(1 + FIXTURE_MONTHLY_RATE, 12) - 1
  return {
    annualRate: growthTotal, growthTotal, months,
    monthsSkipped: [{ month: '2030-05', reason: 'no_cashflow' }, { month: '2030-06', reason: 'no_cashflow' }],
    monthsConsidered: 14, minMonths: 6,
    startNetWorth: months[0].startNetWorth, endNetWorth: months[11].endNetWorth, savingsTotal: 10800,
    growthAmount: round2(months.reduce((a, m) => a + m.endNetWorth - m.startNetWorth - m.saving, 0)),
    ...over,
  }
}

/** A full snapshot with plausible numbers (amounts in USD) and family member names — to check they do not leak. */
export function makeSnapshot(over: Partial<FinanceSnapshot> = {}): FinanceSnapshot {
  const [robin, noa] = DEMO_FAMILIES['en-US'].members
  return {
    generatedAt: '2031-07-03T09:00:00Z',
    baseCurrency: 'USD',
    familyCurrency: 'USD',
    currencies: ['EUR', 'RUB', 'USD'],
    members: [...DEMO_FAMILIES['en-US'].members],
    asOf: { capitalDate: '2031-06-30', closedMonth: '2031-06', openMonths: [], today: '2031-07-03' },
    rates: null,
    previousCapital: null,
    accountLifecycle: [],
    capital: {
      date: '2031-06-30',
      assets: 184508, liabilities: 47835, netWorth: 136673, liquid: 19268,
      byClass: [
        { class: 'bank', valueBase: 19268 },
        { class: 'broker', valueBase: 31240 },
        { class: 'real_estate', valueBase: 134000 },
      ],
      byCurrency: [
        { currency: 'USD', valueBase: 165240 },
        { currency: 'RUB', valueBase: 15748 },
        { currency: 'EUR', valueBase: 3520 },
      ],
      byMember: [
        { member: '', valueBase: 134000 },
        { member: SHARED, valueBase: 31240 },
        { member: robin, valueBase: 15748 },
        { member: noa, valueBase: 3520 },
      ],
      accounts: [
        { name: 'Lumiora Bank', member: robin, class: 'bank', currency: 'RUB', value: 1200000, valueBase: 15748 },
        { name: 'Brisaluna Bank', member: noa, class: 'bank', currency: 'EUR', value: 3000, valueBase: 3520 },
      ],
      realEstate: [{ name: 'City apartment', member: '', currency: 'USD', value: 134000, valueBase: 134000 }],
      loans: [
        { name: 'City apartment mortgage', member: robin, type: 'mortgage', currency: 'RUB', rate: 10.4, balance: 3350000, balanceBase: 43963, payment: 41000, paymentBase: 538, repaidPct: 38, interestNext12m: 330000, interestNext12mBase: 4331 },
        { name: 'Car loan', member: noa, type: 'consumer', currency: 'EUR', rate: 11.2, balance: 3300, balanceBase: 3872, payment: 310, paymentBase: 364, repaidPct: 62, interestNext12m: 330, interestNext12mBase: 387 },
      ],
      securedLoans: [],
      monthDelta: -820, yoyDelta: 9173,
    },
    history: [
      { date: '2030-06-30', assets: 170000, liabilities: 42500, netWorth: 127500 },
      { date: '2031-06-30', assets: 184508, liabilities: 47835, netWorth: 136673 },
    ],
    growthBeyondSavings: makeGrowthBeyondSavings(),
    cashflow: {
      closedMonth: { month: '2031-06', income: 6730, active: 6320, passive: 410, expense: 10480, net: -3750 },
      rows: [],
      avg3m: { months: 3, expensePerMonth: 10010, passivePerMonth: 355, netPerMonth: -3480, ratePct: -52.4 },
      avg12m: { months: 12, expensePerMonth: 10120, passivePerMonth: 128, netPerMonth: -3900, ratePct: -61 },
      savingsRatePct: -55.72,
      emergencyMonths: 1.84,
    },
    spending: { months: [], mandatory: null },
    income: { months: [] },
    health: {
      composite: 40.5,
      metrics: {
        savings_rate: { value: -55.72, zone: 'red' },
        emergency_months: { value: 1.84, zone: 'amber' },
        fi_rate: { value: 3.91, zone: 'amber' },
        debt_to_asset: { value: 25.93, zone: 'green' },
        real_growth_yoy: { value: 4.09, zone: 'green' },
        avg_debt_rate: { value: 10.47, zone: 'green' },
        consumer_debt_months: { value: 0.58, zone: 'excellent' },
        debt_payment_ratio: { value: 13.4, zone: 'green' },
        income_diversification: { value: 6.09, zone: 'amber' },
      },
    },
    goals: {
      items: [],
      plan: { allocations: [], totalRequiredBase: 7240, monthlySavingsBase: 0, surplusBase: -7240 },
      fire: {
        goalId: 'fire', targetBase: 910000, currentBase: 372000, progressPct: 40.9,
        reached: false, forecastMonth: '2043-07', atDeadlineBase: 640000, strategies: { more: '2042-09', low: '2045-03', high: '2041-11', extraBase: 500 },
        series: { pace: [372000, 500000, 910000], more: [372000, 910000], low: [372000, 450000, 800000, 910000], high: [372000, 600000, 910000] },
        coastFire: { reached: false, gapBase: 301200 },
        actualCagr: 0.0719, requiredCagr: 0.118,
      },
    },
    parameters: { inflation_rate: 3.1 },
    // inflation in the snapshot's own currency: its net worths are the capital's now and a year ago
    inflation: { ratePct: 3.1, currency: 'USD', netWorthNow: 136673, netWorthYearAgo: 127500 },
    trackFlows: true,
    warnings: [{ code: 'fx_fallback', ref: 'RUB 2031-07-01', params: { currency: 'RUB', date: '2031-07-01', used: '2031-06-30' } }],
    ...over,
  }
}

/** The snapshot of an empty database: nothing is computed. */
export function emptySnapshot(): FinanceSnapshot {
  const empty = { months: 0, expensePerMonth: 0, passivePerMonth: 0, netPerMonth: 0, ratePct: null }
  return makeSnapshot({
    asOf: { capitalDate: null, closedMonth: null, openMonths: [], today: '2031-07-03' },
    rates: null,
    capital: null,
    history: [],
    growthBeyondSavings: null,
    cashflow: { closedMonth: null, rows: [], avg3m: empty, avg12m: empty, savingsRatePct: null, emergencyMonths: null },
    spending: { months: [], mandatory: null },
    income: { months: [] },
    health: null,
    goals: { items: [], plan: { allocations: [], totalRequiredBase: 0, monthlySavingsBase: 0, surplusBase: 0 }, fire: null },
    parameters: {},
    inflation: null,
    warnings: [],
  })
}

/** makeSnapshot with the closed month's one account row behind its totals: what the Income and expenses page reads */
export function flowsSnapshot(over: Partial<FinanceSnapshot> = {}): FinanceSnapshot {
  const base = makeSnapshot(over)
  const rows = base.cashflow.rows.length ? base.cashflow.rows
    : [{ month: '2031-06', bank: 'Lumiora Bank', member: base.members[0], currency: 'USD', active: 6320, passive: 410, expense: 10480, activeBase: 6320, passiveBase: 410, expenseBase: 10480 }]
  return { ...base, cashflow: { ...base.cashflow, rows } }
}
