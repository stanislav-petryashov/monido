import { describe, expect, it } from 'vitest'
import { toHistoryPoint } from '../../src/domain/capital'
import { monthEnd, monthsBetween, shiftMonth } from '../../src/domain/dates'
import { round2 } from '../../src/domain/fx'
import { computeCagr } from '../../src/domain/goals'
import { computeGrowthBeyondSavings, MIN_RETURN_MONTHS } from '../../src/domain/returns'
import type { AccountValue, CapitalSnapshot, CashflowRowBase } from '../../src/domain/types'

const START = '2030-01'
const month = (i: number) => shiftMonth(START, i)

/** A minimal month-end point: only the net worth matters here; `accounts` carries an injected rate-less row. */
function cap(m: string, netWorth: number, accounts: AccountValue[] = []): CapitalSnapshot {
  return {
    date: monthEnd(m), assets: netWorth, liabilities: 0, netWorth, liquid: 0,
    byClass: [], byCurrency: [], byMember: [], accounts, realEstate: [], loans: [], securedLoans: [],
  }
}

/** One cash-flow row of month `m` with its base amounts set (income all active). */
function flow(m: string, income: number, expense: number, base: Partial<CashflowRowBase> = {}): CashflowRowBase {
  return {
    month: m, bank: 'Lumiora Bank', member: 'Robin', currency: 'USD',
    active: income, passive: 0, expense, activeBase: income, passiveBase: 0, expenseBase: expense, ...base,
  }
}

const chain = (rates: number[]) => rates.reduce((p, r) => p * (1 + r), 1) - 1
const dietz = (nw0: number, nw1: number, f: number) => (nw1 - nw0 - f) / (nw0 + f / 2)

