import { describe, expect, it } from 'vitest'
import {
  ANNUAL_RETURN, allocateGoals, computeCagr, computeCoastFire, fireValues, firstShare, goalsInBase, isFireGoal, planPreview, savingToMeet, shareSteps, unknownSavingsPlan,
  fireReturnRange, monthsUntil, realReturn, requiredCagr, todaysMoneyFactor, savingsTakenAhead,
} from '../../src/domain/goals'
import type { GoalRow, HistoryPoint, Rates } from '../../src/domain/types'

const RATES: Rates = { RUB: 75, EUR: 75 / 90 }

function goal(o: Partial<GoalRow> & { id: string }): GoalRow {
  return {
    id: o.id, name: o.name ?? o.id, target: o.target ?? 1000, current: o.current ?? 0,
    target_date: o.target_date ?? '2032-12-31', emoji: o.emoji ?? null, currency: o.currency ?? 'USD',
  }
}

describe('monthsUntil', () => {
  it('counts whole calendar months from today to a future date', () => {
    expect(monthsUntil('2032-03-31', new Date(2031, 8, 11))).toBe(6)
  })
  it('returns 0 for the current month', () => {
    expect(monthsUntil('2031-09-30', new Date(2031, 8, 11))).toBe(0)
  })
  it('counts months correctly for a first-of-month target (timezone-safe)', () => {
    expect(monthsUntil('2039-02-01', new Date(2031, 8, 11))).toBe(89)
  })

  it('reads today in UTC like every other domain date', () => {
    // 23:30 UTC on 31 December is still December, whatever the local zone says
    expect(monthsUntil('2032-01-31', new Date('2031-12-31T23:30:00Z'))).toBe(1)
  })
})

