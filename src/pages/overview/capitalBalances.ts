import { monthEnd, monthOf } from '../../domain/dates'
import { round2 } from '../../domain/fx'
import { partialCapitalMonths } from '../../domain/overviewBlocks'
import type { FinanceSnapshot, HistoryPoint } from '../../domain/types'

function sum(values: (number | null)[]) {
  return values.some(v => v === null) ? null : round2(values.reduce<number>((total, value) => total + (value ?? 0), 0))
}

export function overviewHistory(s: FinanceSnapshot, owner: string | null) {
  if (owner === null) return { history: s.history, partial: partialCapitalMonths(s) }
  const history: HistoryPoint[] = []
  const partial = new Set((s.capitalCoverage ?? []).filter(c => c.missingAccounts.some(a => a.member === owner)).map(c => c.month))
  for (const record of s.balanceHistory ?? []) {
    const mine = (r: { member: string }) => r.member === owner
    const holdings = [...record.accounts, ...record.realEstate].filter(mine)
    const debts = record.loans.filter(mine)
    if (!history.length && !holdings.length && !debts.length && !partial.has(record.month)) continue
    const assets = sum(holdings.map(r => r.valueBase))
    const liabilities = sum(debts.map(r => r.balanceBase))
    if (assets === null || liabilities === null) partial.add(record.month)
    // The chart model keeps a calendar slot for a partial endpoint, then masks the entire point.
    history.push({ date: monthEnd(record.month), assets: assets ?? 0, liabilities: liabilities ?? 0, netWorth: round2((assets ?? 0) - (liabilities ?? 0)) })
  }
  return { history, partial }
}

export function overviewComposition(s: FinanceSnapshot, owner: string | null) {
  const c = s.capital
  if (!c) return null
  const mine = (r: { member: string }) => owner === null || r.member === owner
  const missing = s.capitalCoverage?.find(row => row.month === monthOf(c.date))?.missingAccounts.filter(mine) ?? []
  const accounts = c.accounts.filter(mine)
  const byType = (type: 'cash' | 'investments' | 'other') => {
    const belongs = (r: { class: string }) => (r.class === 'bank' ? 'cash' : r.class === 'other' ? 'other' : 'investments') === type
    return missing.some(belongs) ? null : sum(accounts.filter(belongs).map(r => r.valueBase))
  }
  const parts = { cash: byType('cash'), investments: byType('investments'), property: sum(c.realEstate.filter(mine).map(r => r.valueBase)), other: byType('other') }
  return { parts, assets: sum(Object.values(parts)), debts: sum(c.loans.filter(mine).map(l => l.balanceBase)) }
}