describe('computeGrowthBeyondSavings', () => {
  it('zero saving equals capital growth', () => {
    const nws = [100000, 103000, 101500, 108000, 110000, 109000, 115000, 118000, 117500, 121000, 125000, 124000, 130000]
    const history = nws.map((nw, i) => cap(month(i), nw))
    const flows = nws.slice(1).map((_, i) => flow(month(i + 1), 4000, 4000))
    const g = computeGrowthBeyondSavings(history, flows)
    expect(g.months).toHaveLength(12)
    expect(g.monthsSkipped).toEqual([])
    expect(g.annualRate).toBeCloseTo(computeCagr(history.map(toHistoryPoint), new Set())!, 9)
  })

  it('pure saving with no return gives ~0', () => {
    const savings = [2000, 3500, -1500, 4000, 0, 2500, -800, 3000]
    const nws = [50000]
    for (const s of savings) nws.push(nws.at(-1)! + s)
    const history = nws.map((nw, i) => cap(month(i), nw))
    const flows = savings.map((s, i) => flow(month(i + 1), s > 0 ? 6000 + s : 6000, s > 0 ? 6000 : 6000 - s))
    const g = computeGrowthBeyondSavings(history, flows)
    expect(g.months).toHaveLength(8)
    expect(Math.abs(g.annualRate!)).toBeLessThan(1e-9)
    for (const m of g.months) expect(Math.abs(m.monthlyRate)).toBeLessThan(1e-12)
  })

  it('one big contribution does not read as return', () => {
    const nws = [10000, 10000, 10000, 10000, 10000, 10000, 10000, 60000]
    const history = nws.map((nw, i) => cap(month(i), nw))
    const flows = nws.slice(1).map((_, i) => (i === 6 ? flow(month(i + 1), 50000, 0) : flow(month(i + 1), 1000, 1000)))
    const g = computeGrowthBeyondSavings(history, flows)
    expect(g.annualRate).toBeCloseTo(0, 9)
    expect(computeCagr(history.map(toHistoryPoint), new Set())!).toBeGreaterThan(1)
  })

  it('hand-checked Dietz month', () => {
    const history: CapitalSnapshot[] = []
    const flows: CashflowRowBase[] = []
    // the first month is 100 000 → saves 2 000 → 103 000; the next ones repeat it in proportion (save 2 %, end 3 % up),
    // so every month has the same rate
    let nw = 100000
    history.push(cap(month(0), nw))
    for (let i = 1; i <= 12; i++) {
      const f = nw * 0.02
      const nw1 = nw * 1.03
      flows.push(flow(month(i), 10000 + f, 10000))
      history.push(cap(month(i), nw1))
      nw = nw1
    }
    const g = computeGrowthBeyondSavings(history, flows)
    const r = 1000 / 101000
    expect(g.months[0].monthlyRate).toBeCloseTo(r, 12)
    expect(g.growthTotal).toBeCloseTo(Math.pow(1 + r, 12) - 1, 6)
    expect(g.growthTotal).toBeCloseTo(0.1255, 4)
    expect(g.annualRate).toBeCloseTo(g.growthTotal!, 12)
  })

  it('a missing balance month skips the gap and the month after it', () => {
    const nws = [100000, 102000, 104000, 106000, 108000, 110000, 112000, 114000, 116000, 118000]
    const k = 4
    const history = nws.map((nw, i) => cap(month(i), nw)).filter((_, i) => i !== k)
    const flows = nws.slice(1).map((_, i) => flow(month(i + 1), 6000, 5000))
    const g = computeGrowthBeyondSavings(history, flows)
    expect(g.monthsSkipped).toEqual([{ month: month(k), reason: 'no_balance' }, { month: month(k + 1), reason: 'no_balance' }])
    expect(g.months.map(m => m.month)).not.toContain(month(k))
    expect(g.months.map(m => m.month)).not.toContain(month(k + 1))
    expect(g.months).toHaveLength(7)
    const rates = [1, 2, 3, 6, 7, 8, 9].map(i => dietz(nws[i - 1], nws[i], 1000))
    expect(g.growthTotal).toBeCloseTo(chain(rates), 12)
    expect(g.annualRate).toBeCloseTo(Math.pow(1 + chain(rates), 12 / 7) - 1, 12)
    expect(g.monthsConsidered).toBe(9)
  })

  it('a month whose net worth is partial (one account\'s balance missing) skips itself and the month after it', () => {
    const nws = [100000, 102000, 104000, 106000, 108000, 110000, 112000, 114000, 116000, 118000]
    const k = 4
    // the month's point exists but lacks a 50,000 account: counted as 0 it would read as a −45% month
    const history = nws.map((nw, i) => cap(month(i), i === k ? nw - 50000 : nw))
    const flows = nws.slice(1).map((_, i) => flow(month(i + 1), 6000, 5000))
    const g = computeGrowthBeyondSavings(history, flows, new Set([month(k)]))
    expect(g.monthsSkipped).toEqual([{ month: month(k), reason: 'no_balance' }, { month: month(k + 1), reason: 'no_balance' }])
    const rates = [1, 2, 3, 6, 7, 8, 9].map(i => dietz(nws[i - 1], nws[i], 1000))
    expect(g.growthTotal).toBeCloseTo(chain(rates), 12)
  })

  it('a month without cash flow is left out, not zero', () => {
    const nws = [100000, 101000, 102000, 120000, 121000, 122000, 123000, 124000]
    const k = 3
    const history = nws.map((nw, i) => cap(month(i), nw))
    const all = nws.slice(1).map((_, i) => flow(month(i + 1), 2000, 1500))
    const flows = all.filter(r => r.month !== month(k))
    const g = computeGrowthBeyondSavings(history, flows)
    expect(g.monthsSkipped).toEqual([{ month: month(k), reason: 'no_cashflow' }])
    const used = [1, 2, 4, 5, 6, 7].map(i => dietz(nws[i - 1], nws[i], 500))
    expect(g.growthTotal).toBeCloseTo(chain(used), 12)
    const withZero = computeGrowthBeyondSavings(history, [...flows, flow(month(k), 1000, 1000)])
    expect(withZero.annualRate).not.toBeCloseTo(g.annualRate!, 3)
  })

  it('non-positive start is skipped', () => {
    for (const nw0 of [0, -5000]) {
      const g = computeGrowthBeyondSavings([cap(month(0), nw0), cap(month(1), 1000)], [flow(month(1), 1000, 500)])
      expect(g.monthsSkipped).toEqual([{ month: month(1), reason: 'nonpositive_start' }])
    }
    // the Dietz base 1 000 + (−3 000)/2 = −500
    const g = computeGrowthBeyondSavings([cap(month(0), 1000), cap(month(1), 100)], [flow(month(1), 0, 3000)])
    expect(g.monthsSkipped).toEqual([{ month: month(1), reason: 'nonpositive_start' }])
    expect(g.months).toEqual([])
  })

  it('an amount without a rate skips the month', () => {
    const rateless: AccountValue = { name: 'Brisaluna Bank', member: 'Noa', class: 'bank', currency: 'GBP', value: 100, valueBase: null }
    const nws = [100000, 101000, 102000, 103000, 104000]
    const history = nws.map((nw, i) => cap(month(i), nw, i === 2 ? [rateless] : []))
    const flows = nws.slice(1).map((_, i) => flow(month(i + 1), 2000, 1500))
    const g = computeGrowthBeyondSavings(history, flows)
    expect(g.monthsSkipped).toEqual([{ month: month(2), reason: 'no_rate' }, { month: month(3), reason: 'no_rate' }])

    const flows2 = flows.map(r => (r.month === month(1) ? { ...r, expenseBase: null } : r))
    const g2 = computeGrowthBeyondSavings(nws.map((nw, i) => cap(month(i), nw)), flows2)
    expect(g2.monthsSkipped).toEqual([{ month: month(1), reason: 'no_rate' }])
  })

  it('fewer than MIN_RETURN_MONTHS gives null but keeps the inputs', () => {
    const nws = [100000, 101000, 102500, 103000, 104000, 106000]
    const g = computeGrowthBeyondSavings(nws.map((nw, i) => cap(month(i), nw)), nws.slice(1).map((_, i) => flow(month(i + 1), 2000, 1500)))
    expect(MIN_RETURN_MONTHS).toBe(6)
    expect(g.minMonths).toBe(MIN_RETURN_MONTHS)
    expect(g.annualRate).toBeNull()
    expect(g.months).toHaveLength(5)
    expect(g.growthTotal).not.toBeNull()
    expect(g.startNetWorth).toBe(100000)
    expect(g.endNetWorth).toBe(106000)
    expect(g.savingsTotal).toBe(2500)
  })

  it('summary fields come from the used months', () => {
    const nws = [90000, 100000, 101000, 102500, 103000, 104000, 106000, 107000, 109333.33]
    // the first month has no cash flow: the summary starts at the second point, not at history[0]
    const history = nws.map((nw, i) => cap(month(i), nw))
    const flows = nws.slice(2).map((_, i) => flow(month(i + 2), 2000.333, 1500))
    const g = computeGrowthBeyondSavings(history, flows)
    expect(g.monthsSkipped).toEqual([{ month: month(1), reason: 'no_cashflow' }])
    expect(g.startNetWorth).toBe(g.months[0].startNetWorth)
    expect(g.startNetWorth).toBe(100000)
    expect(g.endNetWorth).toBe(g.months.at(-1)!.endNetWorth)
    expect(g.savingsTotal).toBe(round2(g.months.reduce((a, m) => a + m.saving, 0)))
    expect(g.monthsConsidered).toBe(monthsBetween(month(0), month(8)))
  })

  it('a loan payment is a transfer: only its interest counts, against the growth', () => {
    // income = living expenses; a payment P = 1 500 of which interest I = 500 and principal K = 1 000:
    // cash falls by P, the debt by K, so net worth falls by I
    const P = 1500, I = 500
    const nws = [200000]
    for (let i = 0; i < 6; i++) nws.push(nws.at(-1)! - I)
    const history = nws.map((nw, i) => cap(month(i), nw))
    const flows = nws.slice(1).flatMap((_, i) => [
      flow(month(i + 1), 5000, 5000),
      flow(month(i + 1), 0, P, { bank: 'Home loan', loan: true }),
    ])
    const g = computeGrowthBeyondSavings(history, flows)
    expect(g.months).toHaveLength(6)
    for (const [i, m] of g.months.entries()) {
      expect(m.saving).toBe(0)
      expect(m.monthlyRate).toBeCloseTo(-I / nws[i], 12)
    }
    expect(g.annualRate!).toBeLessThan(0)
    expect(g.growthAmount).toBe(-6 * I)
  })

  it('a month with loan payments only has no cash flow', () => {
    const g = computeGrowthBeyondSavings([cap(month(0), 1000), cap(month(1), 900)], [flow(month(1), 0, 100, { loan: true })])
    expect(g.monthsSkipped).toEqual([{ month: month(1), reason: 'no_cashflow' }])
  })

  it('the growth in money excludes a month left out inside the span', () => {
    // the third month jumps by 50 000 with no cash flow: left out, so it is in end − start − saved but not in growthAmount
    const nws = [100000, 101000, 102000, 152000, 153000, 154000, 155000, 156000]
    const history = nws.map((nw, i) => cap(month(i), nw))
    const flows = nws.slice(1).map((_, i) => flow(month(i + 1), 1500, 1000)).filter(r => r.month !== month(3))
    const g = computeGrowthBeyondSavings(history, flows)
    expect(g.monthsSkipped).toEqual([{ month: month(3), reason: 'no_cashflow' }])
    expect(g.savingsTotal).toBe(6 * 500)
    expect(g.growthAmount).toBe(6 * 500)
    expect(g.endNetWorth! - g.startNetWorth! - g.savingsTotal!).toBe(53000)
  })

  it('fewer than two points', () => {
    for (const history of [[], [cap(month(0), 1000)]]) {
      expect(computeGrowthBeyondSavings(history, [])).toEqual({
        annualRate: null, growthTotal: null, months: [], monthsSkipped: [], monthsConsidered: 0, minMonths: MIN_RETURN_MONTHS,
        startNetWorth: null, endNetWorth: null, savingsTotal: null, growthAmount: null,
      })
    }
  })

  it('never NaN or Infinity: a chain that loses everything has no annual rate', () => {
    const nws = [100000, 90000, 80000, 70000, 60000, 50000, 0]
    const g = computeGrowthBeyondSavings(nws.map((nw, i) => cap(month(i), nw)), nws.slice(1).map((_, i) => flow(month(i + 1), 1000, 1000)))
    expect(g.months).toHaveLength(6)
    expect(g.annualRate).toBeNull()
    const numbers = [g.growthTotal, g.startNetWorth, g.endNetWorth, g.savingsTotal, ...g.months.flatMap(m => Object.values(m))]
      .filter((v): v is number => typeof v === 'number')
    for (const v of numbers) expect(Number.isFinite(v)).toBe(true)
  })

})