describe('allocateGoals', () => {
  const today = new Date(2031, 8, 11)
  const by = (plan: ReturnType<typeof allocateGoals>, id: string) => plan.allocations.find(a => a.goal.id === id)!

  it('says why a goal is never reached: nothing saved, nearer goals take everything, or longer than the horizon', () => {
    const big = goal({ id: 'big', target: 10_000_000, target_date: '2040-12-31' })
    expect(by(allocateGoals([big], 0, today, RATES, 'USD'), 'big')).toMatchObject({ status: 'unreachable', unreachableReason: 'no_savings' })
    // 100 a month: 10 million takes 100,000 months, past the 1,200 the plan looks ahead
    expect(by(allocateGoals([big], 100, today, RATES, 'USD'), 'big')).toMatchObject({ status: 'unreachable', unreachableReason: 'over_horizon' })
    // an overdue goal takes all it still needs every month: the later one never gets anything
    const overdue = goal({ id: 'overdue', target: 10_000_000, target_date: '2030-12-31' })
    const later = goal({ id: 'later', target: 500, target_date: '2033-12-31' })
    expect(by(allocateGoals([overdue, later], 100, today, RATES, 'USD'), 'later')).toMatchObject({ status: 'unreachable', unreachableReason: 'taken_ahead' })
    expect(by(allocateGoals([later], 100, today, RATES, 'USD'), 'later')).not.toHaveProperty('unreachableReason')
  })

  it('funds the nearest-deadline goal first; a goal the savings never reach in time is at risk', () => {
    const plan = allocateGoals([
      goal({ id: 'far',  target: 2400, target_date: '2033-09-30' }),
      goal({ id: 'soon', target: 720,  target_date: '2032-03-31' }),
    ], 120, today, RATES, 'USD')
    expect(by(plan, 'soon')).toMatchObject({ status: 'on_track', projectedDate: '2032-03', allocBase: 120 })
    // nothing for the far goal for 6 months, then 120 a month: 2400 ÷ 120 = 20 months more, 2033-11 — after its deadline
    expect(by(plan, 'far')).toMatchObject({ status: 'at_risk', projectedDate: '2033-11', allocBase: 0 })
    expect(plan.totalRequiredBase).toBeCloseTo(220, 6)
    expect(plan.surplusBase).toBeCloseTo(-100, 6)
  })
  it('marks a completed goal done and excludes it from required total', () => {
    const plan = allocateGoals([goal({ id: 'done', target: 750, current: 750, target_date: '2032-09-30' })], 0, today, RATES, 'USD')
    expect(plan.allocations[0]).toMatchObject({ status: 'done', projectedDate: null, allocBase: 0 })
    expect(plan.totalRequiredBase).toBe(0)
  })
  it('a goal the savings would take more than 100 years to reach is unreachable, with no date and no throw', () => {
    // 33 000 at 0.01 a month is 3.3 million months: shiftMonth would leave the Date range
    const plan = allocateGoals([goal({ id: 'g', target: 33000, target_date: '2032-03-31' })], 0.01, today, RATES, 'USD')
    expect(plan.allocations[0]).toMatchObject({ status: 'unreachable', projectedDate: null })
    // 1200 months is still within the horizon, 1201 is not
    const edge = allocateGoals([goal({ id: 'g', target: 1200, target_date: '2032-03-31' })], 1, today, RATES, 'USD')
    expect(edge.allocations[0]).toMatchObject({ status: 'at_risk', projectedDate: '2131-09' })
    const past = allocateGoals([goal({ id: 'g', target: 1201, target_date: '2032-03-31' })], 1, today, RATES, 'USD')
    expect(past.allocations[0]).toMatchObject({ status: 'unreachable', projectedDate: null })
  })
  it('a fully funded goal with a deadline beyond the horizon stays on track with its date; an under-funded one is unreachable', () => {
    // 1311 months to December 2140; 13 110 at the required 10 a month is reached exactly by the deadline
    const plan = allocateGoals([goal({ id: 'g', target: 13110, target_date: '2140-12-31' })], 100, today, RATES, 'USD')
    expect(plan.allocations[0]).toMatchObject({ status: 'on_track', projectedDate: '2140-12', allocBase: 10 })
    // 5 a month: 2622 months, past the horizon
    const short = allocateGoals([goal({ id: 'g', target: 13110, target_date: '2140-12-31' })], 5, today, RATES, 'USD')
    expect(short.allocations[0]).toMatchObject({ status: 'unreachable', projectedDate: null, allocBase: 5 })
  })
  it('partial funding yields at_risk with a projected date', () => {
    const plan = allocateGoals([goal({ id: 'g', target: 1500, target_date: '2032-03-31' })], 100, today, RATES, 'USD')
    expect(plan.allocations[0].status).toBe('at_risk')
    // 1500 ÷ 100 a month = 15 months from September 2031
    expect(plan.allocations[0].projectedDate).toBe('2032-12')
  })
  it('a goal funded at exactly its share is reached by its deadline: the float dust of the shares does not push it a month past', () => {
    const plan = allocateGoals([goal({ id: 'g', target: 1000, target_date: '2032-06-30' })], 1000 / 9, today, RATES, 'USD')
    expect(plan.allocations[0]).toMatchObject({ status: 'on_track', projectedDate: '2032-06' })
    const odd = allocateGoals([goal({ id: 'g', target: 5600.3, current: 0.1, target_date: '2033-02-28' })], 5600.2 / 17, today, RATES, 'USD')
    expect(odd.allocations[0]).toMatchObject({ status: 'on_track', projectedDate: '2033-02' })
  })
  it('converts non-USD goals to USD', () => {
    const plan = allocateGoals([goal({ id: 'rub', target: 112500, currency: 'RUB', target_date: '2032-03-31' })], 1000, today, RATES, 'USD')
    expect(plan.allocations[0].requiredMonthlyBase).toBeCloseTo(1500 / 6, 4)
  })
  it('a past-due goal takes what it still needs, ahead of the later deadlines, and is reached late; its required stays 0', () => {
    const plan = allocateGoals([
      goal({ id: 'next', target: 1200, target_date: '2032-08-31' }),
      goal({ id: 'late', target: 1000, current: 200, target_date: '2030-11-30' }),
    ], 300, today, RATES, 'USD')
    // 800 still missing: 300, 300 and 200 — reached in December 2031, after its deadline
    expect(by(plan, 'late')).toMatchObject({ requiredMonthlyBase: 0, allocBase: 300, status: 'at_risk', projectedDate: '2031-12' })
    // the next goal gets nothing for two months and 100 in the third, then 1100 ÷ 8 = 137.50 a month: still on track
    expect(by(plan, 'next')).toMatchObject({ allocBase: 0, status: 'on_track', projectedDate: '2032-08' })
    // nothing saved: the past-due goal is never reached
    expect(allocateGoals([goal({ id: 'late', target: 1000, current: 200, target_date: '2030-11-30' })], 0, today, RATES, 'USD').allocations[0])
      .toMatchObject({ status: 'unreachable', projectedDate: null })
  })
  it('leaves out goals whose currency has no rate', () => {
    const plan = allocateGoals([goal({ id: 'gbp', currency: 'GBP' }), goal({ id: 'usd' })], 100, today, RATES, 'USD')
    expect(plan.allocations.map(a => a.goal.id)).toEqual(['usd'])
  })

  it('a reached goal frees its share for the next ones', () => {
    // the soon goal takes 100 a month for 6 months; the later one gets 40 meanwhile (240), then the whole 140: 2760 ÷ 140 =
    // 19.71 → 20 months more, 2033-11. With the soon goal's 100 kept for ever it would take 3000 ÷ 40 = 75 months, 2037-12
    const plan = allocateGoals([
      goal({ id: 'later', target: 3000, target_date: '2033-09-30' }),
      goal({ id: 'soon', target: 600, target_date: '2032-03-31' }),
    ], 140, today, RATES, 'USD')
    expect(by(plan, 'soon')).toMatchObject({ status: 'on_track', projectedDate: '2032-03', allocBase: 100 })
    expect(by(plan, 'later')).toMatchObject({ status: 'at_risk', projectedDate: '2033-11', allocBase: 40 })
    // 150 a month: 300 by March, then 2700 ÷ 18 = 150, the whole pool — reached by its deadline
    const enough = allocateGoals([
      goal({ id: 'later', target: 3000, target_date: '2033-09-30' }),
      goal({ id: 'soon', target: 600, target_date: '2032-03-31' }),
    ], 150, today, RATES, 'USD')
    expect(by(enough, 'later')).toMatchObject({ status: 'on_track', projectedDate: '2033-09', allocBase: 50 })
  })
  it('goals with the same deadline are funded in the input order', () => {
    const goals = [goal({ id: 'a', target: 1200, target_date: '2032-03-31' }), goal({ id: 'b', target: 1200, target_date: '2032-03-31' })]
    const ab = allocateGoals(goals, 300, today, RATES, 'USD')
    expect(ab.allocations.map(a => [a.goal.id, a.allocBase])).toEqual([['a', 200], ['b', 100]])
    const ba = allocateGoals([...goals].reverse(), 300, today, RATES, 'USD')
    expect(ba.allocations.map(a => [a.goal.id, a.allocBase])).toEqual([['b', 200], ['a', 100]])
  })
  it('no savings, or negative ones: every open goal is unreachable and takes nothing', () => {
    for (const savings of [0, -500]) {
      const plan = allocateGoals([goal({ id: 'a', target: 1200 }), goal({ id: 'done', target: 10, current: 10 })], savings, today, RATES, 'USD')
      expect(plan.allocations.map(a => [a.goal.id, a.status, a.projectedDate, a.allocBase])).toEqual([['a', 'unreachable', null, 0], ['done', 'done', null, 0]])
    }
  })

  it('a cut in the savings for the first months (a loan’s payment over its term) only lowers those months’ pool', () => {
    // 100 a month less 50 for 4 months: 200, then 100 a month — 1300 ÷ 100 = 13 months more, 2033-02 (17 months)
    const plan = allocateGoals([goal({ id: 'g', target: 1500, target_date: '2032-03-31' })], 100, today, RATES, 'USD', { perMonthBase: 50, months: 4 })
    expect(plan.allocations[0]).toMatchObject({ status: 'at_risk', projectedDate: '2033-02', allocBase: 50 })
    expect(plan.monthlySavingsBase).toBe(100)
    // a cut above the savings leaves nothing for those months, never a negative pool; nothing saved at all stays unreachable
    const over = allocateGoals([goal({ id: 'g', target: 1500, target_date: '2032-03-31' })], 100, today, RATES, 'USD', { perMonthBase: 500, months: 2 })
    expect(over.allocations[0]).toMatchObject({ projectedDate: '2033-02', allocBase: 0 })
    expect(allocateGoals([goal({ id: 'g' })], 0, today, RATES, 'USD', { perMonthBase: 10, months: 3 }).allocations[0].status).toBe('unreachable')
  })

  it('the demo family, 2026-10-26: Japan on track, the emergency fund at risk to 2028-04, FIRE with its 8% return at risk to 2046-04', () => {
    // savings 2137.74: Japan needs 5600 ÷ 7 = 800 and gets it; the fund needs 31 000 ÷ 14 = 2214.29 and gets the 1337.74 left,
    // then all of it once Japan is reached in May 2027: 2028-04. FIRE gets the pool from then on and grows at 8% a year
    const plan = allocateGoals([
      goal({ id: 'emergency', target: 63000, current: 32000, target_date: '2027-12-31' }),
      goal({ id: 'japan', target: 9000, current: 3400, target_date: '2027-05-31' }),
      goal({ id: 'fire', target: 2000000, current: 205000, target_date: '2040-12-31' }),
    ], 2137.74, new Date('2026-10-26T09:00:00Z'), RATES, 'USD')
    expect(plan.allocations.map(a => [a.goal.id, a.status, a.projectedDate])).toEqual([
      ['japan', 'on_track', '2027-05'], ['emergency', 'at_risk', '2028-04'], ['fire', 'at_risk', '2046-04'],
    ])
    expect(by(plan, 'japan')).toMatchObject({ allocBase: 800, requiredMonthlyBase: 800 })
    expect(by(plan, 'emergency').allocBase).toBeCloseTo(1337.74, 6)
    expect(by(plan, 'emergency').requiredMonthlyBase).toBeCloseTo(31000 / 14, 6)
    expect(by(plan, 'fire').allocBase).toBe(0)
  })
})

