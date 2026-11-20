import { describe, expect, it } from 'vitest'
import { accountReturn } from '../../src/domain/accountReturn'
import { shiftMonth } from '../../src/domain/dates'

/** Month-end balances of the 12 months after 2030-01 (the start) growing by `annual`, with `extra` added to some */
const months = (n: number) => Array.from({ length: n }, (_, i) => shiftMonth('2030-01', i + 1))

describe('accountReturn', () => {
  it('no deposits: the annual rate is the balance growth', () => {
    const balances = [{ month: '2030-01', value: 1000 }, ...months(12).map((m, i) => ({ month: m, value: 1000 * 1.1 ** ((i + 1) / 12) }))]
    const r = accountReturn(balances, months(12).map(m => ({ month: m, amount: 0 })), '2031-01')!
    expect(r.annualRate).toBeCloseTo(0.1, 6)
    expect(r.gain).toBeCloseTo(100, 2)
    expect(r).toMatchObject({ months: 12, firstMonth: '2030-02' })
  })

  it('a deposit counts at mid-month and is not a gain; an account opened with it starts from zero', () => {
    const end = 1000 * 1.1 ** (11.5 / 12)
    const balances = months(12).map((m, i) => ({ month: m, value: i === 11 ? end : 1000 }))
    const transfers = months(12).map((m, i) => ({ month: m, amount: i === 0 ? 1000 : 0 }))
    const r = accountReturn(balances, transfers, '2031-01')!
    expect(r.annualRate).toBeCloseTo(0.1, 6)
    expect(r.gain).toBeCloseTo(end - 1000, 2)
  })

  it('withdrawals: money taken out is not a loss', () => {
    const balances = [{ month: '2030-01', value: 1000 }, ...months(6).map(m => ({ month: m, value: 500 }))]
    const transfers = months(6).map((m, i) => ({ month: m, amount: i === 0 ? -500 : 0 }))
    const r = accountReturn(balances, transfers, '2030-07')!
    expect(r.gain).toBe(0)
    expect(r.annualRate).toBeCloseTo(0, 9)
  })

  it('takes the latest unbroken run of months with a balance and deposits entered', () => {
    const balances = [{ month: '2030-01', value: 1000 }, ...months(8).map(m => ({ month: m, value: 1000 }))]
    // 2030-04 has no deposits entered: the run starts after it, from the 2030-04 balance
    const transfers = months(8).filter(m => m !== '2030-04').map(m => ({ month: m, amount: 0 }))
    expect(accountReturn(balances, transfers, '2030-09')).toMatchObject({ months: 5, firstMonth: '2030-05' })
  })

  it('fewer than six months: the gain only; nothing entered for the last closed month: nothing', () => {
    const balances = [{ month: '2030-01', value: 1000 }, ...months(3).map(m => ({ month: m, value: 1030 }))]
    const transfers = months(3).map(m => ({ month: m, amount: 0 }))
    expect(accountReturn(balances, transfers, '2030-04')).toMatchObject({ months: 3, gain: 30, annualRate: null })
    expect(accountReturn(balances, transfers, '2030-05')).toBeNull()
    expect(accountReturn(balances, [], '2030-04')).toBeNull()
  })

  it('no money ever in: no rate', () => {
    const balances = months(6).map(m => ({ month: m, value: 0 }))
    expect(accountReturn(balances, months(6).map(m => ({ month: m, amount: 0 })), '2030-07')).toMatchObject({ gain: 0, annualRate: null })
  })

  it('a falling balance gives a negative annual rate', () => {
    const balances = [{ month: '2030-01', value: 1000 }, ...months(12).map((m, i) => ({ month: m, value: 1000 * 0.8 ** ((i + 1) / 12) }))]
    expect(accountReturn(balances, months(12).map(m => ({ month: m, amount: 0 })), '2031-01')!.annualRate).toBeCloseTo(-0.2, 6)
  })

  it('everything lost: no rate, since no rate above −99% a month fits', () => {
    const balances = [{ month: '2030-01', value: 1000 }, ...months(6).map(m => ({ month: m, value: 0 }))]
    expect(accountReturn(balances, months(6).map(m => ({ month: m, amount: 0 })), '2030-07')).toMatchObject({ gain: -1000, annualRate: null })
  })

  it('exactly six months are enough for the annual rate', () => {
    const balances = [{ month: '2030-01', value: 1000 }, ...months(6).map((m, i) => ({ month: m, value: 1000 * 1.1 ** ((i + 1) / 12) }))]
    expect(accountReturn(balances, months(6).map(m => ({ month: m, amount: 0 })), '2030-07')!.annualRate).toBeCloseTo(0.1, 6)
  })

  it('a month without a balance before the run: the run starts after it, not from zero as if the account were new', () => {
    // 2030-02 has no balance; 2030-03 has one but nothing before it to start from, so the run is 2030-04…2030-09
    const balances = [{ month: '2030-01', value: 1000 }, ...months(8).filter(m => m !== '2030-02').map(m => ({ month: m, value: 1000 }))]
    const transfers = months(8).filter(m => m !== '2030-02').map(m => ({ month: m, amount: 0 }))
    expect(accountReturn(balances, transfers, '2030-09')).toMatchObject({ months: 6, firstMonth: '2030-04', gain: 0 })
  })
})
