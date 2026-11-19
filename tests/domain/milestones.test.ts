import { milestones, periodMilestones, type MilestoneMonth } from '../../src/domain/milestones'
import type { Milestone } from '../../src/domain/types'
import type { ChangePair, ChangeRowKey, MonthChange, MonthChangeGap } from '../../src/domain/types'

interface Opts {
  netWorth?: number | null; start?: number; fund?: number | null; expense?: number | null
  rows?: Partial<Record<ChangeRowKey, number>>; form?: MonthChange['form']; pairs?: ChangePair[]
  gap?: boolean; complete?: boolean; source?: MilestoneMonth['source']; loans?: Record<string, number>
}
// A complete month of the wizard, its change tracked; netWorth defaults to start + the rows
function m(month: string, o: Opts = {}): MilestoneMonth {
  const rows = o.rows ?? { saved: 0, debtPaid: 0, investments: 0, fx: 0, property: 0, unexplained: 0 }
  const start = o.start ?? 0
  const end = o.netWorth ?? start + Object.values(rows).reduce((a, b) => a + (b ?? 0), 0)
  const change: MonthChange | MonthChangeGap = o.gap
    ? { month, reason: 'no_balance' }
    : { month, form: o.form ?? 'tracked', start, end, rows, items: {}, pairs: o.pairs ?? [], candidates: [], rates: [] }
  return {
    month, source: o.source ?? 'wizard', complete: o.complete ?? true, netWorth: o.netWorth === undefined ? end : o.netWorth,
    fundMonths: o.fund ?? null, expensePerMonth: o.expense ?? null, change, loanBalances: o.loans ?? {},
  }
}
const run = (months: MilestoneMonth[], loans: { name: string; closedDate: string | null }[] = []) => milestones({ months, loans, currency: 'RUB' })
const kinds = (r: ReturnType<typeof run>) => r.milestones.map(x => `${x.month} ${x.kind} ${x.level ?? x.params.name ?? ''}`)

