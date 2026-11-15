import { ASSET_PERIODS } from './types'
// What the assets changed by over a period, holding by holding: the Assets page's numbers.
import { accountKey } from './accounts'
import { monthOf } from './dates'
import { round2 } from './fx'
import type { AssetPeriod, CapitalSnapshot, FinanceSnapshot, MsgParams } from './types'


export interface HoldingChange {
  kind: 'account' | 'realEstate'; name: string; member: string
  type: 'bank' | 'broker' | 'other' | 'real_estate'; currency: string
  /** At the period's end in its own currency and in the base one; 0 for a holding closed during the period */
  value: number; valueBase: number
  /** At the period's start in the base currency; 0 for a holding opened during it */
  startBase: number; change: number; changePct: number | null
  /** The own-currency amount did not move: the whole change is the rate */
  currencyOnly: boolean; opened: boolean; closed: boolean
  missingEnd: boolean; valueKnown: boolean; changeKnown: boolean
  /** No rate at the end: both bases and the change are 0, so it counts in no total, group or finding */
  noRate: boolean
  /** No rate at the start only: it counts like an opened holding (start 0, the change its whole end value), not in the finding */
  startNoRate: boolean
}
export type GroupBy = 'type' | 'member' | 'currency'
export interface AssetChanges {
  period: AssetPeriod; startMonth: string
  /** The start capital's date, 'YYYY-MM-DD' */
  startDate: string
  startTotal: number; endTotal: number; change: number; changePct: number | null
  startComplete: boolean; endComplete: boolean; complete: boolean
  /** Largest gain first */
  holdings: HoldingChange[]
  /** `count` — holdings held at the end; largest value first */
  groups: Record<GroupBy, { key: string; valueBase: number; change: number; count: number; valueKnown: boolean; changeKnown: boolean }[]>
  /** One sentence on the largest gain and loss of the holdings held at both ends with a rate (a transfer is no gain): a `pages.assets.*` key, `…Fx` when the loss is the rate alone */
  finding: { key: string; params: MsgParams } | null
}

interface Holding { kind: HoldingChange['kind']; name: string; member: string; type: HoldingChange['type']; currency: string; value: number; valueBase: number | null }

function holdingsOf(c: CapitalSnapshot): Map<string, Holding> {
  const list: Holding[] = [
    // shortcut: crypto counts as `other`, the page has no colour of its own for it; give it a type when it gets one
    ...c.accounts.map(a => ({ kind: 'account' as const, name: a.name, member: a.member, type: a.class === 'crypto' ? 'other' as const : a.class, currency: a.currency, value: a.value, valueBase: a.valueBase })),
    ...c.realEstate.map(r => ({ kind: 'realEstate' as const, name: r.name, member: r.member, type: 'real_estate' as const, currency: r.currency, value: r.value, valueBase: r.valueBase })),
  ]
  return new Map(list.map(h => [h.kind + accountKey(h.name, h.member), h]))
}

const pct = (change: number, start: number) => (start ? round2((change / Math.abs(start)) * 100) : null)
const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0))

/** The holdings of one capital with no change: the map when no period has a start */
export function currentHoldings(c: CapitalSnapshot, snapshot?: FinanceSnapshot): HoldingChange[] {
  const rows: HoldingChange[] = [...holdingsOf(c).values()].map(h => {
    const valueBase = round2(h.valueBase ?? 0)
    return { ...h, valueBase, startBase: valueBase, change: 0, changePct: null, currencyOnly: false, opened: false, closed: false, missingEnd: false, valueKnown: h.valueBase !== null, changeKnown: false, noRate: h.valueBase === null, startNoRate: false }
  })
  for (const a of snapshot?.capitalCoverage?.find(cov => cov.month === monthOf(c.date))?.missingAccounts ?? []) {
    if (!rows.some(h => h.kind === 'account' && h.name === a.name && h.member === a.member)) rows.push({
      kind: 'account', name: a.name, member: a.member, type: a.class === 'crypto' ? 'other' : a.class, currency: a.currency,
      value: 0, valueBase: 0, startBase: 0, change: 0, changePct: null, currencyOnly: false, opened: false, closed: false,
      missingEnd: true, valueKnown: false, changeKnown: false, noRate: false, startNoRate: false,
    })
  }
  return rows.sort((a, b) => b.valueBase - a.valueBase)
}

/** The holdings by type, member and currency: `count` — held at the end; largest value first */
export function holdingGroups(holdings: HoldingChange[], scopeKnown = true, changeScopeKnown = scopeKnown): AssetChanges['groups'] {
  const group = (by: GroupBy) => [...new Set(holdings.map(h => h[by]))].map(key => {
    const of = holdings.filter(h => h[by] === key)
    return { key, valueBase: sum(of.map(h => h.valueBase)), change: sum(of.map(h => h.change)), count: of.filter(h => !h.closed).length, valueKnown: scopeKnown && of.every(h => h.valueKnown), changeKnown: changeScopeKnown && of.every(h => h.changeKnown) }
  }).sort((a, b) => b.valueBase - a.valueBase)
  return { type: group('type'), member: group('member'), currency: group('currency') }
}

/** The periods whose start capital exists */
export function availablePeriods(snapshot: FinanceSnapshot): AssetPeriod[] {
  return snapshot.capital ? ASSET_PERIODS.filter(p => startOf(snapshot, p)) : []
}

