import { describe, expect, it } from 'vitest'
import { cashflowPeriodView } from '../../../src/domain/cashflowPeriod'
import { incomeFlow, type FlowNode, type IncomeFlow } from '../../../src/domain/incomeFlow'
import { layoutFlow, MIN_NODE, type FlowLayout } from '../../../src/pages/cashflow/flowLayout'
import { demoFamilyData } from '../../helpers/demoFamily'

const { snapshot } = await demoFamilyData()
type Flow = Exclude<IncomeFlow, { problem: string }>
const flowOf = (kind: 'month' | 'year' | 'all'): Flow => {
  const f = incomeFlow(cashflowPeriodView(snapshot, kind, null)!, snapshot.flowExtras ?? [], { spending: snapshot.spending.months, income: snapshot.income.months }, 'source')
  if ('problem' in f) throw new Error(f.problem)
  return f
}
const YEAR = flowOf('year')
const level = (l: FlowLayout, n: 0 | 1 | 2) => l.nodes.filter(x => x.level === n)
const total = (nodes: { h: number }[]) => nodes.reduce((a, n) => a + n.h, 0)

describe.each([960, 600])('layoutFlow at %ipx', width => {
  const opts = { width, labelWidth: width >= 960 ? { left: 220, middle: 220, right: 240 } : { left: 150, middle: 160, right: 150 } }

  it('left and right columns have equal total heights', () => {
    for (const kind of ['month', 'year', 'all'] as const) {
      const l = layoutFlow(flowOf(kind), { ...opts, open: null })
      expect(total(level(l, 0))).toBeCloseTo(total(level(l, 1)), 6)
    }
  })

  it('a node’s height is its amount on the column’s one scale; the smallest still show', () => {
    const l = layoutFlow(YEAR, { ...opts, open: null })
    for (const n of [0, 1] as const) {
      const nodes = level(l, n).map(x => ({ ...x, amount: [...YEAR.left, ...YEAR.right].find(f => f.key === x.key)!.amount }))
      const scaled = nodes.filter(x => x.h > MIN_NODE)
      const k = scaled[0]!.h / scaled[0]!.amount
      for (const x of scaled) expect(Math.abs(x.h - x.amount * k), x.key).toBeLessThan(1)
      for (const x of nodes) expect(x.h, x.key).toBeGreaterThanOrEqual(MIN_NODE)
    }
  })

  it('labels never overlap, with each group opened in turn, and stay inside the picture', () => {
    for (const open of [null, 'mandatory', 'interest', 'optional']) {
      const l = layoutFlow(YEAR, { ...opts, open })
      const columns = Map.groupBy(l.labels, x => `${x.x}:${x.anchor}`)
      for (const labels of columns.values()) {
        const sorted = [...labels].sort((a, b) => a.y - b.y)
        for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.y, `${open} ${sorted[i]!.key}`).toBeGreaterThanOrEqual(sorted[i - 1]!.y + sorted[i - 1]!.h)
      }
      for (const x of l.labels) {
        expect(x.y, x.key).toBeGreaterThanOrEqual(0)
        expect(x.y + x.h, x.key).toBeLessThanOrEqual(l.height)
      }
    }
  })

  it('Saved always shows its parts; the open group shows its categories, the others none', () => {
    const l = layoutFlow(YEAR, { ...opts, open: 'optional' })
    const optional = YEAR.right.find(n => n.key === 'optional')!
    const saved = YEAR.right.find(n => n.key === 'saved')!
    expect(level(l, 2).map(n => n.key)).toEqual([...saved.children!, ...optional.children!].map(n => n.key))
  })

  it('the open group’s ribbons fill its node, slice after slice', () => {
    const l = layoutFlow(YEAR, { ...opts, open: 'mandatory' })
    const node = l.nodes.find(n => n.key === 'mandatory')!
    const ribbons = l.ribbons.filter(r => r.from === 'mandatory')
    expect(ribbons).toHaveLength(YEAR.right.find(n => n.key === 'mandatory')!.children!.length)
    expect(ribbons[0]!.source[0]).toBeCloseTo(node.y, 6)
    for (let i = 1; i < ribbons.length; i++) expect(ribbons[i]!.source[0]).toBeCloseTo(ribbons[i - 1]!.source[1], 6)
    expect(ribbons.at(-1)!.source[1]).toBeCloseTo(node.y + node.h, 6)
  })

  it('every right node gets one ribbon from the left stack, and they fill it', () => {
    const l = layoutFlow(YEAR, { ...opts, open: null })
    const fromLeft = l.ribbons.filter(r => r.from === 'left')
    expect(fromLeft.map(r => r.to)).toEqual(YEAR.right.map(n => n.key))
    const left = level(l, 0)
    expect(fromLeft[0]!.source[0]).toBeCloseTo(left[0]!.y, 6)
    expect(fromLeft.at(-1)!.source[1]).toBeCloseTo(left.at(-1)!.y + left.at(-1)!.h, 6)
  })

  it('a zero node is absent', () => {
    const zero: FlowNode = { key: 'takenFromAccounts', kind: 'takenFromAccounts', name: null, amount: 0, share: 0 }
    const l = layoutFlow({ ...YEAR, left: [...YEAR.left, zero] }, { ...opts, open: null })
    expect(l.nodes.some(n => n.key === 'takenFromAccounts')).toBe(false)
    expect(l.labels.some(n => n.key === 'takenFromAccounts')).toBe(false)
  })
})
