import { describe, expect, it } from 'vitest'
import { accountStats } from '../../src/domain/accountStats'
import { shiftMonth } from '../../src/domain/dates'

// The demo family's series (docs/superpowers/specs/2026-11-08-accounts-mockup/accounts.js), 2023-10 … 2026-09
const LAST = '2026-09'
const monthAt = (i: number) => shiftMonth('2023-10', i)
const series = (balance: number[], income: number[] = [], expense: number[] = []) => ({
  balances: balance.map((value, i) => ({ month: monthAt(i), value })),
  flows: balance.map((_, i) => ({ month: monthAt(i), income: income[i] ?? 0, expense: expense[i] ?? 0 })),
})

const HARBORLINE = series(
  [9480, 9400, 8130, 9260, 9180, 9110, 9040, 8970, 8890, 8820, 8750, 8670, 8600, 8530, 7260, 8380, 8310, 8240, 9960, 9890, 9820, 9750, 9670, 9600, 9530, 9450, 8180, 9310, 9240, 9160, 9090, 9020, 8940, 8870, 8800, 10520],
  [6600, 6600, 9100, 6600, 6600, 6600, 6600, 6600, 6600, 6600, 6600, 6600, 6850, 6850, 9350, 6850, 6850, 6850, 6850, 6850, 6850, 6850, 6850, 6850, 7100, 7100, 9600, 7100, 7100, 7100, 7100, 7100, 7100, 7100, 7100, 7100],
  [3530, 3490, 4350, 3410, 3370, 4030, 3990, 3950, 3910, 3870, 3830, 3790, 3750, 3710, 4570, 3630, 3590, 3550, 3510, 3470, 3430, 3390, 4050, 4010, 3970, 3930, 4790, 3850, 3810, 3770, 3730, 3690, 3650, 3610, 3570, 3530],
)
const GRANITE = series([38020, 38910, 39810, 45900, 46800, 47700, 48600, 49500, 50400, 51310, 52210, 53120, 54030, 54940, 55850, 56770, 57680, 58600, 59520, 60440, 66560, 67480, 68410, 69330, 70260, 71190, 72120, 73060, 73990, 74930, 75860, 76800, 77750, 78690, 79630, 80580])
const RHEINAU = series(
  [4780, 5890, 6100, 6300, 6510, 6720, 6930, 7140, 7350, 7550, 7760, 7970, 8180, 8390, 8600, 8810, 9010, 9220, 9430, 10540, 10750, 10960, 11170, 11370, 11580, 11790, 12000, 12210, 12420, 12630, 12830, 13040, 13250, 13460, 13670, 13880],
  Array(36).fill(1120),
  [290, 280, 280, 270, 260, 900, 370, 360, 360, 350, 340, 340, 330, 320, 310, 310, 300, 930, 290, 280, 270, 270, 260, 250, 370, 360, 350, 350, 340, 970, 320, 320, 310, 300, 300, 290],
)
const stats = (s: ReturnType<typeof series>, last = LAST) => accountStats(s.balances, s.flows, last)