describe('allocateGoals: independence with its return (the demo, 12.11.2026)', () => {
  const today = new Date('2026-11-12T09:00:00Z')
  const SAVING = 2140.76
  const DEMO = [
    goal({ id: 'vacation', name: 'Trip to Japan', target: 9000, current: 3400, target_date: '2027-05-31' }),
    goal({ id: 'emergency', name: 'Emergency fund', target: 63000, current: 32000, target_date: '2027-12-31' }),
    goal({ id: 'fire', name: 'Financial independence', target: 2000000, current: 205000, target_date: '2040-12-31' }),
  ]
  const by = (plan: ReturnType<typeof allocateGoals>, id: string) => plan.allocations.find(a => a.goal.id === id)!
  const plan = allocateGoals(DEMO, SAVING, today, {}, 'USD')

  it('one date for independence: 05.2046, at risk; the trip 05.2027 on track; the cushion 05.2028 at risk', () => {
    expect(plan.allocations.map(a => [a.goal.id, a.status, a.projectedDate])).toEqual([
      ['vacation', 'on_track', '2027-05'], ['emergency', 'at_risk', '2028-05'], ['fire', 'at_risk', '2046-05'],
    ])
    expect(plan.totalRequiredBase).toBeCloseTo(13939.25, 2)
    expect(by(plan, 'vacation').allocBase).toBeCloseTo(933.33, 2)
    expect(by(plan, 'emergency').allocBase).toBeCloseTo(1207.43, 2)
  })
  it('the shares add up to the saving every month while independence takes; independence starts with 1 933,68 in 05.2028 and ends in 05.2046', () => {
    const fire = by(plan, 'fire').shares
    for (let n = 0; n < fire.length; n++) {
      const sum = plan.allocations.reduce((s, a) => s + (a.shares[n] ?? 0), 0)
      expect(sum).toBeCloseTo(SAVING, 6)
    }
    expect(fire.findIndex(v => v > 0)).toBe(17)
    expect(fire[17]).toBeCloseTo(1933.68, 2)
    // 05.2046 is month 234 after 11.2026: its last share
    expect(fire.length).toBe(234)
  })
  it('what independence holds by its deadline on the plan: 1 190 083', () => {
    const f = by(plan, 'fire')
    expect(Math.round(fireValues(205000, f.shares, ANNUAL_RETURN, f.monthsToDeadline)[f.monthsToDeadline])).toBe(1190083)
  })
  it('the strategies re-run the plan: +500 a month 01.2045, a 10% return 08.2043', () => {
    expect(by(allocateGoals(DEMO, SAVING + 500, today, {}, 'USD'), 'fire').projectedDate).toBe('2045-01')
    expect(by(allocateGoals(DEMO, SAVING, today, {}, 'USD', undefined, 0.10), 'fire').projectedDate).toBe('2043-08')
  })
  it('a goal after independence is funded from its month', () => {
    // the advisor fixture: 2026-10-25, saving 2 137,74; independence 2046-04, then the boat of 60 000 by 2045-12
    const p = allocateGoals([
      goal({ id: 'emergency', target: 63000, current: 32000, target_date: '2027-12-31' }),
      goal({ id: 'japan', target: 9000, current: 3400, target_date: '2027-05-31' }),
      goal({ id: 'fire', target: 2000000, current: 205000, target_date: '2040-12-31' }),
      goal({ id: 'boat', target: 60000, target_date: '2045-12-31' }),
    ], 2137.74, new Date('2026-10-25T09:00:00Z'), {}, 'USD')
    expect(by(p, 'fire').projectedDate).toBe('2046-04')
    const boat = by(p, 'boat')
    expect(boat.shares.findIndex(v => v > 0)).toBe(by(p, 'fire').shares.length)
    expect(boat).toMatchObject({ status: 'at_risk', projectedDate: '2048-09' })
  })
  it('a higher saving never worsens a status', () => {
    const rank = { done: 0, on_track: 1, at_risk: 2, unreachable: 3 }
    let prev: ReturnType<typeof allocateGoals> | null = null
    for (const saving of [500, 1000, SAVING, 3000, 6000, 14000]) {
      const cur = allocateGoals(DEMO, saving, today, {}, 'USD')
      if (prev) cur.allocations.forEach((a, i) => expect(rank[a.status!]).toBeLessThanOrEqual(rank[prev!.allocations[i].status!]))
      prev = cur
    }
  })
  it('with every need met independence is on track by its deadline', () => {
    const fire = by(allocateGoals(DEMO, 14000, today, {}, 'USD'), 'fire')
    expect(fire.status).toBe('on_track')
    expect(fire.projectedDate! <= '2040-12').toBe(true)
  })
  it('a nearer goal late past 60 months: independence still reads the full series', () => {
    const p = allocateGoals([goal({ id: 'house', target: 400000, target_date: '2027-12-31' }), ...DEMO.slice(2)], SAVING, today, {}, 'USD')
    const fire = by(p, 'fire')
    expect(by(p, 'house').shares.length).toBeGreaterThan(60)
    expect(fire.shares.findIndex(v => v > 0)).toBeGreaterThan(60)
    expect(fire.projectedDate).not.toBeNull()
  })
  it('the plan while the savings are unknown keeps no shares and no forecast', () => {
    const u = unknownSavingsPlan(plan)
    expect(u.allocations.every(a => a.shares.length === 0 && a.projectedDate === null)).toBe(true)
  })
})

