import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import type { FlowNode } from '../../domain/incomeFlow'

/** How the card names a node and writes its amount and share (the masking `fmt` is inside `amount`) */
export interface FlowText { name: (n: FlowNode) => string; amount: (n: FlowNode) => string; share: (n: FlowNode) => string }

const GROUPS = new Set(['mandatory', 'optional', 'interest'])
/** A group's rows: its children, with "Other" unfolded into the categories it stands for */
const rowsOf = (n: FlowNode) => (n.children ?? []).flatMap(c => c.folded ?? [c])

function Rows({ nodes, text, onOpenCategory }: { nodes: FlowNode[]; text: FlowText; onOpenCategory: (id: number) => void }) {
  const { t } = useTranslation()
  return nodes.map(n => (
    <li key={n.key} className="cf-flow__row">
      <span className="cf-flow__name">{text.name(n)}</span>
      <span className="num">{text.amount(n)}</span>
      <span className="cf-flow__share">{text.share(n)}</span>
      {n.categoryId !== undefined && n.kind === 'category'
        ? <button type="button" className="link-accent cf-flow__history" onClick={() => onOpenCategory(n.categoryId!)}>{t('cashflowPage.flow.openHistory')}</button>
        : <span />}
    </li>
  ))
}

/**
 * The flow as a list: `group` — the open group's categories under the chart; `table` — every node and category in the
 * reading table; `phone` — the ranked list of a phone (Saved and its parts, the groups opening in place, where the income
 * came from).
 */
export function FlowList({ variant, left, right, open, onToggle, text, onOpenCategory }: {
  variant: 'group' | 'table' | 'phone'
  left: FlowNode[]; right: FlowNode[]
  open: string | null; onToggle: (key: string) => void
  text: FlowText; onOpenCategory: (id: number) => void
}) {
  const { t } = useTranslation()
  const group = (n: FlowNode) => (
    <ul className="cf-flow__list" aria-label={text.name(n)}>
      <Rows nodes={rowsOf(n)} text={text} onOpenCategory={onOpenCategory} />
    </ul>
  )

  if (variant === 'group') {
    const n = right.find(x => x.key === open)
    return n ? group(n) : null
  }

  if (variant === 'table') {
    const row = (n: FlowNode, depth: number) => (
      <tr key={n.key} className={depth ? 'cf-flow__sub' : undefined}>
        <th scope="row">{text.name(n)}</th><td className="num">{text.amount(n)}</td><td className="num">{text.share(n)}</td>
      </tr>
    )
    return (
      <table className="page-table">
        <thead><tr><th scope="col">{t('cashflowPage.flow.table.where')}</th><th scope="col">{t('cashflowPage.flow.table.amount')}</th><th scope="col">{t('cashflowPage.flow.table.share')}</th></tr></thead>
        <tbody>
          <tr><th scope="rowgroup" colSpan={3}>{t('cashflowPage.flow.cameIn')}</th></tr>
          {left.map(n => row(n, 0))}
          <tr><th scope="rowgroup" colSpan={3}>{t('cashflowPage.flow.wentTo')}</th></tr>
          {right.map(n => <Fragment key={n.key}>{row(n, 0)}{(n.key === 'saved' ? n.children ?? [] : rowsOf(n)).map(c => row(c, 1))}</Fragment>)}
        </tbody>
      </table>
    )
  }

  return (
    <div className="cf-flow__phone">
      <ul className="cf-flow__list">
        {right.map(n => (
          <li key={n.key} className="cf-flow__item">
            {GROUPS.has(n.key) && n.children?.length ? (
              <button type="button" className="cf-flow__row cf-flow__toggle" aria-expanded={open === n.key} onClick={() => onToggle(n.key)}>
                <span className="cf-flow__name">{text.name(n)}</span><span className="num">{text.amount(n)}</span><span className="cf-flow__share">{text.share(n)}</span>
              </button>
            ) : (
              <div className="cf-flow__row"><span className="cf-flow__name">{text.name(n)}</span><span className="num">{text.amount(n)}</span><span className="cf-flow__share">{text.share(n)}</span></div>
            )}
            {n.key === 'saved' && <ul className="cf-flow__list"><Rows nodes={n.children ?? []} text={text} onOpenCategory={onOpenCategory} /></ul>}
            {open === n.key && group(n)}
          </li>
        ))}
      </ul>
      <h3 className="cf-flow__sub-hd">{t('cashflowPage.flow.cameIn')}</h3>
      <ul className="cf-flow__list"><Rows nodes={left} text={text} onOpenCategory={onOpenCategory} /></ul>
    </div>
  )
}
