// An account's lines by category for one month: what of its income and expense totals each category holds. Used by the
// Close month wizard (autosave, inside the account's row) and by the Records screen (a dialog with an explicit Save).
import { useState, type FocusEvent } from 'react'
import { IconTrash } from '@tabler/icons-react'
import { Trans, useTranslation } from 'react-i18next'
import { allocatedByFlow, allocationSummary, FLOWS_OF } from '../../domain/spending'
import { directionOf, type CategoryDirection, type CategoryFlow, type SpendingCategory } from '../../domain/types'
import { useMoney } from '../../lib/privacy'
import { Link } from '../../components/ui/Link'
import { amountText, parseAmount } from '../../pages/admin/amount'
import { AmountInput } from '../../pages/admin/ui/AmountInput'
import { Select } from '../../pages/admin/ui/Select'
import { useCategoryTitle, useStandardCategories } from './spendingWrites'

const P = 'modules.cashflow.allocation'
/** Where custom categories are added */
const RECORDS_PATH = '/cashflow/categories'

/** One line of an account: a category and an amount, in the account's currency */
export interface AllocationItem { categoryId: number; amount: number }
/** One line as typed: a category and the amount's text, which may not be a number yet */
export interface TypedLine { categoryId: number; amount: string }

export interface AllocationEditorProps {
  /** The account as the row names it: for the labels of the fields */
  account: string
  categories: SpendingCategory[]
  /** What the lines allocate (a field not filled in is null); null — no account row */
  totals: Record<CategoryFlow, number | null> | null
  /** The lines to start from: the stored ones, or the ones edited and not saved yet */
  items: readonly AllocationItem[]
  /** The lines as typed, when one held text that is not a number: the panel opens on them instead of `items` */
  typed?: readonly TypedLine[] | null
  /** The lines' sum per flow for `items`, as the server gives it; the editor sums only what is typed here */
  allocated: Record<CategoryFlow, number>
  /** The account's usual lines (the same in recent months): offered by a button in their group, never added by themselves */
  usual?: readonly AllocationItem[]
  /** autosave — every edit is told (`onChange`) and the leaving of the panel too (`onCommit`); explicit — nothing is saved by itself: a dialog around the editor saves (it reads `onChange`) */
  mode: 'autosave' | 'explicit'
  /** `base`: the stored lines the panel's own were taken from (or last saved as): a save against them is refused when the lines changed elsewhere since */
  onChange?: (items: AllocationItem[], invalid: boolean, typed: TypedLine[], base: readonly AllocationItem[]) => void
  onCommit?: () => void
  status?: 'saving' | null
  error?: string | null
  id?: string
}

/** A line being edited; `id` is its own (a removed line must not hand its field's state to the next one) */
interface Line { id: number; category: number; amount: string }
let lastLineId = 0
const lineOf = (category: number, amount: string): Line => ({ id: ++lastLineId, category, amount })

const DIRECTIONS: CategoryDirection[] = ['income', 'expense']

/** The lines filled in with a number under a category that still exists, and whether any holds text that is not one */
function read(lines: Line[], categories: SpendingCategory[]): { items: AllocationItem[]; invalid: boolean } {
  const filled = lines.filter(l => l.amount.trim() !== '' && categories.some(c => c.id === l.category))
  const parsed = filled.map(l => ({ line: l, amount: parseAmount(l.amount) }))
  return {
    items: parsed.filter(p => !p.amount.invalid && p.amount.value !== null).map(p => ({ categoryId: p.line.category, amount: p.amount.value as number })),
    invalid: parsed.some(p => p.amount.invalid),
  }
}

/** Whether two sets of lines hold the same amounts by category, in any order */
function sameItems(a: readonly AllocationItem[], b: readonly AllocationItem[]): boolean {
  const key = (items: readonly AllocationItem[]) => JSON.stringify([...items].sort((x, y) => x.categoryId - y.categoryId).map(i => [i.categoryId, i.amount]))
  return key(a) === key(b)
}