describe('savingToMeet and shareSteps (the demo, 12.11.2026)', () => {
  const today = new Date('2026-11-12T09:00:00Z')
  const SAVING = 2140.76
  const DEMO = [
    goal({ id: 'vacation', target: 9000, current: 3400, target_date: '2027-05-31' }),
    goal({ id: 'emergency', target: 63000, current: 32000, target_date: '2027-12-31' }),
    goal({ id: 'fire', name: 'Financial independence', target: 2000000, current: 205000, target_date: '2040-12-31' }),
  ]
  it('the cushion makes 12.2027 with 2 815,38 a month, never above the need of the goals at or ahead of it', () => {
    const s = savingToMeet(DEMO, 'emergency', SAVING, today, {}, 'USD')!
    expect(s).toBeCloseTo(2815.38, 2)
    expect(s).toBeLessThanOrEqual(933.33 + 2384.62 + 0.01)
    expect(allocateGoals(DEMO, s, today, {}, 'USD').allocations.find(a => a.goal.id === 'emergency')!.status).toBe('on_track')
  })
  it('is null for a goal on track, without a rate, with the savings unknown, or past its deadline', () => {
    expect(savingToMeet(DEMO, 'vacation', SAVING, today, {}, 'USD')).toBeNull()
    expect(savingToMeet([...DEMO, goal({ id: 'gbp', currency: 'GBP' })], 'gbp', SAVING, today, {}, 'USD')).toBeNull()
    expect(savingToMeet(DEMO, 'emergency', null, today, {}, 'USD')).toBeNull()
    expect(savingToMeet([goal({ id: 'late', target: 500, target_date: '2026-05-31' })], 'late', 10, today, {}, 'USD')).toBeNull()
  })
  it('independence is met on its own plan, with its return', () => {
    const s = savingToMeet(DEMO, 'fire', SAVING, today, {}, 'USD')!
    expect(s).toBeGreaterThan(SAVING)
    expect(allocateGoals(DEMO, s, today, {}, 'USD').allocations.find(a => a.goal.id === 'fire')!.status).toBe('on_track')
  })
  it('the shares by step: the cushion 1 207,43 now and 2 140,76 from 06.2027; independence 1 933,68 from 05.2028, then 2 140,76', () => {
    const plan = allocateGoals(DEMO, SAVING, today, {}, 'USD')
    const of = (id: string) => shareSteps(plan.allocations.find(a => a.goal.id === id)!.shares, '2026-11')
    expect(of('vacation')).toEqual({ now: expect.closeTo(933.33, 2), later: null })
    expect(of('emergency')).toMatchObject({ now: expect.closeTo(1207.43, 2), later: { month: '2027-06', perMonthBase: expect.closeTo(2140.76, 2) } })
    expect(of('fire')).toMatchObject({ now: 0, later: { month: '2028-05', perMonthBase: expect.closeTo(1933.68, 2), next: expect.closeTo(2140.76, 2) } })
  })
  it('goalsInBase takes the base amounts and leaves out a goal without a rate', () => {
    const items = [
      { ...goal({ id: 'a', currency: 'EUR', target: 900, current: 90 }), targetBase: 1000, currentBase: 100 },
      { ...goal({ id: 'b', currency: 'XYZ' }), targetBase: null, currentBase: null },
    ]
    expect(goalsInBase(items, 'USD')).toEqual([{ ...items[0], target: 1000, current: 100, currency: 'USD' }])
  })
})

