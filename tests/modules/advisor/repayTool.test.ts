import { describe, expect, it } from 'vitest'
import { isoDate } from '../../../src/domain/dates'
import { ADVISOR_TOOLS } from '../../../src/modules/advisor/tools/registry'
import { advisorHarness } from './harness'

interface Answer {
  loanRatePct: number; returnPct: number; currency: string; horizon: string; payments: number
  investEnd: number; repayEnd: number; diff: number; better: 'invest' | 'repay' | 'level'
  emergency: { now: number | null; after: number | null }; gaps: string[]
}

function setup() {
  const h = advisorHarness()
  // the demo family's longest loan still running
  const loan = h.db.sqlite.prepare("SELECT name, rate, currency FROM loans WHERE status = 'active' ORDER BY term_months DESC LIMIT 1").get() as { name: string; rate: number; currency: string }
  return { h, loan, ask: (over: Record<string, unknown> = {}) => h.result<Answer>('compare_early_repayment', { loan: loan.name, amount: 5000, strategy: 'reduce_term', ...over }) }
}

describe('compare_early_repayment', () => {
  it('is read-only and open to every signed-in member', () => {
    expect(ADVISOR_TOOLS.find(t => t.name === 'compare_early_repayment')).toMatchObject({ right: null })
  })

  it('weighs the loan rate against the return: level at the rate, repaying below it, investing above; with the emergency fund', async () => {
    const t = setup()
    const atRate = await t.ask({ returnPct: t.loan.rate })
    expect(atRate).toMatchObject({ loanRatePct: t.loan.rate, currency: t.loan.currency, better: 'level' })
    expect((await t.ask({ returnPct: 0 })).better).toBe('repay')
    expect((await t.ask({ returnPct: t.loan.rate + 5, strategy: 'reduce_payment' })).better).toBe('invest')
    const fallback = await t.ask()
    expect(fallback.returnPct).toBe(8)
    expect(fallback.emergency.after).not.toBeNull()
    expect(fallback.emergency.after!).toBeLessThan(fallback.emergency.now!)
  })

  it('names what is wrong: no such loan, a past date, a missing strategy, nothing left to repay', async () => {
    const t = setup()
    const refused = async (body: Record<string, unknown>, status: number, code: string) => {
      const res = await t.h.call('compare_early_repayment', { loan: t.loan.name, amount: 5000, strategy: 'reduce_term', ...body })
      expect(res.status).toBe(status)
      expect((await res.json() as { error: { code: string } }).error.code).toBe(code)
    }
    await refused({ loan: 'No such loan' }, 404, 'advisor.unknown_loan')
    await refused({ date: '2001-01-01' }, 400, 'invalid_param')
    await refused({ strategy: undefined }, 400, 'missing_param')
    await refused({ date: `${Number(isoDate(new Date()).slice(0, 4)) + 80}-01-01` }, 409, 'advisor.repay_nothing_ahead')
  })
})