describe('milestones', () => {
  it('first month fires nothing', () => {
    expect(run([m('2026-01', { fund: 7, netWorth: 1_200_000 })]).milestones).toEqual([])
  })

  it('loan paid off once, at the earliest of balance 0 and closed_date', () => {
    const r = run([m('2026-01', { loans: { Car: 5000 } }), m('2026-02', { loans: { Car: 5000 } }), m('2026-03', { loans: { Car: 0 } }), m('2026-04')],
      [{ name: 'Car', closedDate: '2026-04-10' }])
    expect(kinds(r)).toEqual(['2026-03 loanPaidOff Car'])
    expect(r.milestones[0].params).toEqual({ name: 'Car' })
  })

  it('closed_date in an open or gap month fires in the first closed month after it', () => {
    const r = run([m('2026-01', { loans: { Car: 5000 } }), m('2026-03')], [{ name: 'Car', closedDate: '2026-02-15' }])
    expect(kinds(r)).toEqual(['2026-03 loanPaidOff Car'])
  })

  it('a refinancing is not a payoff', () => {
    const r = run([m('2026-01', { loans: { Car: 5000 } }), m('2026-02', { pairs: [{ kind: 'newLoan', name: 'Car 2', amount: -5000 }] })],
      [{ name: 'Car', closedDate: '2026-02-05' }])
    expect(r.milestones).toEqual([])
  })

  it('loan payoff in a partial month still fires', () => {
    const r = run([m('2026-01', { loans: { Car: 5000 } }), m('2026-02', { complete: false, gap: true })], [{ name: 'Car', closedDate: '2026-02-05' }])
    expect(kinds(r)).toEqual(['2026-02 loanPaidOff Car'])
  })

  it('a loan closed in the first month of history is lost', () => {
    expect(run([m('2026-01'), m('2026-02')], [{ name: 'Car', closedDate: '2026-01-05' }]).milestones).toEqual([])
  })

  describe('emergency fund', () => {
    const saved = { saved: 100 }
    it('the first known value fires nothing and uses up the levels at or below it', () => {
      expect(run([m('2026-01'), m('2026-02', { fund: 6.5, rows: saved }), m('2026-03', { fund: 7, rows: saved })]).milestones).toEqual([])
    })
    it('a first value equal to a level leaves it to be passed', () => {
      expect(kinds(run([m('2026-01'), m('2026-02', { fund: 3, rows: saved }), m('2026-03', { fund: 3.5, rows: saved })]))).toEqual(['2026-03 emergencyFund 3'])
    })
    it('fires strictly above the level', () => {
      const r = run([m('2026-01'), m('2026-02', { fund: 2, rows: saved }), m('2026-03', { fund: 3.0, rows: saved }), m('2026-04', { fund: 3.01, rows: saved })])
      expect(kinds(r)).toEqual(['2026-04 emergencyFund 3'])
      expect(r.milestones[0].params).toEqual({ months: 3 })
    })
    it('needs a positive saving', () => {
      expect(run([m('2026-01'), m('2026-02', { fund: 2, rows: saved }), m('2026-03', { fund: 4, rows: { saved: -100 } })]).milestones).toEqual([])
    })
    it('a level passed in a month without saving is used up, not fired later', () => {
      expect(run([m('2026-01'), m('2026-02', { fund: 5, rows: saved }), m('2026-03', { fund: 6.5, rows: { saved: -100 } }), m('2026-04', { fund: 6.4, rows: saved })]).milestones).toEqual([])
    })
    it('fires once', () => {
      const r = run([m('2026-01'), m('2026-02', { fund: 2, rows: saved }), m('2026-03', { fund: 3.5, rows: saved }), m('2026-04', { fund: 2.5, rows: saved }), m('2026-05', { fund: 3.5, rows: saved })])
      expect(kinds(r)).toEqual(['2026-03 emergencyFund 3'])
    })
    it('a jump fires the highest level', () => {
      expect(kinds(run([m('2026-01'), m('2026-02', { fund: 2, rows: saved }), m('2026-03', { fund: 7, rows: saved })]))).toEqual(['2026-03 emergencyFund 6'])
    })
  })

  describe('added this year', () => {
    const year = (y: number) => [
      m(`${y}-01`, { expense: 1000, rows: { saved: 5000 } }),
      m(`${y}-02`, { expense: 1000, rows: { saved: 2000 } }),
      m(`${y}-03`, { expense: 1000, rows: { saved: 1000 } }),
    ]
    it('counts months of expenses, never in January, from the third tracked month', () => {
      const r = run([m('2025-12'), ...year(2026)])
      expect(kinds(r).filter(k => k.includes('addedThisYear'))).toEqual(['2026-03 addedThisYear 6'])
      expect(r.milestones.find(x => x.kind === 'addedThisYear')!.params).toEqual({ months: 6 })
    })
    it('resets each year', () => {
      const r = run([m('2025-12'), ...year(2026), ...year(2027)])
      expect(kinds(r).filter(k => k.includes('addedThisYear'))).toEqual(['2026-03 addedThisYear 6', '2027-03 addedThisYear 6'])
    })
  })

  it('a balances-form month adds nothing', () => {
    const r = run([m('2026-01', { netWorth: 512_000 }), m('2026-02', { start: 512_000, form: 'balances', rows: { accounts: 95_000, debtPaid: 5000 }, expense: 1000 })])
    expect(r.milestones).toEqual([])
    expect(r.crossings).toEqual([{ month: '2026-02', level: 600_000, currency: 'RUB' }])
  })

  describe('net worth marks', () => {
    it('fires when the family carried it', () => {
      const r = run([m('2026-01', { netWorth: 512_000 }), m('2026-02', { start: 512_000, rows: { saved: 90_000, fx: 10_000 } })])
      expect(r.milestones).toMatchObject([{ month: '2026-02', kind: 'netWorthMark', level: 600_000, params: { amount: 600_000 }, currency: 'RUB' }])
      expect(r.crossings).toEqual([])
    })
    it('markets carried it: a crossing fact, and the level is used up', () => {
      const r = run([
        m('2026-01', { netWorth: 590_000 }),
        m('2026-02', { start: 590_000, rows: { saved: 1000, fx: 19_000 } }),
        m('2026-03', { start: 610_000, rows: { saved: 0, fx: -30_000 } }),
        m('2026-04', { start: 580_000, rows: { saved: 40_000 } }),
      ])
      expect(r.milestones).toEqual([])
      expect(r.crossings).toEqual([{ month: '2026-02', level: 600_000, currency: 'RUB' }])
    })
    it('out of the red', () => {
      const up = run([m('2026-01', { netWorth: -50_000 }), m('2026-02', { start: -50_000, rows: { saved: 60_000 } })])
      expect(up.milestones).toMatchObject([{ kind: 'netWorthMark', level: 0, params: { amount: 0 } }])
      expect(run([m('2026-01', { netWorth: -50_000 }), m('2026-02', { start: -50_000, rows: { saved: 40_000 } })]).milestones).toEqual([])
    })
    it('reaching exactly zero is not out of the red; the month above it is', () => {
      const r = run([m('2026-01', { netWorth: -100 }), m('2026-02', { start: -100, rows: { saved: 100 } }), m('2026-03', { start: 0, rows: { saved: 50 } })])
      expect(kinds(r)).toEqual(['2026-03 netWorthMark 0'])
    })
    it('a history that starts above marks fires none of them', () => {
      const r = run([m('2026-01', { netWorth: 900_000 }), m('2026-02', { start: 900_000, rows: { saved: -400_000 } }), m('2026-03', { start: 500_000, rows: { saved: 350_000 } })])
      expect(r.milestones).toEqual([])
    })
    it('a dip and a new high pass no mark the family already passed', () => {
      const r = run([
        m('2026-01', { netWorth: 950_000 }), m('2026-02', { start: 950_000, rows: { saved: 70_000 } }),
        m('2026-03', { start: 1_020_000, rows: { saved: -120_000 } }), m('2026-04', { start: 900_000, rows: { saved: 250_000 } }),
      ])
      expect(kinds(r)).toEqual(['2026-02 netWorthMark 1000000'])
    })
    it('a jump across a decade names the round mark it passed', () => {
      expect(kinds(run([m('2026-01', { netWorth: 90_000 }), m('2026-02', { start: 90_000, rows: { saved: 1_160_000 } })]))).toEqual(['2026-02 netWorthMark 1000000'])
    })
    it('at most one net-worth mark a calendar year; the later ones are facts', () => {
      const months = [m('2025-12', { netWorth: 120_000 }), ...Array.from({ length: 6 }, (_, i) => m(`2026-0${i + 1}`, { start: 120_000 + 60_000 * i, rows: { saved: 60_000 } }))]
      const r = run(months)
      // 120 000 + 60 000 a month passes 200 000 in February, 300 000 in March, 400 000 in May
      expect(kinds(r).filter(k => k.includes('netWorthMark'))).toEqual(['2026-02 netWorthMark 200000'])
      expect(r.crossings.map(c => c.level)).toEqual([300_000, 400_000])
    })
    it('a crossing over a partial month is a fact', () => {
      const r = run([m('2026-01', { netWorth: 590_000 }), m('2026-02', { complete: false, gap: true, netWorth: null }), m('2026-03', { gap: true, netWorth: 610_000 })])
      expect(r.milestones).toEqual([])
      expect(r.crossings).toEqual([{ month: '2026-03', level: 600_000, currency: 'RUB' }])
    })
  })

  it('one headline per month by priority', () => {
    const r = run([m('2026-01', { loans: { Car: 5000 } }), m('2026-02', { fund: 2, rows: { saved: 100 }, loans: { Car: 5000 } }), m('2026-03', { fund: 4, rows: { saved: 100 }, loans: { Car: 0 } })])
    expect(r.milestones.map(x => [x.kind, x.headline])).toEqual([['loanPaidOff', true], ['emergencyFund', false]])
  })

  it('import and migration months are not celebrated', () => {
    const r = run([m('2026-01', { loans: { Car: 5000 } }), m('2026-02', { loans: { Car: 0 }, source: 'import' })])
    expect(r.milestones).toMatchObject([{ kind: 'loanPaidOff', celebrated: false }])
  })

  it('no flows: only a payoff can appear', () => {
    const balances = (month: string, start: number, accounts: number, loans: Record<string, number>) =>
      m(month, { start, form: 'balances', rows: { accounts, debtPaid: 0 }, loans })
    const r = run([balances('2026-01', 0, 500_000, { Car: 5000 }), balances('2026-02', 500_000, 200_000, { Car: 5000 }), balances('2026-03', 700_000, 400_000, { Car: 0 })])
    expect(kinds(r)).toEqual(['2026-03 loanPaidOff Car'])
  })
})

describe('periodMilestones', () => {
  const ms = (month: string, kind: Milestone['kind'], level?: number, celebrated = true): Milestone =>
    ({ month, kind, level, params: level ? { months: level } : { name: 'Car loan' }, headline: true, celebrated })
  const all = [ms('2025-09', 'addedThisYear', 6), ms('2025-03', 'addedThisYear', 3), ms('2025-05', 'loanPaidOff'), ms('2025-07', 'loanPaidOff', undefined, false), ms('2026-02', 'emergencyFund', 3)]
  it('keeps the celebrated milestones of the period, oldest first, the highest added-this-year level of each year', () => {
    const year = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`)
    expect(periodMilestones(all, year).map(m => `${m.month} ${m.kind}`)).toEqual(['2025-05 loanPaidOff', '2025-09 addedThisYear'])
  })
  it('filters by the period first: a quarter keeps its own level', () => {
    expect(periodMilestones(all, ['2025-01', '2025-02', '2025-03']).map(m => m.level)).toEqual([3])
  })
})