describe('planPreview (the demo, 12.11.2026)', () => {
  const today = new Date('2026-11-12T09:00:00Z')
  const SAVING = 2140.76
  const DEMO = [
    goal({ id: 'vacation', target: 9000, current: 3400, target_date: '2027-05-31' }),
    goal({ id: 'emergency', name: 'Emergency fund', target: 63000, current: 32000, target_date: '2027-12-31' }),
    goal({ id: 'fire', name: 'Financial independence', target: 2000000, current: 205000, target_date: '2040-12-31' }),
  ]
  it('the cushion moved to 05.2028: 1 722 a month, 1 207 now and 1 980 from 06.2027, on time; independence starts 06.2027, still 05.2046', () => {
    const p = planPreview(DEMO, { ...DEMO[1], target_date: '2028-05-31' }, SAVING, today, {}, 'USD')
    if (p.noRate) throw new Error('rate')
    expect(p.need).toBeCloseTo(31000 / 18, 6)
    expect(p.order).toBe(2)
    expect(p.plan).toMatchObject({ status: 'on_track', projectedDate: '2028-05' })
    expect(p.plan!.steps.now).toBeCloseTo(1207.43, 2)
    expect(p.plan!.steps.later).toMatchObject({ month: '2027-06', perMonthBase: expect.closeTo(1979.62, 2) })
    expect(p.plan!.moves).toEqual([{ goalId: 'fire', name: 'Financial independence', before: '2046-05', after: '2046-05', startBefore: '2028-05', startAfter: '2027-06', statusAfter: 'at_risk' }])
  })
  it('a new car of 25 000 by 12.2029: third in the queue, 676 a month, on time; independence 12.2046 instead of 05.2046', () => {
    const p = planPreview(DEMO, goal({ id: 'draft', name: 'Car', target: 25000, target_date: '2029-12-31' }), SAVING, today, {}, 'USD')
    if (p.noRate) throw new Error('rate')
    expect(p.order).toBe(3)
    expect(Math.round(p.need)).toBe(676)
    expect(p.plan).toMatchObject({ status: 'on_track', projectedDate: '2029-12' })
    expect(p.plan!.moves.find(m => m.goalId === 'fire')).toMatchObject({ before: '2046-05', after: '2046-12' })
  })
  it('a draft in a currency without a rate: no rate; with the saving unknown, the need and the place only', () => {
    expect(planPreview(DEMO, goal({ id: 'draft', currency: 'XYZ' }), SAVING, today, {}, 'USD')).toEqual({ noRate: true })
    expect(planPreview(DEMO, goal({ id: 'draft', currency: 'EUR', target: 900 }), SAVING, today, RATES, 'USD')).toMatchObject({ noRate: false })
    expect(planPreview(DEMO, goal({ id: 'draft', target: 3700, target_date: '2027-12-31' }), null, today, {}, 'USD')).toMatchObject({ noRate: false, order: 3, plan: null, need: expect.closeTo(3700 / 13, 6) })
  })
})

