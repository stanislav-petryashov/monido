import { describe, expect, it } from 'vitest'
import { assetChanges, availablePeriods, currentHoldings } from '../../src/domain/assetChanges'
import type { CapitalSnapshot, FinanceSnapshot } from '../../src/domain/types'
import { makeSnapshot } from '../helpers/snapshot'

const end = makeSnapshot().capital!
const [lumiora, brisaluna] = end.accounts

/** A capital a month earlier: Lumiora's roubles the same at a better rate, Brisaluna smaller, the apartment cheaper */
const start = (over: Partial<CapitalSnapshot> = {}): CapitalSnapshot => ({
  ...end,
  date: '2031-05-31',
  accounts: [{ ...lumiora, valueBase: 16000.4 }, { ...brisaluna, value: 2500, valueBase: 2900.3 }],
  realEstate: [{ ...end.realEstate[0], value: 130000, valueBase: 130000 }],
  ...over,
})
const snap = (prev: CapitalSnapshot | null, back: FinanceSnapshot['capitalBack'] = {}, capital: FinanceSnapshot['capital'] = end) =>
  makeSnapshot({ capital, previousCapital: prev, capitalBack: back,
    capitalCoverage: [prev, capital, ...Object.values(back)].filter((c): c is CapitalSnapshot => !!c).map(c => ({ month: c.date.slice(0, 7), assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] })),
    accountLifecycle: [...new Map([...(prev?.accounts ?? []), ...(capital?.accounts ?? [])].map(a => [a.name + a.member, { name: a.name, member: a.member, firstObservedMonth: prev?.accounts.some(b => b.name === a.name && b.member === a.member) ? prev.date.slice(0, 7) : capital!.date.slice(0, 7), lastObservedMonth: capital?.accounts.some(b => b.name === a.name && b.member === a.member) ? capital.date.slice(0, 7) : prev!.date.slice(0, 7), closedMonth: null }])).values()],
  })

