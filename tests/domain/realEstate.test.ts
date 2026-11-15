import { equitySteps, latestValuation, propertyEquity, propertyGain, propertyShare, propertyTotals, valuationChanges, type EquityStep } from '../../src/domain/realEstate'

const purchase = { price: 200000, date: '2027-06-15', currency: 'EUR' }
const vals = [
  { year: 2029, value: 230000, currency: 'EUR' },
  { year: 2031, value: 260000, currency: 'EUR' },
  { year: 2030, value: 240000, currency: 'EUR' },
]

describe('latestValuation', () => {
  it('is the newest year, whatever the order', () => expect(latestValuation(vals)?.year).toBe(2031))
  it('is null without valuations', () => expect(latestValuation([])).toBeNull())
})

describe('propertyGain', () => {
  it('gives the amount, the percent and the amount per year held', () => {
    expect(propertyGain(purchase, vals)).toEqual({ amount: 60000, percent: 30, perYear: 15000, currency: 'EUR' })
  })
  it('has no per-year figure inside the first year', () => {
    expect(propertyGain(purchase, [{ year: 2027, value: 210000, currency: 'EUR' }])?.perYear).toBeNull()
  })
  it('has no per-year figure for a valuation before the purchase year', () => {
    expect(propertyGain(purchase, [{ year: 2026, value: 190000, currency: 'EUR' }])).toMatchObject({ amount: -10000, perYear: null })
  })
  it('has no per-year figure without a readable purchase year', () => {
    for (const date of ['', 'unknown', '0000-01-01']) {
      expect(propertyGain({ ...purchase, date }, vals)).toMatchObject({ amount: 60000, perYear: null })
    }
  })
  it('has no percent for a free purchase', () => {
    expect(propertyGain({ ...purchase, price: 0 }, vals)?.percent).toBeNull()
  })
  it('is null when the currencies differ or there is no valuation', () => {
    expect(propertyGain({ ...purchase, currency: 'USD' }, vals)).toBeNull()
    expect(propertyGain(purchase, [])).toBeNull()
  })
})

describe('valuationChanges', () => {
  it('compares each valuation with the one before, the first with the purchase price; newest first', () => {
    const changes = valuationChanges(vals, purchase)
    expect(changes.map(c => [c.year, c.change, c.againstPurchase])).toEqual([[2031, 20000, false], [2030, 10000, false], [2029, 30000, true]])
    expect(changes[2].pct).toBe(15)
  })
  it('a first valuation equal to the price changes by 0; another currency has no change', () => {
    expect(valuationChanges([{ year: 2027, value: 200000, currency: 'EUR' }], purchase)[0]).toMatchObject({ change: 0, againstPurchase: true })
    expect(valuationChanges([{ year: 2027, value: 200000, currency: 'USD' }], purchase)[0]).toMatchObject({ change: null, pct: null })
  })
})

describe('propertyShare', () => {
  it('is the base value over the assets, null without a rate or assets', () => {
    const realEstate = [{ name: 'House', member: '', currency: 'USD', value: 568000, valueBase: 568000 }, { name: 'Flat', member: '', currency: 'GBP', value: 1, valueBase: null }]
    expect(propertyShare({ assets: 1144126.78, realEstate }, 'House')).toBeCloseTo(49.645, 2)
    expect(propertyShare({ assets: 1000, realEstate }, 'Flat')).toBeNull()
    expect(propertyShare({ assets: 0, realEstate }, 'House')).toBeNull()
  })
})

// The demo house and its mortgage (docs/superpowers/specs/2026-11-08-real-estate-design.md): bought 15.09.2022 for 520 000,
// valued 568 000 in 2025, the mortgage of 416 000 issued the same day, 372 281.53 owing at 30.09.2026 by the schedule.
const house = { price: 520000, date: '2022-09-15', currency: 'USD' }
const mortgage = { name: 'Mortgage', property: 'House', currency: 'USD', type: 'mortgage', principal: 416000, issueDate: '2022-09-15', balance: 372281.53, balanceBase: 372281.53 }
const houseValue = { name: 'House', member: '', currency: 'USD', value: 568000, valueBase: 568000 }
const sumOf = (steps: EquityStep[]) => steps.filter(s => s.kind !== 'end').reduce((s, x) => s + x.amount, 0)