describe('computeCoastFire', () => {
  it('is reached when current NW already compounds to target by the deadline', () => {
    const c = computeCoastFire(80000, 140000, ANNUAL_RETURN, 96)
    expect(c.reached).toBe(true)
    expect(c.gapBase).toBe(0)
  })
  it('reports the gap when NW is below the coast number', () => {
    const c = computeCoastFire(12000, 140000, ANNUAL_RETURN, 96)
    expect(c.reached).toBe(false)
    // coast number: 140 000 ÷ (1 + 0,08/12)^96
    expect(c.gapBase).toBeCloseTo(140000 / Math.pow(1 + ANNUAL_RETURN / 12, 96) - 12000, 6)
  })
})

describe('computeCagr', () => {
  it('annualizes growth between the first and last snapshot', () => {
    const hist: HistoryPoint[] = [
      { date: '2029-09-30', assets: 0, liabilities: 0, netWorth: 125000 },
      { date: '2030-09-30', assets: 0, liabilities: 0, netWorth: 140000 },
    ]
    expect(computeCagr(hist, new Set())).toBeCloseTo(0.12, 4)
  })
  it('returns null for insufficient history', () => expect(computeCagr([], new Set())).toBeNull())
  it('returns null when the capital is negative at either end (no real growth rate)', () => {
    const point = (date: string, netWorth: number): HistoryPoint => ({ date, assets: 0, liabilities: 0, netWorth })
    expect(computeCagr([point('2030-04-30', 60), point('2030-05-31', -90)], new Set())).toBeNull()
    expect(computeCagr([point('2030-04-30', -60), point('2030-05-31', 90)], new Set())).toBeNull()
  })
  it('returns null when both points fall in one month or the base is not positive', () => {
    const point = (date: string, netWorth: number): HistoryPoint => ({ date, assets: 0, liabilities: 0, netWorth })
    expect(computeCagr([point('2031-02-03', 100), point('2031-02-27', 120)], new Set())).toBeNull()
    expect(computeCagr([point('2030-02-28', 0), point('2031-02-28', 120)], new Set())).toBeNull()
  })
})

