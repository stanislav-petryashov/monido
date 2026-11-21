// The geometry of "Where the income went": three columns of nodes (left: where the income came from, as one stack;
// middle: where it went; right: Saved's parts and the open group's categories), the ribbons between them and where each
// label goes. Pure: the card draws what this returns. Heights are exact on one scale per column, with a floor so the
// smallest node still shows; vertical label room is reserved here, the card fits the text into the column's width.
import type { FlowNode, IncomeFlow } from '../../domain/incomeFlow'

/** The thinnest node drawn, px */
export const MIN_NODE = 2
/** Node width; the gap between middle zones; an open zone's heading; one label line; a closed group's two-line label */
const NW = 12, GAP = 24, HEAD = 30, LINE = 20, BLOCK = 40, PAD = 6
/** The narrowest run of ribbons between the left and the middle column, px */
export const RIBBON = 120
/** The height both columns share, px */
const BODY = 320

type Flow = Exclude<IncomeFlow, { problem: string }>

export interface LaidNode { key: string; x: number; y: number; w: number; h: number; level: 0 | 1 | 2 }
/** `source` and `target` are the ribbon's top and bottom at each end */
export interface LaidRibbon { from: string; to: string; d: string; source: [number, number]; target: [number, number] }
/** `y` is the label block's top and `h` its height; the card writes one line, or the large share above two (`lines: 2`) */
export interface LaidLabel { key: string; x: number; y: number; h: number; anchor: 'start' | 'end'; lines: 1 | 2 }
export interface FlowLayout { width: number; height: number; nodes: LaidNode[]; ribbons: LaidRibbon[]; labels: LaidLabel[] }

/** Heights for the amounts that sum to `height`: proportional on one scale, none below MIN_NODE */
function fit(amounts: number[], height: number): number[] {
  let small = new Set<number>()
  for (;;) {
    const rest = amounts.reduce((a, v, i) => (small.has(i) ? a : a + v), 0)
    const k = rest > 0 ? (height - small.size * MIN_NODE) / rest : 0
    const next = new Set(amounts.flatMap((v, i) => (small.has(i) || v * k < MIN_NODE ? [i] : [])))
    if (next.size === small.size) return amounts.map((v, i) => (small.has(i) ? MIN_NODE : v * k))
    small = next
  }
}

const ribbon = (x0: number, [a0, a1]: [number, number], x1: number, [b0, b1]: [number, number]): string => {
  const m = (x0 + x1) / 2, f = (v: number) => v.toFixed(1)
  return `M${f(x0)},${f(a0)}C${f(m)},${f(a0)} ${f(m)},${f(b0)} ${f(x1)},${f(b0)}L${f(x1)},${f(b1)}C${f(m)},${f(b1)} ${f(m)},${f(a1)} ${f(x0)},${f(a1)}Z`
}

type LabelRoom = { left: number; middle: number; right: number }

/** The label columns the labels want, shrunk together when the picture is narrower than them, the nodes and RIBBON */
export function fitLabels(width: number, wanted: LabelRoom): LabelRoom {
  const k = Math.min(1, (width - 3 * NW - 10 - RIBBON) / (wanted.left + wanted.middle + wanted.right))
  return k === 1 ? wanted : { left: wanted.left * k, middle: wanted.middle * k, right: wanted.right * k }
}

