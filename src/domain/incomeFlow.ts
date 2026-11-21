// Where a period's income went: the balanced picture of "Where the income went" (docs/finance-rules.md). The left side is
// the income by source or by person, plus what was taken from accounts, savings or investments when a part of the right
// side would be negative; the right side is what was saved (stayed on accounts, paid down debt, invested), the spending
// groups, loan interest and what is not split by category. Moves inside net worth (early repayments, purchases, sales,
// new loans) are not in it. Both sides sum to the same total, to the cent.
import type { CashflowPeriodView } from './cashflowPeriod'
import { round2 } from './fx'
import type { CategorisedMonth } from './spending'
import type { FlowExtra } from './types'

export type FlowSide = 'source' | 'person'
export type FlowKind = 'source' | 'person' | 'notSplitSource' | 'takenFromAccounts' | 'takenFromSavings' | 'takenFromInvestments'
  | 'saved' | 'stayed' | 'paidDown' | 'invested' | 'mandatory' | 'optional' | 'category' | 'other' | 'interest' | 'loan' | 'notSplit'

export interface FlowNode {
  key: string
  kind: FlowKind
  /** A source's, a person's, a category's or a loan's own name; null for the fixed nodes ('' — a holding without an owner) */
  name: string | null
  amount: number
  /** Percent of the left side's total */
  share: number
  categoryId?: number
  /** saved: stayed, paid down, invested; a group: its categories, largest first, and one `other`; interest: per loan */
  children?: FlowNode[]
  /** other: the categories under FOLD_PCT of the left total it stands for */
  folded?: FlowNode[]
}

export type IncomeFlow =
  | { left: FlowNode[]; right: FlowNode[]; total: number; income: number; net: number; saved: number; inflows: boolean; newLoans: string[] }
  | { problem: 'noRate' }
  | { problem: 'linesExceed'; month: string }
  /** A source or a person with negative income in the period: the left side cannot draw it */
  | { problem: 'negativeIncome' }

/** A category below this share of the left total is folded into its group's "Other" on the chart */
const FOLD_PCT = 2
/** How far a figure may run below zero before it is a problem: the cent of rounding */
const TOLERANCE = 0.01
/** How far a month's lines may exceed its total: each line converted and rounded alone may add half a cent */
const linesTolerance = (lines: number) => TOLERANCE + 0.005 * lines

type Leaf = { key: string; kind: FlowKind; name: string | null; amount: number; categoryId?: number; children?: Leaf[]; folded?: Leaf[] }

const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0))
const byAmount = (a: Leaf, b: Leaf) => b.amount - a.amount

/** Category totals over the months, by id, largest first; null — a line has no rate */
function categoryTotals(months: CategorisedMonth[], keep: (kind: string) => boolean): { group: string; leaf: Leaf }[] | null {
  const totals = new Map<number, { group: string; leaf: Leaf }>()
  for (const m of months) {
    for (const c of m.categories) {
      if (!keep(c.kind)) continue
      if (c.amountBase === null) return null
      const t = totals.get(c.categoryId) ?? { group: c.kind, leaf: { key: `category:${c.categoryId}`, kind: 'category', name: c.name, amount: 0, categoryId: c.categoryId } }
      t.leaf.amount += c.amountBase
      totals.set(c.categoryId, t)
    }
  }
  for (const t of totals.values()) t.leaf.amount = round2(t.leaf.amount)
  return [...totals.values()]
}