describe('assetChanges', () => {
  it('the holdings add up to the change and the groups add up the same', () => {
    const c = assetChanges(snap(start()), 'month')!
    expect(c.startMonth).toBe('2031-05')
    expect(c.change).toBe(Math.round((c.endTotal - c.startTotal) * 100) / 100)
    expect(c.holdings.reduce((a, h) => a + h.change, 0)).toBeCloseTo(c.change, 2)
    expect(c.groups.type.reduce((a, g) => a + g.change, 0)).toBeCloseTo(c.change, 2)
    expect(c.groups.type.find(g => g.key === 'real_estate')).toMatchObject({ key: 'real_estate', valueBase: 134000, change: 4000, count: 1, valueKnown: true, changeKnown: true })
    expect(c.holdings.map(h => h.name)).toEqual(['City apartment', 'Brisaluna Bank', 'Lumiora Bank'])
  })

  it('a holding opened during the period starts from 0, a closed one ends at 0 and is listed', () => {
    const gone = { ...lumiora, name: 'Old Bank', valueBase: 500 }
    const snapshot = snap(start({ accounts: [gone, { ...brisaluna }] }))
    snapshot.accountLifecycle!.find(a => a.name === 'Old Bank')!.closedMonth = '2031-06'
    const c = assetChanges(snapshot, 'month')!
    const opened = c.holdings.find(h => h.name === 'Lumiora Bank')!
    expect(opened).toMatchObject({ opened: true, closed: false, startBase: 0, change: lumiora.valueBase, changePct: null })
    expect(c.holdings.find(h => h.name === 'Old Bank')).toMatchObject({ closed: true, opened: false, value: 0, valueBase: 0, change: -500 })
    expect(c.groups.type.find(g => g.key === 'bank')!.count).toBe(2)
  })

  it('marks a move of the rate alone', () => {
    const c = assetChanges(snap(start()), 'month')!
    expect(c.holdings.find(h => h.name === 'Lumiora Bank')).toMatchObject({ currencyOnly: true, change: -252.4 })
    expect(c.holdings.find(h => h.name === 'Brisaluna Bank')!.currencyOnly).toBe(false)
  })

  it('has no percentage from a zero start', () => {
    const c = assetChanges(snap(null, { all: start({ accounts: [], realEstate: [] }) }), 'all')!
    expect(c.startTotal).toBe(0)
    expect(c.changePct).toBeNull()
  })

  it('names the largest gain and loss, the rate when the loss is the rate alone', () => {
    expect(assetChanges(snap(start()), 'month')!.finding).toEqual({
      key: 'pages.assets.findingFx',
      params: { gainer: 'City apartment', gainerMember: '', gain: 4000, loser: 'Lumiora Bank', loserMember: lumiora.member, loss: 252.4 },
    })
    const up = start({ accounts: [{ ...lumiora, valueBase: 15000 }, { ...brisaluna }] })
    expect(assetChanges(snap(up), 'month')!.finding)
      .toEqual({ key: 'pages.assets.findingGainOnly', params: { gainer: 'City apartment', gainerMember: '', gain: 4000 } })
    expect(assetChanges(snap({ ...end, date: '2031-05-31' }), 'month')!.finding)
      .toEqual({ key: 'pages.assets.findingFlat', params: {} })
    const down = start({ accounts: [{ ...lumiora }, { ...brisaluna, value: 4000, valueBase: 4000 }], realEstate: end.realEstate })
    expect(assetChanges(snap(down), 'month')!.finding)
      .toEqual({ key: 'pages.assets.findingLossOnly', params: { loser: 'Brisaluna Bank', loserMember: brisaluna.member, loss: 480 } })
  })

  it('a transfer is no gain: the finding skips opened and closed holdings', () => {
    // Lumiora is new (+15 748) and Old Bank gone (−500): the finding is between the holdings held throughout
    const snapshot = snap(start({ accounts: [{ ...lumiora, name: 'Old Bank', valueBase: 500 }, { ...brisaluna, value: 2500, valueBase: 2900.3 }] }))
    snapshot.accountLifecycle!.find(a => a.name === 'Old Bank')!.closedMonth = '2031-06'
    const c = assetChanges(snapshot, 'month')!
    expect(c.finding).toEqual({ key: 'pages.assets.findingGainOnly', params: { gainer: 'City apartment', gainerMember: '', gain: 4000 } })
  })

  it('the rate alone with nothing grown has its own key', () => {
    const c = assetChanges(snap(start({ accounts: [{ ...lumiora, valueBase: 16000.4 }, brisaluna], realEstate: end.realEstate })), 'month')!
    expect(c.finding?.key).toBe('pages.assets.findingLossOnlyFx')
  })

  it('a holding without a rate at the end counts nowhere', () => {
    const c = assetChanges(snap(start(), {}, { ...end, accounts: [{ ...lumiora, valueBase: null }, brisaluna] }), 'month')!
    expect(c.holdings.find(h => h.name === 'Lumiora Bank')).toMatchObject({ noRate: true, valueBase: 0, startBase: 0, change: 0 })
    expect(c.endTotal).toBe(brisaluna.valueBase! + 134000)
    expect(c.finding).toBeNull()
  })

  it('a holding whose start lacks a rate counts like an opened one, outside the finding', () => {
    const c = assetChanges(snap(start({ accounts: [{ ...lumiora, valueBase: null }, brisaluna] })), 'month')!
    const lumioraEnd = lumiora.valueBase!
    expect(c.holdings.find(h => h.name === 'Lumiora Bank')).toMatchObject({ noRate: false, startNoRate: true, valueBase: lumioraEnd, startBase: 0, change: lumioraEnd })
    expect(c.endTotal).toBeCloseTo(lumioraEnd + brisaluna.valueBase! + 134000, 2)
    expect(c.change).toBeCloseTo(c.endTotal - c.startTotal, 2)
    expect(c.finding).toBeNull()
  })

  it('takes the percentage over the start\'s magnitude', () => {
    const c = assetChanges(snap(start({ accounts: [{ ...lumiora, valueBase: -100 }, brisaluna], realEstate: end.realEstate }), {}, { ...end, accounts: [{ ...lumiora, valueBase: 50 }, brisaluna] }), 'month')!
    expect(c.holdings.find(h => h.name === 'Lumiora Bank')!.changePct).toBe(150)
  })

  it('offers only the periods with a start capital', () => {
    expect(availablePeriods(snap(start(), { quarter: null, year: start(), all: null }))).toEqual(['month', 'year'])
    expect(availablePeriods(snap(null, { quarter: start() }))).toEqual(['quarter'])
    expect(assetChanges(snap(null, { quarter: null }), 'quarter')).toBeNull()
    expect(assetChanges(snap(null), 'month')).toBeNull()
    expect(availablePeriods(snap(start(), {}, null))).toEqual([])
  })
})