describe('requiredCagr', () => {
  it('computes the growth needed to hit the target by the deadline', () => {
    expect(requiredCagr(60000, 150000, 144)).toBeCloseTo(0.0794, 3)
  })
  it('returns null when current NW is non-positive', () => expect(requiredCagr(0, 150000, 144)).toBeNull())
})

describe('fireReturnRange', () => {
  it('is the base three points lower and higher, the lower never below zero', () => {
    expect(fireReturnRange(0.08).low).toBeCloseTo(0.05, 10)
    expect(fireReturnRange(0.08).high).toBeCloseTo(0.11, 10)
    expect(fireReturnRange(0.02)).toEqual({ low: 0, high: 0.05 })
  })
})

describe('todaysMoneyFactor', () => {
  it('lifts a month to the last one\'s money: a year back by one year\'s inflation, the last month by nothing', () => {
    expect(todaysMoneyFactor('2031-04', '2031-04', 10)).toBe(1)
    expect(todaysMoneyFactor('2030-04', '2031-04', 10)).toBeCloseTo(1.1, 10)
    expect(todaysMoneyFactor('2030-10', '2031-04', 10)).toBeCloseTo(Math.sqrt(1.1), 10)
  })

  it('so a year\'s change in today\'s money is realReturn of the nominal one', () => {
    const then = 1000, now = 1200
    const real = now / (then * todaysMoneyFactor('2030-04', '2031-04', 10)) - 1
    expect(real).toBeCloseTo(realReturn(now / then - 1, 0.1), 10)
  })
})

describe('realReturn', () => {
  it('discounts nominal return by inflation', () => expect(realReturn(0.08, 0.035)).toBeCloseTo(0.04348, 4))
})