describe('accountStats', () => {
  it('Harborline: the 12-month range, its average, the up months and the year change', () => {
    const s = stats(HARBORLINE)
    expect(s.last).toBe(10520)
    expect(s.range).toMatchObject({ min: 8180, minMonth: '2025-12', max: 10520, maxMonth: '2026-09' })
    expect(s.range!.avg).toBeCloseTo(9176, 0)
    expect(s.upMonths12).toBe(2)
    expect(s.downMonths12).toBe(10)
    expect(s.yearChange).toBe(920)
    expect(s.yearPct).toBeCloseTo(920 / 9600 * 100)
    expect(s.monthChange).toBe(1720)
    expect(s.monthPct).toBeCloseTo(1720 / 8800 * 100)
    expect(s.hasFlows).toBe(true)
    expect(s.flows12.income).toBe(87700)
    expect(s.flows12.left).toBe(s.flows12.income - s.flows12.expense)
    expect(s.findings.map(f => f.key)).toEqual(['pages.accounts.finding.grew'])
    expect(s.findings[0].params).toEqual({ count: 2, of: 12 })
  })

  it('Granite: no flows, grew in every one of 12 months', () => {
    const s = stats(GRANITE)
    expect(s.hasFlows).toBe(false)
    expect(s.upMonths12).toBe(12)
    expect(s.findings).toEqual([{ key: 'pages.accounts.finding.grewAll', params: { count: 12, of: 12 } }])
  })

  it('Rheinau: March 2026 expense well above the 12-month average is a peak', () => {
    const peak = stats(RHEINAU).findings.find(f => f.key === 'pages.accounts.finding.expensePeak')
    expect(peak?.params).toEqual({ month: '2026-03', amount: 970, average: 381.67 })
  })

  it('the heatmap: one row per calendar year, 12 cells, the first month and the months outside the history empty', () => {
    const { heat, changes } = stats(HARBORLINE)
    expect(heat.map(h => h.year)).toEqual(['2023', '2024', '2025', '2026'])
    expect(heat.every(h => h.cells.length === 12)).toBe(true)
    expect(heat[0].cells.slice(0, 10)).toEqual(Array(10).fill(null))
    expect(heat[0].cells[10]).toEqual({ month: '2023-11', change: -80 })
    expect(heat[3].cells[8]).toEqual({ month: '2026-09', change: 1720 })
    expect(heat[3].cells.slice(9)).toEqual([null, null, null])
    expect(changes).toHaveLength(36)
    expect(changes[0]).toEqual({ month: '2023-10', change: null })
  })

  it('an account with two months: no range, no year change, no findings, no NaN', () => {
    const s = accountStats([{ month: '2026-08', value: 100 }, { month: '2026-09', value: 150 }], [], LAST)
    expect(s.range).toBeNull()
    expect(s.yearChange).toBeNull()
    expect(s.yearPct).toBeNull()
    expect(s.monthChange).toBe(50)
    expect(s.monthPct).toBe(50)
    expect(s.findings).toEqual([])
    expect(s.heat).toEqual([{ year: '2026', cells: [...Array(8).fill(null), { month: '2026-09', change: 50 }, null, null, null] }])
    expect(s.flows12).toEqual({ income: 0, expense: 0, left: 0 })
  })

  it('a gap month: its change and the next one\'s are unknown', () => {
    const s = accountStats([{ month: '2026-05', value: 100 }, { month: '2026-07', value: 130 }, { month: '2026-08', value: 120 }], [], '2026-08')
    expect(s.changes).toEqual([
      { month: '2026-05', change: null }, { month: '2026-06', change: null }, { month: '2026-07', change: null }, { month: '2026-08', change: -10 },
    ])
  })

  it('ignores months after the last closed one; an account without a row there has no current balance', () => {
    const s = stats(HARBORLINE, '2026-06')
    expect(s.last).toBe(8940)
    expect(s.changes.at(-1)?.month).toBe('2026-06')
    const closed = accountStats([{ month: '2026-01', value: 10 }], [], LAST)
    expect(closed.last).toBeNull()
    expect(closed.monthChange).toBeNull()
  })

  it('a negative balance series gets no «below average» finding', () => {
    const s = accountStats([-100, -100, -100, -100, -200].map((value, i) => ({ month: shiftMonth('2026-05', i), value })), [], LAST)
    expect(s.range!.avg).toBe(-120)
    expect(s.findings.map(f => f.key)).not.toContain('pages.accounts.finding.belowAverage')
  })

  it('a balance under 90% of its yearly average is a finding', () => {
    const s = accountStats([100, 100, 100, 100, 50].map((value, i) => ({ month: shiftMonth('2026-05', i), value })), [], LAST)
    expect(s.findings).toContainEqual({ key: 'pages.accounts.finding.belowAverage', params: { amount: 40 } })
  })
})
