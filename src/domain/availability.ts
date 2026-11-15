import { historicalBudget } from './financialAnalysis'
import { round2 } from './fx'
import type { AccountValue, FinanceSnapshot } from './types'

/** Monthly confirmation in the account's own currency; never carried forward implicitly. */
export interface AvailabilityAssessment {
  month: string; name: string; member: string; currency: string; balance: number
  available: boolean; reserve: number; goals: number; commitments: number
}

export function validAssessment(a: AvailabilityAssessment): boolean {
  const amounts = [a.reserve, a.goals, a.commitments]
  return Number.isFinite(a.balance) && a.balance >= 0 && amounts.every(x => Number.isFinite(x) && x >= 0)
    && amounts.reduce((sum, x) => sum + x, 0) <= a.balance + 1e-8
    && (a.available || amounts.every(x => x === 0))
}

export function aggregateAvailability(month: string | null, accounts: readonly AccountValue[], assessments: readonly AvailabilityAssessment[], complete = true) {
  let unknown = 0, stale = 0, blocked = !complete || month === null || accounts.length === 0
  const totals = { available: 0, reserve: 0, goals: 0, commitments: 0, free: 0 }
  const rows = accounts.map(account => {
    const matching = assessments.filter(a => a.name === account.name && a.member === account.member)
    const assessment = matching.find(a => a.month === month) ?? matching.toSorted((a, b) => b.month.localeCompare(a.month))[0]
    let status: 'confirmed' | 'unknown' | 'stale' | 'negative' | 'missingFx' | 'invalid' = 'confirmed'
    if (account.value < 0) status = 'negative'
    else if (!assessment) { status = 'unknown'; unknown++; blocked = true }
    else if (assessment.month !== month || assessment.currency !== account.currency || assessment.balance !== account.value) { status = 'stale'; stale++; blocked = true }
    else if (!validAssessment(assessment)) { status = 'invalid'; blocked = true }
    else if (account.valueBase === null) { status = 'missingFx'; blocked = true }
    else if (assessment.available) {
      const ratio = account.value === 0 ? 0 : account.valueBase / account.value
      totals.available += account.valueBase
      totals.reserve += assessment.reserve * ratio
      totals.goals += assessment.goals * ratio
      totals.commitments += assessment.commitments * ratio
    }
    return { account, assessment, status }
  })
  for (const key of ['available', 'reserve', 'goals', 'commitments'] as const) totals[key] = round2(totals[key])
  totals.free = round2(totals.available - totals.reserve - totals.goals - totals.commitments)
  return { available: blocked ? null : totals.available, reserve: blocked ? null : totals.reserve, goals: blocked ? null : totals.goals,
    commitments: blocked ? null : totals.commitments, free: blocked ? null : totals.free, unknown, stale, incomplete: !complete, accounts: rows }
}

/** The reserve's yardstick: `historicalBudget`'s expense when its three months end in the capital month. */
export function reserveSpendingBaseline(snapshot: FinanceSnapshot): { perMonth: number; months: string[] } | null {
  const budget = historicalBudget(snapshot)
  if (!budget || budget.months[2] !== snapshot.asOf.capitalDate?.slice(0, 7) || !(budget.expense > 0)) return null
  return { perMonth: budget.expense, months: budget.months }
}

type Aggregate = ReturnType<typeof aggregateAvailability>
export type AvailabilityPartKey = 'unavailable' | 'reserve' | 'goals' | 'commitments' | 'free'
export type AccountParts = { reserve: number; goals: number; commitments: number; setAside: number; free: number }

/** An available account's earmarks and the rest, in its own currency; null — unassessed or not available at once. */
export function accountParts(account: AccountValue, assessment: AvailabilityAssessment | undefined): AccountParts | null {
  if (!assessment?.available) return null
  const setAside = round2(assessment.reserve + assessment.goals + assessment.commitments)
  return { reserve: assessment.reserve, goals: assessment.goals, commitments: assessment.commitments, setAside, free: round2(account.value - setAside) }
}

/**
 * Where the money on the accounts sits, in the snapshot's currency: the five parts in drawing order, each with the
 * accounts holding a non-zero share of it; `total` is every non-negative account. Null while the totals are blocked.
 */
export function availabilityParts(aggregate: Aggregate): { total: number; available: number; availableShare: number; parts: { key: AvailabilityPartKey; amount: number; share: number; accounts: AccountValue[] }[] } | null {
  if (aggregate.free === null || aggregate.available === null) return null
  const holders = (share: (parts: AccountParts) => number) => aggregate.accounts
    .filter(({ account, assessment, status }) => status === 'confirmed' && share(accountParts(account, assessment) ?? { reserve: 0, goals: 0, commitments: 0, setAside: 0, free: 0 }) > 0)
    .map(({ account }) => account)
  const unavailable = aggregate.accounts.filter(({ assessment, status }) => status === 'confirmed' && !assessment.available).map(({ account }) => account)
  const unavailableAmount = round2(unavailable.reduce((sum, a) => sum + (a.valueBase ?? 0), 0))
  const total = round2(aggregate.available + unavailableAmount)
  const share = (amount: number) => total > 0 ? amount / total * 100 : 0
  const parts = [
    { key: 'unavailable' as const, amount: unavailableAmount, accounts: unavailable },
    { key: 'reserve' as const, amount: aggregate.reserve!, accounts: holders(p => p.reserve) },
    { key: 'goals' as const, amount: aggregate.goals!, accounts: holders(p => p.goals) },
    { key: 'commitments' as const, amount: aggregate.commitments!, accounts: holders(p => p.commitments) },
    { key: 'free' as const, amount: aggregate.free, accounts: holders(p => p.free) },
  ]
  return { total, available: aggregate.available, availableShare: share(aggregate.available), parts: parts.map(p => ({ ...p, share: share(p.amount) })) }
}

/** The month's confirmation so far: accounts to confirm (non-negative), the ones confirmed, and those still waiting, in list order. */
export function confirmationProgress(aggregate: Aggregate): { total: number; confirmed: number; accounts: { account: AccountValue; confirmed: boolean }[]; waiting: AccountValue[] } {
  const accounts = aggregate.accounts.filter(({ status }) => status !== 'negative').map(({ account, status }) => ({ account, confirmed: status === 'confirmed' || status === 'missingFx' }))
  return { total: accounts.length, confirmed: accounts.filter(a => a.confirmed).length, accounts, waiting: accounts.filter(a => !a.confirmed).map(a => a.account) }
}

/** The accounts card's order: the latest answer available at once first, then not available, then the rest (no answer, a negative balance); the given order within each group. */
export function cardOrder(aggregate: Aggregate): Aggregate {
  const rank = ({ account, assessment }: Aggregate['accounts'][number]) => account.value < 0 || !assessment ? 2 : assessment.available ? 0 : 1
  return { ...aggregate, accounts: aggregate.accounts.toSorted((a, b) => rank(a) - rank(b)) }
}
