// A free source's month: the lines of a card or cash that is not an account, by category, amount and currency (the
// Breakdown screen's "Other sources"). Saving replaces the source's whole month.
import { useId, useState } from 'react'
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { SpendingRecords } from '../../domain/api'
import { monthOf } from '../../domain/dates'
import { prevFinishedMonth } from '../../domain/monthClose'
import type { SpendingCategory } from '../../domain/types'
import { useToast } from '../../lib/notifyState'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { amountText, parseAmount } from '../../pages/admin/amount'
import { UNREAD_DATE } from '../../pages/admin/dateMask'
import { withCurrent } from '../../pages/admin/shared'
import { AmountInput } from '../../pages/admin/ui/AmountInput'
import { Field } from '../../pages/admin/ui/Field'
import { FormDialog } from '../../pages/admin/ui/FormDialog'
import { MonthInput } from '../../pages/admin/ui/MonthInput'
import { Select } from '../../pages/admin/ui/Select'
import { useCategoryTitle } from './spendingWrites'

const P = 'modules.cashflow.spending'

const NAME_LIMIT = 60
/** A line of the month window; `id` is its own (a removed line must not hand its field's state to the next one) */
interface Line { id: number; category: string; amount: string; currency: string }
export type Source = SpendingRecords['sources'][number]
export type SourceItem = Source['items'][number]
let lastLineId = 0
const makeLine = (category: string, amount: string, currency: string): Line => ({ id: ++lastLineId, category, amount, currency })

/**
 * One source's expense lines for one month: category, amount and currency. Saving replaces the source's whole month, so a
 * month and source that already have totals load their lines (and it says so): what the window holds is what stays.
 */