describe('currentHoldings', () => {
  it('lists one capital with no change, a holding without a rate at 0', () => {
    const hs = currentHoldings({ ...end, accounts: [{ ...lumiora, valueBase: null }, brisaluna] })
    expect(hs.map(h => [h.name, h.valueBase, h.change, h.noRate])).toEqual([['City apartment', 134000, 0, false], ['Brisaluna Bank', 3520, 0, false], ['Lumiora Bank', 0, 0, true]])
  })
})

describe('incomplete asset evidence', () => {
  it('does not treat a missing end balance as a closure', () => {
    const old = { ...lumiora, name: 'account97', value: 1000000096, valueBase: 1000000096 }
    const august = start({ date: '2031-08-31', accounts: [old], realEstate: [] })
    const september = { ...end, date: '2031-09-30', accounts: [], realEstate: [] }
    const snapshot = makeSnapshot({ capital: september, previousCapital: august,
      accountLifecycle: [{ name: old.name, member: old.member, firstObservedMonth: '2031-08', lastObservedMonth: '2031-08', closedMonth: null }],
      capitalCoverage: [
        { month: '2031-08', assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] },
        { month: '2031-09', assetsKnown: false, liquidKnown: false, capitalKnown: false, missingAccounts: [{ name: old.name, member: old.member, class: old.class, currency: old.currency, lastObservedMonth: '2031-08' }] },
      ],
    })
    const changes = assetChanges(snapshot, 'month')!
    expect(changes.holdings[0]).toMatchObject({ missingEnd: true, closed: false, valueKnown: false, changeKnown: false })
    expect(changes).toMatchObject({ endComplete: false, complete: false, finding: null })
  })
})

describe('lifecycle provenance', () => {
  const old = { ...lumiora, name: 'account97', value: 1000000096, valueBase: 1000000096 }
  const before = start({ date: '2031-08-31', accounts: [old], realEstate: [] })
  const after = { ...end, date: '2031-09-30', accounts: [], realEstate: [] }
  const fixture = (over: Partial<FinanceSnapshot> = {}) => makeSnapshot({ capital: after, previousCapital: before,
    capitalCoverage: [{ month: '2031-08', assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] }, { month: '2031-09', assetsKnown: false, liquidKnown: false, capitalKnown: false, missingAccounts: [{ name: old.name, member: old.member, class: old.class, currency: old.currency, lastObservedMonth: '2031-08' }] }],
    accountLifecycle: [{ name: old.name, member: old.member, firstObservedMonth: '2031-08', lastObservedMonth: '2031-08', closedMonth: null }], ...over })
  it('distinguishes observed zero and supported closure', () => {
    const zero = assetChanges(fixture({ capital: { ...after, accounts: [{ ...old, value: 0, valueBase: 0 }] } }), 'month')!.holdings[0]
    expect(zero).toMatchObject({ closed: false, missingEnd: false, value: 0, valueKnown: true })
    const s = fixture({ accountLifecycle: [{ name: old.name, member: old.member, firstObservedMonth: '2031-08', lastObservedMonth: '2031-08', closedMonth: '2031-09' }] })
    const actuallyClosed = assetChanges(s, 'month')!.holdings[0]
    expect(actuallyClosed).toMatchObject({ closed: true, missingEnd: false, value: 0, valueKnown: true, changeKnown: true })
  })
  it('closure followed by an observation becomes missing again', () => {
    const s = fixture({ accountLifecycle: [{ name: old.name, member: old.member, firstObservedMonth: '2031-07', lastObservedMonth: '2031-08', closedMonth: '2031-07' }] })
    expect(assetChanges(s, 'month')!.holdings[0]).toMatchObject({ closed: false, missingEnd: true })
  })
  it('owner identities do not share evidence', () => {
    const s = fixture({ accountLifecycle: [{ name: old.name, member: 'Other', firstObservedMonth: '2031-08', lastObservedMonth: '2031-08', closedMonth: '2031-09' }] })
    expect(assetChanges(s, 'month')!.holdings[0]).toMatchObject({ closed: false, missingEnd: true })
  })
  it('all period endpoints keep their own provenance', () => {
    const baseline = (date: string, value: number) => ({ ...before, date, accounts: [{ ...old, value, valueBase: value }] })
    const missing = { name: 'Other account', member: old.member, class: old.class, currency: old.currency, lastObservedMonth: '2030-12' }
    const s = fixture({
      previousCapital: baseline('2031-08-31', 100),
      capitalBack: { quarter: baseline('2031-06-30', 200), year: baseline('2030-12-31', 300), all: baseline('2029-01-31', 400) },
      capital: { ...after, accounts: [{ ...old, value: 150, valueBase: 150 }] },
      capitalCoverage: [
        { month: '2031-08', assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] },
        { month: '2031-06', assetsKnown: false, liquidKnown: false, capitalKnown: false, missingAccounts: [missing] },
        { month: '2030-12', assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] },
        { month: '2029-01', assetsKnown: false, liquidKnown: false, capitalKnown: false, missingAccounts: [missing] },
        { month: '2031-09', assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] },
      ],
    })
    expect(availablePeriods(s)).toEqual(['month', 'quarter', 'year', 'all'])
    for (const [period, startMonth, startTotal, change, startComplete] of [
      ['month', '2031-08', 100, 50, true], ['quarter', '2031-06', 200, -50, false],
      ['year', '2030-12', 300, -150, true], ['all', '2029-01', 400, -250, false],
    ] as const) {
      const result = assetChanges(s, period)!
      expect(result).toMatchObject({ startMonth, startTotal, endTotal: 150, change, startComplete, endComplete: true, complete: startComplete })
      if (!startComplete) expect(result.finding).toBeNull()
    }
  })
  it('unknown start or end FX does not become a categorical change', () => {
    const noStart = fixture({ previousCapital: { ...before, accounts: [{ ...old, valueBase: null }] }, capital: { ...after, accounts: [old] } })
    const noEnd = fixture({ capital: { ...after, accounts: [{ ...old, valueBase: null }] } })
    for (const s of [noStart, noEnd]) expect(assetChanges(s, 'month')).toMatchObject({ complete: false, finding: null })
  })
  it('incomplete group and history facts are not complete totals', async () => {
    const { assetHistoryView } = await import('../../src/domain/assetChanges')
    const s = fixture({ history: [{ date: '2031-08-31', assets: 100, liabilities: 0, netWorth: 100 }, { date: '2031-09-30', assets: 0, liabilities: 0, netWorth: 0 }] })
    expect(assetChanges(s, 'month')!.groups.type[0]).toMatchObject({ valueKnown: false, changeKnown: false })
    expect(assetHistoryView(s)).toEqual({ unavailableAssets: ['2031-09'], unavailableCapital: ['2031-09'] })
  })
})

