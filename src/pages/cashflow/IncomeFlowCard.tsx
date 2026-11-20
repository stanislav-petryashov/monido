import { useId, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { FlowNode, FlowSide, IncomeFlow } from '../../domain/incomeFlow'
import { useChartFrame } from '../../components/charts/useChartFrame'
import { Link } from '../../components/ui/Link'
import { SegmentedPills } from '../../components/ui/SegmentedPills'
import { useDisclosure } from '../../components/ui/usePopover'
import { fmtMonth, fmtPct } from '../../lib/formatters'
import { FlowList, type FlowText } from './FlowList'
import { layoutFlow, RIBBON, type FlowLayout, type LaidLabel } from './flowLayout'
import { FlowTooltip } from './FlowTooltip'

interface IncomeFlowCardProps {
  /** The period's flow by source and by person (the toggle picks one) */
  flows: Record<FlowSide, IncomeFlow>
  /** The period's name, for the line of a period with nothing to show */
  periodName: string
  /** The dashboard's money, masked in privacy mode */
  fmt: (v: number) => string
  /** A phone: the ranked list, no chart */
  compact: boolean
  /** The categories screen on a month; null — a viewer, no link */
  splitTo: ((month: string) => string) | null
  /** "Open history": the category in the Expenses card */
  onOpenCategory: (id: number) => void
}

type Flow = Exclude<IncomeFlow, { problem: string }>
const GROUPS = new Set(['mandatory', 'optional', 'interest'])
/** Rough widths of one character of a label's name and of its figures, px: names are clipped to the room their column has */
const CHAR = 7.6, FIG = 6.4
const clip = (text: string, room: number) => {
  const max = Math.max(3, Math.floor(room / CHAR))
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Every node of the flow by key, the children and the folded categories included */
function nodesByKey(flow: Flow): Map<string, FlowNode> {
  const all = new Map<string, FlowNode>()
  const add = (n: FlowNode) => { all.set(n.key, n); n.children?.forEach(add); n.folded?.forEach(add) }
  ;[...flow.left, ...flow.right].forEach(add)
  return all
}

/**
 * "Where the income went" for the page's period: one sentence with what was saved and its parts, then the flow from where
 * the income came from (by source or by person) to Saved, the spending groups, loan interest and what is not split. A
 * group opens into its categories on the chart and in a list under it; every node has a tooltip on hover and focus.
 * "Table" shows every figure in the reading table; a phone gets the ranked list. A problem (a missing rate, a month whose
 * categories exceed its amounts) is said instead of a picture that would not balance.
 */
export function IncomeFlowCard({ flows, periodName, fmt, compact, splitTo, onOpenCategory }: IncomeFlowCardProps) {
  const { t } = useTranslation()
  const uid = useId().replace(/:/g, '')
  const [side, setSide] = useState<FlowSide>('source')
  const [mode, setMode] = useState<'chart' | 'table'>('chart')
  const [open, setOpen] = useState<string | null>(null)
  const [tip, setTip] = useState<string | null>(null)
  const [live, setLive] = useState('')
  const { open: whyOpen, rootRef: whyRoot, triggerRef: whyTrigger, panelId: whyPanel, triggerProps: whyProps } = useDisclosure()
  const { ref, width, scale } = useChartFrame<HTMLDivElement>(960)
  const flow = flows[side]
  const P = 'cashflowPage.flow'
  const titleId = `${uid}-title`

  const head = (
    <div className="card-hd--row cf-card__head">
      <h2 className="card-hd" id={titleId}>{t(`${P}.title`)}</h2>
    </div>
  )
  if ('problem' in flow) {
    const month = flow.problem === 'linesExceed' ? fmtMonth(flow.month) : ''
    return (
      <section className="card card--p cf-card cf-flow" aria-labelledby={titleId}>
        {head}
        {flow.problem === 'noRate'
          ? <p className="note">{t(`${P}.noRate`)}</p>
          : <p className="note">{t(`${P}.linesExceed`, { month })}{splitTo && <>{' '}<Link to={splitTo(flow.month)} className="link-accent">{t(`${P}.linesExceedFix`, { month })}</Link></>}</p>}
      </section>
    )
  }

  if (flow.total <= 0) return <section className="card card--p cf-card cf-flow" aria-labelledby={titleId}>{head}<p className="note">{t(`${P}.empty`, { period: periodName })}</p></section>

  const all = nodesByKey(flow)
  const name = (n: FlowNode): string => {
    if (n.kind === 'source' || n.kind === 'category' || n.kind === 'loan') return n.name ?? ''
    if (n.kind === 'person') return n.name || t(`${P}.node.shared`)
    if (n.kind === 'other') return t(n.key === 'other:mandatory' ? `${P}.node.otherMandatory` : `${P}.node.otherOptional`)
    return t(`${P}.node.${n.kind}`)
  }
  const pct = (n: FlowNode) => fmtPct(n.share)
  const text: FlowText = { name, amount: n => fmt(n.amount), share: pct }
  const shareOf = (n: FlowNode) => t(flow.inflows ? `${P}.shareIn` : `${P}.share`, { share: pct(n) })
  const label = (n: FlowNode) => t(GROUPS.has(n.key) ? `${P}.group` : `${P}.label`, { name: name(n), amount: fmt(n.amount), share: shareOf(n) })

  const toggle = (key: string) => {
    const next = open === key ? null : key
    setOpen(next)
    const n = all.get(key)
    if (n) setLive(t(next ? `${P}.opened` : `${P}.closed`, { name: name(n) }))
  }

  // the sentence: what was saved and its parts, or how much more was spent than earned
  const saved = flow.right.find(n => n.key === 'saved')
  const part = (key: string) => saved?.children?.find(c => c.key === key)?.amount ?? 0
  const paidDown = part('paidDown')
  const finding = flow.net < 0
    ? t(paidDown > 0 ? `${P}.findingOverspentPaid` : `${P}.findingOverspent`, { amount: fmt(-flow.net), paidDown: fmt(paidDown) })
    : t(flow.inflows ? `${P}.findingInflows` : `${P}.finding`, {
      total: fmt(flow.total), income: fmt(flow.income), saved: fmt(saved?.amount ?? 0), share: fmtPct(saved?.share ?? 0),
      stayed: fmt(part('stayed')), paidDown: fmt(paidDown), invested: fmt(part('invested')),
    })

  // Escape closes one layer: the "Why not" panel closes itself; then the tooltip; then the open group, focus staying
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || whyOpen) return
    if (tip !== null) { setTip(null); e.stopPropagation(); return }
    if (open !== null) { e.stopPropagation(); toggle(open) }
  }

  // each label column as wide as its longest label (any group may open), shrunk together when the middle needs the room
  const need = (nodes: FlowNode[]) => Math.max(120, ...nodes.map(n => name(n).length * CHAR + (fmt(n.amount).length + pct(n).length + 2) * FIG + 30))
  // a middle label: the large share, then the name over the amount (or after it, in a heading)
  const middle = Math.max(...flow.right.map(n => 92 + Math.max(name(n).length * CHAR, fmt(n.amount).length * FIG) + (n.children ? fmt(n.amount).length * FIG + 8 : 0)))
  const wanted = { left: need(flow.left), middle, right: need(flow.right.flatMap(n => n.children ?? [])) }
  const squeeze = Math.min(1, (width - 2 * 12 - 10 - RIBBON) / (wanted.left + wanted.middle + wanted.right))
  const layout = compact || mode === 'table' ? null
    : layoutFlow(flow, { width, open, labelWidth: { left: wanted.left * squeeze, middle: wanted.middle * squeeze, right: wanted.right * squeeze } })

  return (
    <section className="card card--p cf-card cf-flow" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      {head}
      <p className="cf-flow__finding">
        <span>{finding}</span>
        {flow.net >= 0 && paidDown > 0 && (
          <>{' '}<span className="explain cf-flow__why" ref={whyRoot}>
            <button ref={whyTrigger} type="button" className="link-accent cf-flow__why-btn" {...whyProps}>{t(`${P}.whyNot`, { net: fmt(flow.net) })}</button>
            {whyOpen && <span id={whyPanel} className="explain__panel" role="note">{t(`${P}.whyNotText`, { net: fmt(flow.net), paidDown: fmt(paidDown) })}</span>}
          </span></>
        )}
      </p>
      <div className="cf-flow__controls">
        <SegmentedPills items={['source', 'person'] as const} active={side} onSelect={s => { setSide(s); setTip(null) }} ariaLabel={t(`${P}.side.label`)}
          label={s => t(`${P}.side.${s}`)} />
        {!compact && <SegmentedPills items={['chart', 'table'] as const} active={mode} onSelect={setMode} ariaLabel={t(`${P}.view.label`)} label={m => t(`${P}.view.${m}`)} />}
      </div>
      <p className="sr-only" aria-live="polite">{live}</p>

      {compact
        ? <FlowList variant="phone" left={flow.left} right={flow.right} open={open} onToggle={toggle} text={text} onOpenCategory={onOpenCategory} />
        : mode === 'table'
          ? <FlowList variant="table" left={flow.left} right={flow.right} open={open} onToggle={toggle} text={text} onOpenCategory={onOpenCategory} />
          : <>
            <div className="cf-flow__plot" ref={ref}>
              {layout && <FlowChart uid={uid} layout={layout} all={all} open={open} tip={tip} setTip={setTip} toggle={toggle} name={name} amount={n => fmt(n.amount)} pct={pct} label={label} />}
              {layout && tip && all.get(tip) && (() => {
                const n = all.get(tip)!, at = layout.nodes.find(x => x.key === tip)!
                const lines = [t(`${P}.meaning.${n.kind}`), ...(n.kind.startsWith('takenFrom') && flow.newLoans.length ? [t(`${P}.newLoans`, { names: flow.newLoans.join(', ') })] : [])]
                return <FlowTooltip id={`${uid}-tip`} name={name(n)} amount={fmt(n.amount)} share={shareOf(n)} lines={lines} left={(at.x + at.w / 2) * scale} top={(at.y + at.h) * scale + 8} />
              })()}
            </div>
            <FlowList variant="group" left={flow.left} right={flow.right} open={open} onToggle={toggle} text={text} onOpenCategory={onOpenCategory} />
          </>}
    </section>
  )
}