/** `labelWidth`: the room of the left column's labels, of the middle's (right of its nodes) and of the right column's, px */
export function layoutFlow(flow: Flow, { width, open, labelWidth }: { width: number; open: string | null; labelWidth: LabelRoom }): FlowLayout {
  const left = flow.left.filter(n => n.amount > 0)
  const right = flow.right.filter(n => n.amount > 0)
  // the middle nodes stand their labels' room left of the right column, never closer to the left one than RIBBON
  const x0 = labelWidth.left, x2 = width - labelWidth.right - NW, x1 = Math.round(Math.max(x0 + NW + RIBBON, x2 - labelWidth.middle - NW - 10))
  const nodes: LaidNode[] = [], ribbons: LaidRibbon[] = [], labels: LaidLabel[] = []

  // the middle column: one zone per node; Saved and the open group fan out to their children with a heading above
  const heights = fit(right.map(n => n.amount), BODY)
  let y = PAD
  const middle = right.map((n, i) => {
    const h = heights[i] ?? 0
    const children = n.key === 'saved' || n.key === open ? (n.children ?? []).filter(c => c.amount > 0) : []
    if (!children.length) {
      const body = Math.max(h, BLOCK)
      labels.push({ key: n.key, x: x1 + NW + 10, y: y + (body - BLOCK) / 2, h: BLOCK, anchor: 'start', lines: 2 })
      const node = { key: n.key, x: x1, y: y + (body - h) / 2, w: NW, h, level: 1 as const }
      y += body + GAP
      return { node, children: [] as FlowNode[], slots: [] as number[], fanTop: 0 }
    }
    const childH = (c: FlowNode) => Math.max(MIN_NODE, (c.amount / n.amount) * h)
    const slots = children.map(c => Math.max(childH(c), LINE + 2))
    const fan = slots.reduce((a, b) => a + b, 0) + 2 * (slots.length - 1), body = Math.max(h, fan)
    labels.push({ key: n.key, x: x1 + NW + 10, y, h: LINE, anchor: 'start', lines: 1 })
    const node = { key: n.key, x: x1, y: y + HEAD + (body - h) / 2, w: NW, h, level: 1 as const }
    const fanTop = y + HEAD + (body - fan) / 2
    y += HEAD + body + GAP
    return { node, children, slots, fanTop }
  })
  const middleBottom = y - GAP

  // the left column: one stack of BODY, centred against the middle; labels pushed down so none overlaps the one above
  const top = PAD + Math.max(0, (middleBottom - PAD - BODY) / 2)
  const leftHeights = fit(left.map(n => n.amount), BODY)
  let s = top, labelBottom = 0
  left.forEach((n, i) => {
    const h = leftHeights[i] ?? 0
    nodes.push({ key: n.key, x: x0, y: s, w: NW, h, level: 0 })
    const ly = Math.max(s + h / 2 - LINE / 2, labelBottom)
    labels.push({ key: n.key, x: x0 - 12, y: ly, h: LINE, anchor: 'end', lines: 1 })
    labelBottom = ly + LINE
    s += h
  })

  // ribbons: slices of the left stack to the middle nodes in order, then each fanned node's slices to its children
  let a = top
  for (const { node, children, slots, fanTop } of middle) {
    nodes.push(node)
    ribbons.push({ from: 'left', to: node.key, source: [a, a + node.h], target: [node.y, node.y + node.h], d: ribbon(x0 + NW, [a, a + node.h], x1, [node.y, node.y + node.h]) })
    a += node.h
    let from = node.y, cy = fanTop
    const parent = right.find(n => n.key === node.key)!
    children.forEach((c, i) => {
      const slice = (c.amount / parent.amount) * node.h, slot = slots[i] ?? 0, ch = Math.max(MIN_NODE, slice), ny = cy + (slot - ch) / 2
      // right after its parent: the node order is the Tab order
      nodes.push({ key: c.key, x: x2, y: ny, w: NW, h: ch, level: 2 })
      ribbons.push({ from: node.key, to: c.key, source: [from, from + slice], target: [ny, ny + ch], d: ribbon(x1 + NW, [from, from + slice], x2, [ny, ny + ch]) })
      labels.push({ key: c.key, x: x2 + NW + 8, y: cy + (slot - LINE) / 2, h: LINE, anchor: 'start', lines: 1 })
      from += slice
      cy += slot + 2
    })
  }

  const height = Math.ceil(Math.max(middleBottom, top + BODY, labelBottom) + PAD)
  return { width, height, nodes, ribbons, labels }
}