// the month's start is `previousCapital`: the snapshot does not carry it twice
const startOf = (snapshot: FinanceSnapshot, period: AssetPeriod) =>
  (period === 'month' ? snapshot.previousCapital : snapshot.capitalBack?.[period]) ?? null

export function assetChanges(snapshot: FinanceSnapshot, period: AssetPeriod): AssetChanges | null {
  const startCapital = startOf(snapshot, period)
  if (!snapshot.capital || !startCapital) return null
  const end = holdingsOf(snapshot.capital)
  const start = holdingsOf(startCapital)

  const startMonth = monthOf(startCapital.date), endMonth = monthOf(snapshot.capital.date)
  const coverage = (month: string) => snapshot.capitalCoverage?.find(c => c.month === month)
  const missing = coverage(endMonth)?.missingAccounts ?? []
  for (const a of missing) {
    const key = 'account' + accountKey(a.name, a.member)
    if (!start.has(key) && !end.has(key)) start.set(key, { kind: 'account', name: a.name, member: a.member, type: a.class === 'crypto' ? 'other' : a.class, currency: a.currency, value: 0, valueBase: 0 })
  }
  const holdings: HoldingChange[] = [...new Set([...start.keys(), ...end.keys()])].flatMap(k => {
    const e = end.get(k), s = start.get(k)
    const h = (e ?? s)!
    const evidence = h.kind === 'account' ? snapshot.accountLifecycle.find(a => a.name === h.name && a.member === h.member) : undefined
    const closure = evidence?.closedMonth
    const supported = !!closure && closure > startMonth && closure <= endMonth && evidence.lastObservedMonth <= closure && (!e || e.value === 0)
    if (!e && s?.value === 0 && closure && closure <= startMonth && evidence.lastObservedMonth <= closure) return []
    const missingEnd = !e && !supported
    const opened = !s && !!e && evidence !== undefined && evidence.firstObservedMonth > startMonth
    const startKnown = s ? s.valueBase !== null : opened
    const noRate = e?.valueBase === null
    // a start without a rate counts like an opened holding, so the start total and the changes still add up to the end
    const startNoRate = !noRate && s?.valueBase === null
    const valueBase = noRate ? 0 : round2(e?.valueBase ?? 0), startBase = noRate || startNoRate ? 0 : round2(s?.valueBase ?? 0)
    const change = noRate ? 0 : round2(valueBase - startBase)
    const valueKnown = !missingEnd && !noRate
    return [{
      kind: h.kind, name: h.name, member: h.member, type: h.type, currency: h.currency,
      value: e?.value ?? 0, valueBase, startBase, change, changePct: pct(change, startBase),
      currencyOnly: !!e && !!s && change !== 0 && e.currency === s.currency && e.value === s.value,
      opened, closed: supported, missingEnd, valueKnown, changeKnown: valueKnown && startKnown, noRate, startNoRate,
    }]
  }).sort((a, b) => b.change - a.change)

  // the totals are the sums of the rounded parts, so the parts always add up to them
  const startTotal = sum(holdings.map(h => h.startBase))
  const change = sum(holdings.map(h => h.change))
  const startComplete = coverage(startMonth)?.assetsKnown === true && [...start.values()].every(h => h.valueBase !== null)
  const endComplete = coverage(endMonth)?.assetsKnown === true && holdings.every(h => h.valueKnown)
  const complete = startComplete && endComplete && holdings.every(h => h.changeKnown)
  return {
    startComplete, endComplete, complete,
    period, startMonth: monthOf(startCapital.date), startDate: startCapital.date,
    startTotal, endTotal: sum(holdings.map(h => h.valueBase)), change, changePct: pct(change, startTotal),
    holdings,
    groups: holdingGroups(holdings, !!coverage(endMonth), coverage(endMonth)?.assetsKnown === true && coverage(startMonth)?.assetsKnown === true),
    finding: complete ? findingOf(holdings) : null,
  }
}

function findingOf(holdings: HoldingChange[]): AssetChanges['finding'] {
  // holdings come sorted by change, so the first and the last kept are the largest gain and loss
  const held = holdings.filter(h => !h.opened && !h.closed && !h.noRate && !h.startNoRate)
  const first = held.at(0), last = held.at(-1)
  const gainer = first && first.change > 0 ? first : null
  const loser = last && last.change < 0 ? last : null
  const gain = gainer && { gainer: gainer.name, gainerMember: gainer.member, gain: gainer.change }
  const loss = loser && { loser: loser.name, loserMember: loser.member, loss: -loser.change }
  const fx = !!loser?.currencyOnly
  if (gain && loss) return { key: fx ? 'pages.assets.findingFx' : 'pages.assets.finding', params: { ...gain, ...loss } }
  if (gain) return { key: 'pages.assets.findingGainOnly', params: gain }
  if (loss) return { key: fx ? 'pages.assets.findingLossOnlyFx' : 'pages.assets.findingLossOnly', params: loss }
  return { key: 'pages.assets.findingFlat', params: {} }
}

/** Months whose source completeness cannot support history presentation. */
export function assetHistoryView(snapshot: FinanceSnapshot): { unavailableAssets: string[]; unavailableCapital: string[] } {
  return {
    unavailableAssets: snapshot.history.map(h => monthOf(h.date)).filter(m => snapshot.capitalCoverage?.find(c => c.month === m)?.assetsKnown !== true),
    unavailableCapital: snapshot.history.map(h => monthOf(h.date)).filter(m => snapshot.capitalCoverage?.find(c => c.month === m)?.capitalKnown !== true),
  }
}
