import { describe, expect, it } from 'vitest'
import { cashflowPeriodView, periodFlows, periodMembers } from '../../src/domain/cashflowPeriod'
import { incomeFlow, type FlowNode, type IncomeFlow } from '../../src/domain/incomeFlow'
import type { CategorisedMonth } from '../../src/domain/spending'
import type { CashflowRowBase, CategoryKind, FlowExtra } from '../../src/domain/types'
import { demoFamilyData } from '../helpers/demoFamily'

/** One month of a hand-built family in USD: one account, one loan, categories as given */
interface Month {
  month: string; active: number; passive?: number; expense: number; loan?: number; principal?: number; invested?: number
  cats?: [string, CategoryKind, number][]; incomeCats?: [string, number][]; newLoans?: string[]; member?: string
}

let ids = 0
const idOf = new Map<string, number>()
const catId = (name: string) => idOf.get(name) ?? (idOf.set(name, ++ids), ids)

function setup(months: Month[]) {
  const rows: CashflowRowBase[] = months.flatMap(m => [
    { month: m.month, bank: 'Lumiora', member: m.member ?? 'Robin', currency: 'USD', active: m.active, passive: m.passive ?? 0, expense: m.expense, activeBase: m.active, passiveBase: m.passive ?? 0, expenseBase: m.expense },
    ...(m.loan ? [{ month: m.month, bank: 'Home', member: 'Robin', currency: 'USD', loan: true as const, active: 0, passive: 0, expense: m.loan, activeBase: 0, passiveBase: 0, expenseBase: m.loan }] : []),
  ])
  const list = months.map(m => m.month)
  const view = { months: list, flows: periodFlows(rows, list), members: periodMembers(rows, list) }
  const extras: FlowExtra[] = months.map(m => ({
    month: m.month, invested: m.invested ?? 0, newLoans: m.newLoans ?? [],
    loans: m.loan ? [{ name: 'Home', payment: m.loan, principal: m.principal ?? 0, interest: m.loan - (m.principal ?? 0) }] : [],
  }))
  const month = (m: Month, flow: 'expense' | 'active', cats: [string, CategoryKind, number][], totalBase: number): CategorisedMonth => {
    const categories = cats.map(([name, kind, amountBase]) => ({ categoryId: catId(name), name, kind, flow, oneOff: false, amountBase }))
    const allocatedBase = cats.reduce((n, c) => n + c[2], 0)
    return { month: m.month, categories, allocatedBase, totalBase, unallocatedBase: Math.max(0, totalBase - allocatedBase), coveragePct: 0 }
  }
  const categorised = {
    spending: months.filter(m => m.cats).map(m => month(m, 'expense', m.cats!, m.expense + (m.loan ?? 0))),
    income: months.filter(m => m.incomeCats).map(m => month(m, 'active', m.incomeCats!.map(([n, a]) => [n, 'optional', a]), m.active + (m.passive ?? 0))),
  }
  return { view, extras, categorised }
}

const run = (months: Month[], side: 'source' | 'person' = 'source') => {
  const { view, extras, categorised } = setup(months)
  return incomeFlow(view, extras, categorised, side)
}
const ok = (f: IncomeFlow) => {
  if ('problem' in f) throw new Error(`a problem: ${f.problem}`)
  return f
}
const brief = (nodes: FlowNode[] | undefined): unknown[] | undefined => nodes?.map(n => [n.key, n.amount, ...(n.children ? [brief(n.children)] : [])])
const sum = (nodes: FlowNode[]) => Math.round(nodes.reduce((a, n) => a + n.amount, 0) * 100) / 100

// January and February: 10,200 earned (200 of it not split), 7,500 spent of which 2,000 loan payments (602 principal)
const JAN: Month = {
  month: '2026-01', active: 5000, expense: 3000, loan: 1000, principal: 300, invested: 500,
  cats: [['Groceries', 'mandatory', 800], ['Housing', 'mandatory', 1200], ['Cafes', 'optional', 400], ['Loan payments', 'loan_payment', 1000], ['Stamps', 'optional', 20], ['Books', 'optional', 30]],
  incomeCats: [['Salary', 5000]],
}
const FEB: Month = {
  month: '2026-02', active: 5000, passive: 200, expense: 2500, loan: 1000, principal: 302,
  cats: [['Groceries', 'mandatory', 700], ['Housing', 'mandatory', 1200], ['Cafes', 'optional', 300]],
  incomeCats: [['Salary', 5000]],
}