export function incomeFlow(
  view: Pick<CashflowPeriodView, 'months' | 'flows' | 'members'>,
  extras: FlowExtra[],
  categorised: { spending: CategorisedMonth[]; income: CategorisedMonth[] },
  side: FlowSide,
): IncomeFlow {
  const { flows, months } = view
  if (!flows) return { problem: 'noRate' }
  const known = []
  for (const month of months) {
    const extra = extras.find(e => e.month === month)
    if (!extra || 'noRate' in extra) return { problem: 'noRate' }
    known.push(extra)
  }
  const inPeriod = (list: CategorisedMonth[]) => list.filter(m => months.includes(m.month) && m.categories.length > 0)
  const spendingMonths = inPeriod(categorised.spending)
  const incomeMonths = inPeriod(categorised.income)
  if ([...spendingMonths, ...incomeMonths].some(m => m.categories.some(c => c.amountBase === null))) return { problem: 'noRate' }

  // a month whose lines are more than its total cannot be drawn: its split is named to be fixed
  for (const month of months) {
    const s = spendingMonths.find(m => m.month === month)
    const payments = sum(known.find(e => e.month === month)!.loans.map(l => l.payment))
    const nonLoan = sum((s?.categories ?? []).filter(c => c.kind !== 'loan_payment').map(c => c.amountBase!))
    if (s && s.totalBase !== null && s.totalBase - payments - nonLoan < -linesTolerance(s.categories.length)) return { problem: 'linesExceed', month }
    const i = incomeMonths.find(m => m.month === month)
    if (i && i.totalBase !== null && sum(i.categories.map(c => c.amountBase!)) - i.totalBase > linesTolerance(i.categories.length)) return { problem: 'linesExceed', month }
  }

  const loans = new Map<string, { principal: number; interest: number; payment: number }>()
  for (const l of known.flatMap(e => e.loans)) {
    const t = loans.get(l.name) ?? { principal: 0, interest: 0, payment: 0 }
    loans.set(l.name, { principal: t.principal + l.principal, interest: t.interest + l.interest, payment: t.payment + l.payment })
  }
  const principal = sum([...loans.values()].map(l => l.principal))
  const payments = sum([...loans.values()].map(l => l.payment))
  const investedRaw = sum(known.map(e => e.invested))
  const net = round2(flows.net)
  const stayedRaw = round2(net - investedRaw)

  // Right: every part at zero or above; what would be negative comes in on the left
  const invested = Math.max(0, investedRaw)
  const stayed = Math.max(0, stayedRaw)
  const inflowTotal = round2(invested + stayed - net)
  const fromInvestments = Math.max(0, -investedRaw)
  const fromSavings = Math.min(round2(inflowTotal - fromInvestments), Math.max(0, -net))
  const fromAccounts = round2(inflowTotal - fromInvestments - fromSavings)

  // a rateless line returned noRate above
  const spending = categoryTotals(spendingMonths, kind => kind !== 'loan_payment')!
  const groupOf = (group: 'mandatory' | 'optional') => spending.filter(c => c.group === group).map(c => c.leaf).sort(byAmount)
  const mandatory = groupOf('mandatory'), optional = groupOf('optional')
  const notSplit = round2(flows.expense - payments - sum(mandatory.map(c => c.amount)) - sum(optional.map(c => c.amount)))

  // Left
  let left: Leaf[]
  if (side === 'person') {
    left = view.members.filter(m => round2(m.income ?? 0) !== 0)
      .map(m => ({ key: `person:${m.member}`, kind: 'person' as const, name: m.member, amount: round2(m.income ?? 0) })).sort(byAmount)
  } else {
    const sources = categoryTotals(incomeMonths, () => true)!.map(({ leaf }) => ({ ...leaf, key: `source:${leaf.categoryId}`, kind: 'source' as const })).sort(byAmount)
    left = [...sources, { key: 'notSplitSource', kind: 'notSplitSource' as const, name: null, amount: round2(flows.income - sum(sources.map(s => s.amount))) }]
  }
  const inflow = (kind: 'takenFromSavings' | 'takenFromAccounts' | 'takenFromInvestments', amount: number): Leaf => ({ key: kind, kind, name: null, amount })
  left.push(inflow('takenFromSavings', fromSavings), inflow('takenFromAccounts', fromAccounts), inflow('takenFromInvestments', fromInvestments))
  if (left.some(n => n.amount < -TOLERANCE)) return { problem: 'negativeIncome' }
  left = left.filter(n => n.amount > 0)
  const total = sum(left.map(n => n.amount))

  // a group's categories under FOLD_PCT of the left total become one "Other" when there are two or more of them
  const folded = (group: 'mandatory' | 'optional', cats: Leaf[]): Leaf[] => {
    const small = cats.filter(c => total > 0 && (c.amount / total) * 100 < FOLD_PCT)
    if (small.length < 2) return cats
    return [...cats.filter(c => !small.includes(c)), { key: `other:${group}`, kind: 'other' as const, name: null, amount: sum(small.map(c => c.amount)), folded: small }]
  }
  const parent = (key: 'saved' | 'mandatory' | 'optional' | 'interest', children: Leaf[]): Leaf =>
    ({ key, kind: key, name: null, amount: sum(children.map(c => c.amount)), children: children.filter(c => c.amount > 0) })
  const right: Leaf[] = [
    parent('saved', [
      { key: 'stayed', kind: 'stayed' as const, name: null, amount: stayed },
      { key: 'paidDown', kind: 'paidDown' as const, name: null, amount: principal },
      { key: 'invested', kind: 'invested' as const, name: null, amount: invested },
    ]),
    parent('mandatory', folded('mandatory', mandatory)),
    parent('interest', [...loans].map(([name, l]) => ({ key: `loan:${name}`, kind: 'loan' as const, name, amount: round2(l.interest) })).sort(byAmount)),
    parent('optional', folded('optional', optional)),
    { key: 'notSplit', kind: 'notSplit' as const, name: null, amount: Math.max(0, notSplit) },
  ].filter(n => n.amount > 0)

  // the sides agree but for rounding: the lines' (within linesTolerance) or a float's, which goes to the largest right node
  const residue = round2(total - sum(right.map(n => n.amount)))
  const [largest] = [...right].sort(byAmount)
  if (residue !== 0 && largest) {
    largest.amount = round2(largest.amount + residue)
    // a folded Other takes it with its largest category, so it keeps equalling the categories it lists
    const child = largest.children && [...largest.children].sort(byAmount)[0]
    if (child) child.amount = round2(child.amount + residue)
    const folded = child?.folded && [...child.folded].sort(byAmount)[0]
    if (folded) folded.amount = round2(folded.amount + residue)
  }

  const shared = ({ children, folded, ...n }: Leaf): FlowNode => ({
    ...n, share: total > 0 ? (n.amount / total) * 100 : 0,
    ...(children ? { children: children.map(shared) } : {}),
    ...(folded ? { folded: folded.map(shared) } : {}),
  })
  return {
    left: left.map(shared), right: right.map(shared), total, income: round2(flows.income), net, saved: round2(net + principal),
    inflows: left.some(n => n.kind.startsWith('takenFrom')), newLoans: [...new Set(known.flatMap(e => e.newLoans))],
  }
}