/** The chart itself: ribbons under nodes, each node a focusable group with its label; the groups are buttons */
function FlowChart({ uid, layout, all, open, tip, setTip, toggle, name, amount, pct, label }: {
  uid: string; layout: FlowLayout; all: Map<string, FlowNode>; open: string | null; tip: string | null
  setTip: (key: string | null) => void; toggle: (key: string) => void
  name: (n: FlowNode) => string; amount: (n: FlowNode) => string; pct: (n: FlowNode) => string; label: (n: FlowNode) => string
}) {
  const { t } = useTranslation()
  const hatch = `${uid}-hatch`
  const labels = new Map(layout.labels.map(l => [l.key, l]))
  const x2 = layout.nodes.find(n => n.level === 2)?.x ?? layout.width
  const hatched = (n: FlowNode) => (n.kind === 'notSplit' || n.kind === 'notSplitSource' ? { fill: `url(#${hatch})` } : undefined)
  // a node's colour family: Saved and its parts teal, each spending group its ink grey (its categories too), the rest neutral
  const parentOf = new Map([...all.values()].flatMap(p => (p.children ?? []).map(c => [c.key, p.key] as const)))
  const toneOf = (key: string): string => {
    const top = parentOf.get(key) ?? key
    return top === 'saved' || top === 'mandatory' || top === 'optional' || top === 'interest' ? top : top === 'notSplit' ? 'notSplit' : 'income'
  }
  // the open group's ribbons: from the income to it, and from it to its categories
  const isOpen = (key: string) => open !== null && (key === open || !!all.get(open)?.children?.some(c => c.key === key))

  const text = (n: FlowNode, l: LaidLabel) => {
    if (l.lines === 2) {
      const room = x2 - l.x - 80
      return <>
        <text x={l.x} y={l.y + 28} className="cf-flow__big">{pct(n)}</text>
        <text x={l.x + 80} y={l.y + 16} className="cf-flow__lbl">{clip(name(n), room)}</text>
        <text x={l.x + 80} y={l.y + 33} className="cf-flow__fig">{amount(n)}</text>
      </>
    }
    // a middle heading (Saved, the open group): the large share, then the name and the amount on one line
    if (l.anchor === 'start' && l.x < x2) {
      return (
        <text x={l.x} y={l.y + 20} className="cf-flow__lbl">
          <tspan className="cf-flow__big">{pct(n)}</tspan><tspan dx={12}>{clip(name(n), x2 - l.x - 100 - amount(n).length * FIG)}</tspan><tspan className="cf-flow__fig" dx={8}>{amount(n)}</tspan>
        </text>
      )
    }
    const figures = `${amount(n)}  ${pct(n)}`
    // the room to the picture's edge for the left and right columns
    const room = (l.anchor === 'end' ? l.x : layout.width - l.x) - figures.length * FIG - 16
    return (
      <text x={l.x} y={l.y + 14} textAnchor={l.anchor} className="cf-flow__lbl">
        {clip(name(n), room)}<tspan className="cf-flow__fig" dx={8}>{amount(n)}</tspan><tspan className="cf-flow__fig" dx={8}>{pct(n)}</tspan>
      </text>
    )
  }

  return (
    <svg className="cf-flow__svg" viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={t('cashflowPage.flow.chart')}>
      <defs>
        <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" className="cf-flow__hatch-bg" /><rect width="2" height="5" className="cf-flow__hatch-ln" />
        </pattern>
      </defs>
      {layout.ribbons.map(r => (
        <path key={`${r.from}>${r.to}`} d={r.d} className={isOpen(r.to) ? 'cf-flow__rb is-open' : 'cf-flow__rb'} data-tone={toneOf(r.to)} aria-hidden="true" />
      ))}
      {layout.nodes.map(laid => {
        const n = all.get(laid.key)
        if (!n) return null
        const group = GROUPS.has(n.key) && !!n.children?.length
        const l = labels.get(n.key)
        return (
          <g key={n.key} className={n.key === open ? 'cf-flow__node is-open' : 'cf-flow__node'} data-key={n.key} data-level={laid.level} data-tone={toneOf(n.key)}
            tabIndex={0} role={group ? 'button' : 'img'} aria-label={label(n)} aria-expanded={group ? open === n.key : undefined}
            aria-describedby={tip === n.key ? `${uid}-tip` : undefined}
            onMouseEnter={() => setTip(n.key)} onMouseLeave={() => setTip(null)} onFocus={() => setTip(n.key)} onBlur={() => setTip(null)}
            onClick={group ? () => toggle(n.key) : undefined}
            onKeyDown={group ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(n.key) } } : undefined}>
            <rect x={laid.x} y={laid.y} width={laid.w} height={Math.max(laid.h, 1)} rx={2} className="cf-flow__bar" style={hatched(n)} />
            {l && laid.level === 0 && Math.abs(l.y + l.h / 2 - (laid.y + laid.h / 2)) > 3 && (
              <path className="cf-flow__lead" d={`M${laid.x - 2},${(laid.y + laid.h / 2).toFixed(1)}L${laid.x - 8},${(l.y + l.h / 2).toFixed(1)}`} />
            )}
            {l && text(n, l)}
          </g>
        )
      })}
    </svg>
  )
}