it('honors closure boundaries and does not promote old observations to new positions', () => {
  const old = { ...lumiora, name: 'Boundary', value: 0, valueBase: 0 }
  const a = start({ date: '2031-08-31', accounts: [old], realEstate: [] })
  const b = { ...end, date: '2031-09-30', accounts: [], realEstate: [] }
  const lifecycle = { name: old.name, member: old.member, firstObservedMonth: '2031-07', lastObservedMonth: '2031-08', closedMonth: '2031-08' }
  const fixture = makeSnapshot({ capital: b, previousCapital: a, accountLifecycle: [lifecycle] })
  expect(assetChanges(fixture, 'month')!.holdings).toHaveLength(0)
  expect(assetChanges({ ...fixture, previousCapital: { ...a, accounts: [{ ...old, value: 1, valueBase: 1 }] } }, 'month')!.holdings[0]).toMatchObject({ missingEnd: true, closed: false })
  expect(assetChanges({ ...fixture, previousCapital: { ...a, accounts: [] }, capital: { ...b, accounts: [{ ...old, value: 1, valueBase: 1 }] } }, 'month')!.holdings[0]).toMatchObject({ opened: false, changeKnown: false })
  expect(assetChanges({ ...fixture, previousCapital: { ...a, accounts: [] }, capital: { ...b, accounts: [{ ...old, value: 1, valueBase: 1 }] }, accountLifecycle: [{ ...lifecycle, firstObservedMonth: '2031-09' }] }, 'month')!.holdings[0]).toMatchObject({ opened: true, changeKnown: true })
})

it('does not claim complete group totals when endpoint provenance is absent', async () => {
  const { holdingGroups } = await import('../../src/domain/assetChanges')
  const groups = holdingGroups(currentHoldings(end), false)
  expect(groups.type.every(g => !g.valueKnown && !g.changeKnown)).toBe(true)
})