export function SourceDialog({ ready, categories, currencies, currency, entries, edit, month: startMonth, onSave, onCancel }: {
  ready: boolean
  categories: SpendingCategory[]
  currencies: string[]
  currency: string
  entries: Source[]
  /** The source being edited; none — a new entry */
  edit: Source | null
  /** The month a new entry starts on (YYYY-MM), when the person has chosen it already */
  month?: string
  /** `base` — the stored lines the window started from (none for a new entry): the server refuses the save when they changed */
  onSave: (ym: string, source: string, items: SourceItem[], base: SourceItem[]) => Promise<boolean>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const title = useCategoryTitle()
  const sourcesId = useId()
  const emptyLine = () => makeLine(String((categories.find(c => c.kind !== 'loan_payment') ?? categories[0])?.id ?? ''), '', currency)
  const entryFor = (iso: string, name: string) => {
    const ym = iso && iso !== UNREAD_DATE ? monthOf(iso) : ''
    return ym ? entries.find(e => e.month === ym && e.source === name.trim()) : undefined
  }
  const linesOf = (e: Source) => e.items.map(i => makeLine(String(i.categoryId), amountText(i.amount), i.currency))
  const [month, setMonth] = useState(edit ? `${edit.month}-01` : startMonth ? `${startMonth}-01` : '')
  const [source, setSource] = useState(edit?.source ?? '')
  const [lines, setLines] = useState<Line[]>(() => (edit && edit.items.length > 0 ? linesOf(edit) : [emptyLine()]))
  const existing = entryFor(month, source)
  const patch = (id: number, change: Partial<Line>) => setLines(ls => ls.map(l => (l.id === id ? { ...l, ...change } : l)))

  /** What a loaded entry replaced: the lines before it and the ones loaded, to give the first back if the match is lost untouched */
  const [prefill, setPrefill] = useState<{ before: Line[]; loaded: Line[] } | null>(null)
  /** The saved entry whose lines the window holds: the edited one, or one a month and source picked loaded */
  const [baseEntry, setBaseEntry] = useState<Source | null>(edit)
  const sameLines = (x: Line[], y: Line[]) => x.length === y.length && x.every((l, i) => l.category === y[i].category && l.amount === y[i].amount && l.currency === y[i].currency)
  const [start] = useState({ month, source, lines })
  const dirty = month !== start.month || source !== start.source || !sameLines(lines, start.lines)
  const { confirmDiscard } = useUnsavedChanges(dirty)

  /**
   * A new month or source. If it names another saved entry, that entry's lines are loaded (the lines typed before are kept
   * aside). If it stops naming one, the lines typed before come back — unless the loaded ones were edited, then the edits stay.
   */
  function pick(nextMonth: string, nextSource: string) {
    const next = entryFor(nextMonth, nextSource)
    if (next && next !== existing) {
      const loaded = linesOf(next)
      setPrefill({ before: prefill?.before ?? lines, loaded })
      setLines(loaded)
      setBaseEntry(next)
    } else if (!next && existing && prefill) {
      if (sameLines(lines, prefill.loaded)) setLines(prefill.before)
      setPrefill(null)
      setBaseEntry(null)
    }
    setMonth(nextMonth)
    setSource(nextSource)
  }

  function submit(): Promise<boolean> | boolean {
    if (!ready) return false
    const fail = (text: string) => { toast.error(t('data.common.saveFailed'), text); return false }
    if (month === UNREAD_DATE) return fail(t('data.common.dateUnread'))
    if (!month) return fail(t(`${P}.months.needMonth`))
    // the server takes months up to the last finished one
    if (monthOf(month) > prevFinishedMonth(new Date())) return fail(t('data.common.monthNotFinished'))
    if (!source.trim()) return fail(t(`${P}.months.needSource`))
    // a line without an amount is a line not filled in
    const filled = lines.filter(l => l.amount.trim() !== '')
    if (filled.some(l => parseAmount(l.amount).invalid)) return fail(t('data.common.notNumber'))
    if (filled.length === 0) return fail(t(`${P}.months.needLine`))
    if (filled.some(l => !(l.currency || currency))) return fail(t('data.close.currencyRequired'))
    const items = filled.map(l => ({ categoryId: Number(l.category), amount: parseAmount(l.amount).value ?? 0, currency: l.currency || currency }))
    return onSave(monthOf(month), source.trim(), items, baseEntry?.items ?? [])
  }

  return (
    <FormDialog title={t(edit ? `${P}.months.editTitle` : `${P}.months.newTitle`)} description={t(`${P}.months.newText`)} submitLabel={t('data.common.save')} submitDisabled={!ready} onSubmit={submit} onCancel={onCancel} beforeCancel={dirty ? confirmDiscard : undefined}>
      <div className="form-stack">
        <Field label={t(`${P}.months.month`)}>
          <MonthInput label={t(`${P}.months.month`)} value={month} onChange={iso => pick(iso, source)} finished disabled={!!edit} />
        </Field>
        <Field label={t(`${P}.months.source`)} hint={t(`${P}.months.sourceHint`)}>
          <input className="admin-input" list={sourcesId} maxLength={NAME_LIMIT} value={source} disabled={!!edit} onChange={e => pick(month, e.target.value)} />
        </Field>
        <datalist id={sourcesId}>{[...new Set(entries.map(e => e.source))].map(s => <option key={s} value={s} />)}</datalist>
        {existing && <p className="note">{t(`${P}.months.replaceNote`)}</p>}
        {lines.map((line, i) => (
          <div key={line.id} className="spending-line" role="group" aria-label={t(`${P}.months.lineN`, { n: i + 1 })}>
            <Field label={t(`${P}.months.category`)}>
              <Select value={line.category} onChange={e => patch(line.id, { category: e.target.value })}>
                {categories.map(c => <option key={c.id} value={c.id}>{title(c)}</option>)}
              </Select>
            </Field>
            <Field label={t(`${P}.manual.amount`)}>
              <AmountInput label={t(`${P}.manual.amount`)} value={line.amount} onChange={amount => patch(line.id, { amount })} />
            </Field>
            <Field label={t('common.currency')}>
              <Select value={line.currency || currency} onChange={e => patch(line.id, { currency: e.target.value })}>
                {/* a currency that left the project stays selectable on the line that holds it */}
                {withCurrent(line.currency, currencies).map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            {lines.length > 1 && (
              <button type="button" className="icon-btn" aria-label={t('data.common.removeNamed', { name: t(`${P}.months.lineN`, { n: i + 1 }) })}
                title={t(`${P}.months.removeLine`)} onClick={() => setLines(ls => ls.filter(l => l.id !== line.id))}>
                <IconTrash size={18} stroke={2} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        <div className="form-actions form-actions--start">
          <button type="button" className="btn btn--ghost" onClick={() => setLines(ls => [...ls, emptyLine()])}>{t(`${P}.months.addLine`)}</button>
        </div>
      </div>
    </FormDialog>
  )
}