describe('propertyEquity', () => {
  it('gives the demo house equity 195 718.47 and loan-to-value 65.54%', () => {
    const eq = propertyEquity({ realEstate: [houseValue], securedLoans: [mortgage] }, 'House')!
    expect(eq.equityBase).toBe(195718.47)
    expect(eq.debtBase).toBe(372281.53)
    expect(eq.ltvPct).toBeCloseTo(65.54, 2)
  })
  it('is null without a linked loan, and sums several', () => {
    expect(propertyEquity({ realEstate: [houseValue], securedLoans: [] }, 'House')).toBeNull()
    const second = { ...mortgage, name: 'HELOC', balance: 20000, balanceBase: 20000 }
    expect(propertyEquity({ realEstate: [houseValue], securedLoans: [mortgage, second] }, 'House')).toMatchObject({ debtBase: 392281.53, equityBase: 175718.47 })
  })
  it('a loan without a rate leaves equity and loan-to-value unknown', () => {
    const eq = propertyEquity({ realEstate: [houseValue], securedLoans: [{ ...mortgage, currency: 'GBP', balanceBase: null }] }, 'House')!
    expect(eq).toMatchObject({ debtBase: null, equityBase: null, ltvPct: null })
  })
})

describe('equitySteps', () => {
  it('the demo house: 104 000 at purchase, +48 000 value, +43 718.47 repaid, 195 718.47 now', () => {
    const steps = equitySteps(house, { value: 568000, currency: 'USD' }, [mortgage])!
    expect(steps.map(s => [s.kind, s.amount])).toEqual([['start', 104000], ['value', 48000], ['repaid', 43718.47], ['end', 195718.47]])
    expect(steps[0]).toMatchObject({ noLoan: false })
    expect(sumOf(steps)).toBeCloseTo(steps.at(-1)!.amount, 6)
  })
  it('a loan issued years after the purchase starts at the price and borrows it out', () => {
    const later = { ...mortgage, name: 'Remortgage', issueDate: '2025-09-15', principal: 300000, balance: 290000 }
    const steps = equitySteps(house, { value: 568000, currency: 'USD' }, [later])!
    expect(steps.map(s => [s.kind, s.amount])).toEqual([['start', 520000], ['borrowed', -300000], ['value', 48000], ['repaid', 10000], ['end', 278000]])
    expect(steps[0]).toMatchObject({ noLoan: true })
    expect(sumOf(steps)).toBe(278000)
  })
  it('31 days after the purchase is still with it, 32 is later', () => {
    expect(equitySteps(house, { value: 520000, currency: 'USD' }, [{ ...mortgage, issueDate: '2022-10-16' }])![0].amount).toBe(104000)
    expect(equitySteps(house, { value: 520000, currency: 'USD' }, [{ ...mortgage, issueDate: '2022-10-17' }])![0].amount).toBe(520000)
  })
  it('two loans each add their steps and still sum to value − Σ balances', () => {
    const heloc = { ...mortgage, name: 'HELOC', issueDate: '2024-03-01', principal: 50000, balance: 41234.56 }
    const steps = equitySteps(house, { value: 568000, currency: 'USD' }, [mortgage, heloc])!
    expect(steps.map(s => s.kind)).toEqual(['start', 'borrowed', 'value', 'repaid', 'repaid', 'end'])
    expect(steps.at(-1)!.amount).toBeCloseTo(568000 - 372281.53 - 41234.56, 6)
    expect(sumOf(steps)).toBeCloseTo(steps.at(-1)!.amount, 6)
  })
  it('is null for a EUR loan on a USD property, or a valuation in another currency', () => {
    expect(equitySteps(house, { value: 568000, currency: 'USD' }, [{ ...mortgage, currency: 'EUR' }])).toBeNull()
    expect(equitySteps(house, { value: 500000, currency: 'EUR' }, [mortgage])).toBeNull()
  })
})

 describe('propertyTotals', () => {
  it('keeps unknown amounts and denominators distinct from known zero', () => {
    expect(propertyTotals([null, null], null)).toEqual({ total: null, sharePct: null })
    expect(propertyTotals([10, null], 100)).toEqual({ total: null, sharePct: null })
    expect(propertyTotals([0, 0], 100)).toEqual({ total: 0, sharePct: 0 })
    expect(propertyTotals([10, 20], 100)).toEqual({ total: 30, sharePct: 30 })
    expect(propertyTotals([10, 20], null)).toEqual({ total: 30, sharePct: null })
    expect(propertyTotals([Infinity], 100)).toEqual({ total: null, sharePct: null })
  })
})