describe('incomeFlow', () => {
  it('splits the income into saved (stayed, paid down, invested), the groups, interest and the unsplit rest', () => {
    const f = ok(run([JAN, FEB]))
    expect(brief(f.left)).toEqual([['source:' + catId('Salary'), 10000], ['notSplitSource', 200]])
    expect(brief(f.right)).toEqual([
      ['saved', 3302, [['stayed', 2200], ['paidDown', 602], ['invested', 500]]],
      ['mandatory', 3900, [['category:' + catId('Housing'), 2400], ['category:' + catId('Groceries'), 1500]]],
      ['interest', 1398, [['loan:Home', 1398]]],
      ['optional', 750, [['category:' + catId('Cafes'), 700], ['other:optional', 50]]],
      ['notSplit', 850],
    ])
    expect(f).toMatchObject({ total: 10200, income: 10200, net: 2700, saved: 3302, inflows: false })
    expect(sum(f.left)).toBe(sum(f.right))
  })

  it('gives shares in percent of the left total', () => {
    const f = ok(run([JAN, FEB]))
    expect(f.right.find(n => n.key === 'mandatory')!.share).toBeCloseTo(38.235, 2)
    expect(f.left[0]!.share).toBeCloseTo(98.039, 2)
  })

  it('folds the categories under 2% of the left total into other, listing them', () => {
    const other = ok(run([JAN, FEB])).right.find(n => n.key === 'optional')!.children!.find(n => n.kind === 'other')!
    expect(other.folded!.map(n => [n.name, n.amount])).toEqual([['Books', 30], ['Stamps', 20]])
  })

  it('stayed below zero moves left as taken from accounts; shares use the left total', () => {
    const f = ok(run([{ ...JAN, invested: 3000 }, FEB]))
    expect(brief(f.left)!).toContainEqual(['takenFromAccounts', 300])
    expect(f.right[0]).toMatchObject({ key: 'saved', amount: 3602 })
    expect(f.right[0]!.children!.map(n => n.key)).toEqual(['paidDown', 'invested'])
    expect(f).toMatchObject({ total: 10500, inflows: true })
    expect(sum(f.left)).toBe(sum(f.right))
  })

  it('net below zero moves left as taken from savings; saved holds only the principal', () => {
    const f = ok(run([{ ...JAN, expense: 9000, cats: undefined, invested: 0 }]))
    // 5,000 earned, 10,000 spent (1,000 of it the loan, 300 principal)
    expect(brief(f.left)!).toContainEqual(['takenFromSavings', 5000])
    expect(brief(f.right)!.slice(0, 1)).toEqual([['saved', 300, [['paidDown', 300]]]])
    expect(f).toMatchObject({ net: -5000, saved: -4700, total: 10000 })
    expect(sum(f.left)).toBe(sum(f.right))
  })

  it('an overspent month with deposits takes the overspending from savings and the deposits from accounts', () => {
    const f = ok(run([{ ...JAN, expense: 5100, cats: undefined, invested: 400 }]))
    expect(brief(f.left)!.slice(-2)).toEqual([['takenFromSavings', 1100], ['takenFromAccounts', 400]])
    expect(sum(f.left)).toBe(sum(f.right))
  })

  it('invested below zero moves left as taken from investments', () => {
    const f = ok(run([{ ...JAN, invested: -600 }]))
    expect(brief(f.left)!).toContainEqual(['takenFromInvestments', 600])
    expect(f.right[0]!.children!.map(n => n.key)).toEqual(['stayed', 'paidDown'])
    expect(sum(f.left)).toBe(sum(f.right))
  })

  it('a month without category lines: no mandatory or optional, not split carries the spending', () => {
    const f = ok(run([{ ...FEB, cats: undefined }]))
    expect(f.right.map(n => n.key)).toEqual(['saved', 'interest', 'notSplit'])
    expect(f.right.at(-1)!.amount).toBe(2500)
  })

  it('a free-source loan_payment line without a loan row lands in not split, and the picture balances', () => {
    const f = ok(run([{ ...JAN, loan: undefined, principal: undefined, expense: 4000 }]))
    expect(f.right.find(n => n.key === 'interest')).toBeUndefined()
    expect(f.right.at(-1)).toMatchObject({ key: 'notSplit', amount: 1550 })
    expect(sum(f.left)).toBe(sum(f.right))
  })

  it('expense lines above the month’s spending give linesExceed with the month', () => {
    // the account's 1,000 fully split, the loan 500, and 400 of cash categories on top
    const over: Month = { month: '2026-03', active: 3000, expense: 1000, loan: 500, principal: 100, cats: [['Groceries', 'mandatory', 1000], ['Cafes', 'optional', 400]] }
    expect(run([FEB, over])).toEqual({ problem: 'linesExceed', month: '2026-03' })
  })

  it('income lines above the income give linesExceed too', () => {
    expect(run([{ ...FEB, incomeCats: [['Salary', 6000]] }])).toEqual({ problem: 'linesExceed', month: '2026-02' })
  })

  it('a missing rate in the flows, an extra or a category gives noRate', () => {
    const { view, extras, categorised } = setup([JAN, FEB])
    expect(incomeFlow({ ...view, flows: null }, extras, categorised, 'source')).toEqual({ problem: 'noRate' })
    expect(incomeFlow(view, [extras[0]!, { month: '2026-02', noRate: true }], categorised, 'source')).toEqual({ problem: 'noRate' })
    expect(incomeFlow(view, extras.slice(0, 1), categorised, 'source')).toEqual({ problem: 'noRate' })
    const rateless = { ...categorised, spending: [{ ...categorised.spending[0]!, categories: [{ ...categorised.spending[0]!.categories[0]!, amountBase: null }] }] }
    expect(incomeFlow(view, extras, rateless, 'source')).toEqual({ problem: 'noRate' })
  })

  it('by person puts the members on the left and keeps the right', () => {
    const bySource = ok(run([JAN, { ...FEB, member: 'Alex' }]))
    const byPerson = ok(run([JAN, { ...FEB, member: 'Alex' }], 'person'))
    expect(brief(byPerson.left)).toEqual([['person:Alex', 5200], ['person:Robin', 5000]])
    expect(byPerson.left.map(n => n.name)).toEqual(['Alex', 'Robin'])
    expect(byPerson.right).toEqual(bySource.right)
  })

  it('lists the loans opened in the period', () => {
    expect(ok(run([{ ...JAN, newLoans: ['Car'] }, FEB])).newLoans).toEqual(['Car'])
  })
})