describe('savingsTakenAhead', () => {
  const today = new Date(2031, 8, 11)
  const goals = [
    goal({ id: 'trip', target: 1100, target_date: '2032-08-31' }),
    goal({ id: 'car', target: 4600, target_date: '2033-08-31' }),
    goal({ id: 'fire', target: 500000, target_date: '2050-12-31' }),
  ]

  it('names what the nearer goals take now and the month the last of them is reached', () => {
    const plan = allocateGoals(goals, 250, today, RATES, 'USD')
    // the trip needs 100 a month and gets it; the car needs 200 and gets the other 150, then the trip's 100 too from
    // August 2032: 2950 ÷ 12 = 245.83 a month, reached by its deadline
    expect(savingsTakenAhead(plan, 'fire')).toEqual({ perMonthBase: 250, untilMonth: '2033-08' })
  })
  it('counts a nearer goal that takes nothing now but is funded once the first is reached', () => {
    // 300 a month all go to the first goal (333.33 needed) until January 2032; the second gets them then, reached 2032-04;
    // independence then gets them and grows at 8%: 2063-08
    const plan = allocateGoals([
      goal({ id: 'a', target: 1000, target_date: '2031-12-31' }),
      goal({ id: 'b', target: 1000, target_date: '2032-02-29' }),
      goal({ id: 'fire', target: 500000, target_date: '2050-12-31' }),
    ], 300, today, RATES, 'USD')
    expect(plan.allocations.map(a => [a.goal.id, a.allocBase, a.projectedDate])).toEqual([['a', 300, '2032-01'], ['b', 0, '2032-04'], ['fire', 0, '2063-08']])
    expect(savingsTakenAhead(plan, 'fire')).toEqual({ perMonthBase: 300, untilMonth: '2032-04' })
  })
  it('is null for the nearest goal and for a goal not in the plan', () => {
    const plan = allocateGoals(goals, 250, today, RATES, 'USD')
    expect(savingsTakenAhead(plan, 'trip')).toBeNull()
    expect(savingsTakenAhead(plan, 'none')).toBeNull()
  })
  it('names no month when a nearer goal that takes the savings is never reached', () => {
    const plan = allocateGoals([
      goal({ id: 'huge', target: 5e9, target_date: '2031-12-31' }),
      goal({ id: 'trip', target: 1100, target_date: '2032-08-31' }),
      goal({ id: 'fire', target: 500000, target_date: '2050-12-31' }),
    ], 250, today, RATES, 'USD')
    expect(savingsTakenAhead(plan, 'trip')).toEqual({ perMonthBase: 250, untilMonth: null })
    expect(savingsTakenAhead(plan, 'fire')).toEqual({ perMonthBase: 250, untilMonth: null })
  })
  it('is null when nothing is saved, so the nearer goals take nothing', () => {
    expect(savingsTakenAhead(allocateGoals(goals, 0, today, RATES, 'USD'), 'fire')).toBeNull()
  })
})

describe('firstShare', () => {
  const today = new Date(2031, 8, 11)
  const NO_CUT = { perMonthBase: 0, months: 0 }

  it('a goal funded from the first month: that month and its share', () => {
    const goals = [goal({ id: 'later', target: 3000, target_date: '2033-09-30' }), goal({ id: 'soon', target: 600, target_date: '2032-03-31' })]
    expect(firstShare(goals, 140, today, RATES, 'USD', NO_CUT, 'soon')).toEqual({ month: '2031-10', perMonthBase: 100 })
    expect(firstShare(goals, 140, today, RATES, 'USD', NO_CUT, 'later')).toEqual({ month: '2031-10', perMonthBase: 40 })
  })
  it('a goal behind a nearer one: the month that one is reached, and the whole share of the month after, not the rest of the first', () => {
    // 300 a month go to the first goal until January 2032, which takes 100 then: the second gets 200 in January, 300 after
    const goals = [goal({ id: 'a', target: 1000, target_date: '2031-12-31' }), goal({ id: 'b', target: 1000, target_date: '2032-02-29' })]
    expect(firstShare(goals, 300, today, RATES, 'USD', NO_CUT, 'b')).toEqual({ month: '2032-01', perMonthBase: 300 })
  })
  it('is null for a goal that never gets money, one reached already, one not in the plan', () => {
    const goals = [
      goal({ id: 'huge', target: 5e9, target_date: '2031-12-31' }), goal({ id: 'trip', target: 1100, target_date: '2032-08-31' }),
      goal({ id: 'done', target: 100, current: 100 }),
    ]
    expect(firstShare(goals, 250, today, RATES, 'USD', NO_CUT, 'trip')).toBeNull()
    expect(firstShare(goals, 250, today, RATES, 'USD', NO_CUT, 'done')).toBeNull()
    expect(firstShare(goals, 250, today, RATES, 'USD', NO_CUT, 'none')).toBeNull()
  })
})

describe('isFireGoal', () => {
  it.each([
    ['fire', 'x'], ['x', 'FIRE'], ['fire_2', 'x'], ['x', 'My FIRE goal'], ['x', 'Financial independence (FIRE)'],
  ])('matches %s / %s', (id, name) => {
    expect(isFireGoal({ id, name })).toBe(true)
  })
  it.each([
    ['fireplace', 'Fireplace repair'], ['x', 'bonfire'], ['x', 'Firefox licence'], ['fire2026', 'x'], ['x', '2fire'],
  ])('does not match %s / %s', (id, name) => {
    expect(isFireGoal({ id, name })).toBe(false)
  })
})