export function AllocationEditor({ account, categories, totals, items, typed, allocated, usual = [], mode, onChange, onCommit, status, error, id }: AllocationEditorProps) {
  const { t } = useTranslation()
  const money = useMoney()
  const title = useCategoryTitle()
  const { missing, addStandard } = useStandardCategories(categories)
  const offered = categories.filter(c => c.kind !== 'loan_payment')
  const [lines, setLines] = useState<Line[]>(() => (typed
    ? typed.map(l => lineOf(l.categoryId, l.amount))
    : items.map(i => lineOf(i.categoryId, amountText(i.amount)))))
  // lines from outside (Claude's, read again on focus) replace the panel's while it has not been edited; once edited, the
  // panel keeps its own and the stored lines they came from (`origin`), so a save over lines changed elsewhere is
  // refused rather than deleting them; a read that equals the panel's lines (its own save) becomes the new origin
  const [touched, setTouched] = useState(!!typed)
  const [seen, setSeen] = useState(items)
  const [origin, setOrigin] = useState(items)
  if (items !== seen) {
    setSeen(items)
    if (!touched) { setLines(items.map(i => lineOf(i.categoryId, amountText(i.amount)))); setOrigin(items) }
    else if (sameItems(read(lines, categories).items, items)) setOrigin(items)
  }
  const live = read(lines, categories)
  const sums = touched ? allocatedByFlow(live.items, categories) : allocated

  function update(next: Line[]) {
    setLines(next)
    setTouched(true)
    const { items: nextItems, invalid } = read(next, categories)
    onChange?.(nextItems, invalid, next.map(l => ({ categoryId: l.category, amount: l.amount })), origin)
  }
  const patch = (lineId: number, change: Partial<Line>) => update(lines.map(l => (l.id === lineId ? { ...l, ...change } : l)))

  // the panel is left (not a move between its own fields): the wizard saves at once instead of after the pause
  function onBlur(e: FocusEvent<HTMLDivElement>) {
    if (mode === 'autosave' && !e.currentTarget.contains(e.relatedTarget)) onCommit?.()
  }

  if (offered.length === 0) {
    return (
      <div id={id} className="allocation" role="group" aria-label={t(`${P}.label`, { account })}>
        <p className="note">{t(`${P}.noCategories`)}</p>
        <div className="form-actions form-actions--start">
          {missing.length > 0 && (
            <button type="button" className="btn btn--ghost" onClick={() => void addStandard()}>{t('modules.cashflow.spending.categories.addStandard')}</button>
          )}
        </div>
        <p className="note"><Trans i18nKey={`${P}.custom`} components={{ records: <Link to={RECORDS_PATH} className="link-accent" /> }} /></p>
      </div>
    )
  }

  return (
    <div id={id} className="allocation" role="group" aria-label={t(`${P}.label`, { account })} onBlur={onBlur}>
      {DIRECTIONS.map(direction => {
        const own = offered.filter(c => directionOf(c.flow) === direction)
        if (own.length === 0) return null
        const ids = new Set(own.map(c => c.id))
        const mine = lines.filter(l => ids.has(l.category))
        const summary = allocationSummary(sums, totals, direction)
        // income with one total filled in and the other not: "Of —" would hide the known one, so each flow says its own state
        const flows = FLOWS_OF[direction]
        const partial = totals !== null && flows.length > 1 && flows.some(f => totals[f] !== null)
        const perFlow = () => flows.map(f => {
          const flow = t(`modules.cashflow.flows.kind.${f}`)
          const total = totals?.[f] ?? null
          return total === null ? (sums[f] > 0 ? t(`${P}.flowNoTotalAllocated`, { flow, allocated: money(sums[f]) }) : t(`${P}.flowNoTotal`, { flow })) : t(`${P}.flowOf`, { flow, allocated: money(sums[f]), total: money(total) })
        }).join(' · ')
        // over a total goes first: a flow over its total while the other is not filled in still says why it is red
        const head = summary.over.length > 0
          ? summary.total === null ? t(`${P}.overNoTotal`, { allocated: money(summary.allocated) })
            : t(`${P}.over`, { total: money(summary.total), allocated: money(summary.allocated) })
          : summary.total === null ? (partial ? perFlow() : t(`${P}.noTotal`, { allocated: money(summary.allocated) }))
            : summary.rest === 0 ? t(`${P}.full`, { total: money(summary.total), allocated: money(summary.allocated) })
              : t(`${P}.of`, { total: money(summary.total), allocated: money(summary.allocated), rest: money(summary.rest ?? 0) })
        const free = own.filter(c => !mine.some(l => l.category === c.id))
        // the usual lines of this group whose category has no line yet
        const missingUsual = usual.filter(u => ids.has(u.categoryId) && !mine.some(l => l.category === u.categoryId))
        const usualText = missingUsual.map(u => `${title(own.find(c => c.id === u.categoryId)!)} ${money(u.amount)}`).join(' · ')
        const lineName = (n: number) => t(direction === 'income' ? `${P}.incomeLine` : `${P}.expenseLine`, { n })
        return (
          <div key={direction} className="allocation__group" role="group" aria-label={t(`${P}.${direction}`)}>
            <div className="allocation__head">
              <span className="allocation__title">{t(`${P}.${direction}`)}</span>
              <span className={summary.over.length > 0 ? 'allocation__summary allocation__summary--over' : 'allocation__summary'}>{head}</span>
            </div>
            {mine.map((line, i) => (
              <div key={line.id} className="allocation-line" role="group" aria-label={lineName(i + 1)}>
                <Select aria-label={`${t(`${P}.category`)}: ${lineName(i + 1)}`} value={String(line.category)} onChange={e => patch(line.id, { category: Number(e.target.value) })}>
                  {own.filter(c => c.id === line.category || !mine.some(l => l.category === c.id)).map(c => <option key={c.id} value={c.id}>{title(c)}</option>)}
                </Select>
                <div className="allocation-line__amount"><AmountInput label={`${t(`${P}.amount`)}: ${lineName(i + 1)}`} value={line.amount} onChange={amount => patch(line.id, { amount })} /></div>
                <button type="button" className="icon-btn" aria-label={t(`${P}.removeLine`)} title={t(`${P}.removeLine`)}
                  onClick={() => update(lines.filter(l => l.id !== line.id))}>
                  <IconTrash size={18} stroke={2} aria-hidden="true" />
                </button>
              </div>
            ))}
            {(free.length > 0 || missingUsual.length > 0) && (
              <div className="form-actions form-actions--start">
                {missingUsual.length > 0 && (
                  <button type="button" className="btn btn--ghost" onClick={() => update([...lines, ...missingUsual.map(u => lineOf(u.categoryId, amountText(u.amount)))])}>
                    {t(`${P}.addUsual`, { lines: usualText })}
                  </button>
                )}
                {free.length > 0 && (
                  <button type="button" className="btn btn--ghost" onClick={() => update([...lines, lineOf(free[0].id, '')])}>
                    {t(direction === 'income' ? `${P}.addIncome` : `${P}.addExpense`)}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
      {status === 'saving' && <p className="note">{t('data.common.saving')}</p>}
      {error && <p className="allocation__error" role="alert">{t(`${P}.notSaved`, { error })}</p>}
    </div>
  )
}