const { snapshot } = await demoFamilyData()

describe('the English demo family’s year (October 2025 – September 2026)', () => {
  const view = cashflowPeriodView(snapshot, 'year', null)!
  const f = ok(incomeFlow(view, snapshot.flowExtras ?? [], { spending: snapshot.spending.months, income: snapshot.income.months }, 'source'))

  it('earned 175,049.95; saved 41,945.11 = 26,660.89 stayed + 11,084.22 paid down + 4,200 invested', () => {
    expect(f).toMatchObject({ total: 175049.95, income: 175049.95, net: 30860.89, saved: 41945.11, inflows: false })
    expect(brief(f.right)![0]).toEqual(['saved', 41945.11, [['stayed', 26660.89], ['paidDown', 11084.22], ['invested', 4200]]])
  })

  it('mandatory 52,890, interest 25,693.14, optional 38,600, not split 15,921.70', () => {
    expect(f.right.map(n => [n.key, n.amount])).toEqual([['saved', 41945.11], ['mandatory', 52890], ['interest', 25693.14], ['optional', 38600], ['notSplit', 15921.7]])
  })
})

describe('incomeFlow: negative income', () => {
  it('a negative source gives { problem: negativeIncome } rather than a picture that would not balance', () => {
    const { view, extras, categorised } = setup([{ month: '2026-04', active: 1000, expense: 600, incomeCats: [['Salary', 1100], ['Refund', -100]] }])
    expect(incomeFlow(view, extras, categorised, 'source')).toEqual({ problem: 'negativeIncome' })
  })

  it('a member with negative income does the same by person', () => {
    const { view, extras, categorised } = setup([{ month: '2026-04', active: 1000, expense: 600 }, { month: '2026-05', active: -100, expense: 0, member: 'Alex' }])
    expect(incomeFlow(view, extras, categorised, 'person')).toEqual({ problem: 'negativeIncome' })
  })
})

describe('incomeFlow: no cent residue reaches a folded Other', () => {
  it('categories a cent above a month’s expenses are linesExceed, the only way a residue could arise', () => {
    // fifty categories under 2% of 100 fold into one Other; one cent more than the expenses is refused, not absorbed
    const cats: [string, CategoryKind, number][] = Array.from({ length: 50 }, (_, i) => [`C${i}`, 'optional', i === 0 ? 1.91 : 1.9])
    expect(run([{ month: '2026-06', active: 100, expense: 95, cats }])).toEqual({ problem: 'linesExceed', month: '2026-06' })
  })
})
