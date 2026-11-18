// The "Categories" screen under Income and expenses: every account's month split by category (BreakdownBlock) first, the
// categories (income and expense) under it. Everything goes through /api/spending (the only write path of
// these tables); the data is the one query ['admin', 'spending'].
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { directionOf, type CategoryDirection, type CategoryFlow, type SpendingCategory } from '../../domain/types'
import { ApiError, apiSend } from '../../lib/api'
import { useConfirm, useToast } from '../../lib/notifyState'
import { useCan } from '../../lib/rights'
import { useUnsavedChanges } from '../../lib/useUnsavedChanges'
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote'
import { AdminReadNotice } from '../../pages/admin/ui/AdminReadNotice'
import { Field } from '../../pages/admin/ui/Field'
import { FormDialog } from '../../pages/admin/ui/FormDialog'
import { OptionPicker } from '../../pages/admin/ui/OptionPicker'
import { RowMenu } from '../../pages/admin/ui/RowMenu'
import { Select } from '../../pages/admin/ui/Select'
import { SettingsSection } from '../../pages/admin/ui/SettingsSection'
import { BreakdownBlock } from './BreakdownBlock'
import { SPENDING_BASE, spendingQuery, useCategoryTitle, useSpendingLists, useSpendingWrite, useStandardCategories } from './spendingWrites'

import '../../styles/categories.css'

const P = 'modules.cashflow.spending'
const F = 'modules.cashflow.flows'

const NAME_LIMIT = 60
const DIRECTIONS: CategoryDirection[] = ['expense', 'income']

/** What the category dialog hands back; the server reads `kind` for an expense, `flow` and `oneOff` for an income */
interface CategoryForm { name: string; direction: CategoryDirection; kind: 'mandatory' | 'optional'; flow: Exclude<CategoryFlow, 'expense'>; oneOff: boolean }

export function FlowsScreen() {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const send = useSpendingWrite()
  const canEdit = useCan('edit')
  const spending = useQuery(spendingQuery)
  const lists = useSpendingLists()
  const title = useCategoryTitle()
  const [categoryDialog, setCategoryDialog] = useState<'add' | SpendingCategory | null>(null)

  const [catalogExpanded, setCatalogExpanded] = useState(false)
  const catalogId = useId()

  const data = spending.data
  const categories = data?.categories ?? []

  const { missing, addStandard, adding } = useStandardCategories(categories)

  async function saveCategory(target: 'add' | SpendingCategory, form: CategoryForm, onDuplicate: () => void): Promise<boolean> {
    const handled = (e: unknown) => { if (e instanceof ApiError && e.code === 'category_exists') { onDuplicate(); return true }; return false }
    const name = form.name.trim()
    if (!name) { toast.error(t('data.common.saveFailed'), t(`${P}.categories.needName`)); return false }
    const income = form.direction === 'income'
    if (target === 'add') {
      const body = income ? { name, flow: form.flow, ...(form.oneOff ? { oneOff: true } : {}) } : { name, kind: form.kind }
      const saved = await send(() => apiSend(`${SPENDING_BASE}/categories`, 'POST', body), [t(`${P}.categories.added`), name], t('data.common.saveFailed'), handled)
      if (saved) setCatalogExpanded(true)
      return saved
    }
    // the flow is fixed once lines depend on it: an income category changes its name and one-off flag, an expense one its name and kind
    const body = directionOf(target.flow) === 'income' ? { name, oneOff: form.oneOff } : { name, kind: form.kind }
    return send(() => apiSend(`${SPENDING_BASE}/categories/${target.id}`, 'PATCH', body), [t(`${P}.categories.saved`), name], t('data.common.saveFailed'), handled)
  }

  async function deleteCategory(c: SpendingCategory) {
    if (!(await confirm({ title: t(`${P}.categories.deleteTitle`, { name: c.name }), text: t(`${P}.categories.deleteText`), confirmLabel: t('data.common.delete'), tone: 'danger' }))) return
    await send(() => apiSend(`${SPENDING_BASE}/categories/${c.id}`, 'DELETE'), [t(`${P}.categories.deleted`), c.name], t('data.common.deleteFailed'))
  }

  /** The kind column: an income category's flow or an expense one's kind, then "· one-off" */
  const kindText = (c: SpendingCategory) => {
    const kind = c.kind === 'loan_payment' ? t(`${F}.categories.protected`) : c.flow === 'expense' ? t(`${P}.kind.${c.kind}`) : t(`${F}.kind.${c.flow}`)
    return c.oneOff ? `${kind} · ${t(`${F}.categories.oneOff`)}` : kind
  }

  return (
    <div>
      <AdminReadNotice queries={[spending, ...lists.queries]} />
      <ViewOnlyNote right="edit" />

      {/* the recurring job first: each month's accounts split by category; the catalog under it */}
      {data && <BreakdownBlock data={data} canEdit={canEdit} />}

      {data && <SettingsSection title={t(`${P}.categories.title`)} stacked actions={canEdit && data ? <button type="button" className="btn btn--ghost" onClick={() => setCategoryDialog('add')}>{t(`${P}.categories.add`)}</button> : undefined}>
        {categories.length === 0 ? <p className="note">{t(`${P}.categories.empty`)}</p> : (
          <div id={catalogId} className={`category-catalog${catalogExpanded ? ' category-catalog--expanded' : ''}`} role="group" aria-label={t(`${P}.categories.title`)}>
            {DIRECTIONS.filter(direction => categories.some(c => directionOf(c.flow) === direction)).map(direction => {
              const group = categories.filter(c => directionOf(c.flow) === direction)
              const editable = group.filter(c => c.kind !== 'loan_payment')
              const preview = (editable.length ? editable : group).slice(0, 2)
              return (
              <section key={direction} className={`category-catalog__group category-catalog__group--${direction}`}>
                <h3 className="category-catalog__heading">{t(`${F}.direction.${direction}`)} <span className="category-catalog__count">{group.length}</span></h3>
                <ul className="category-catalog__list" aria-label={`${t(`${P}.categories.title`)}: ${t(`${F}.direction.${direction}`)}`}>
                  {group.map(c => <li key={c.id} className={`category-catalog__item${preview.includes(c) ? ' category-catalog__item--preview' : ''}${preview[0] === c ? ' category-catalog__item--first' : ''}`}>
                    <div className="category-catalog__identity"><span className="category-catalog__name">{title(c)}</span><span className="category-catalog__kind">{kindText(c)}</span></div>
                    {canEdit && c.kind !== 'loan_payment' && <RowMenu label={c.name} items={[
                      { label: t('data.common.edit'), onSelect: () => setCategoryDialog(c) },
                      { label: t('data.common.delete'), danger: true, onSelect: () => void deleteCategory(c) },
                    ]} />}
                  </li>)}
                </ul>
              </section>
            )})}
          </div>
        )}
        {categories.length > 0 && <button type="button" className="category-catalog__toggle" aria-expanded={catalogExpanded} aria-controls={catalogId} onClick={() => setCatalogExpanded(value => !value)}>{t(catalogExpanded ? `${F}.categories.collapse` : `${F}.categories.showAll`, { count: categories.length })}</button>}
        <div className="category-catalog__tools" hidden={!catalogExpanded && categories.length > 0}>
        {canEdit && data && missing.length > 0 && (
          <div className="form-actions form-actions--start">
            <button type="button" className="btn btn--ghost" disabled={adding} onClick={() => void addStandard()}>{t(`${P}.categories.addStandard`)}</button>
          </div>
        )}
        </div>
        <p className="note category-catalog__help">{t(`${P}.categories.text`)}</p>
      </SettingsSection>}


      {canEdit && categoryDialog && (
        <CategoryDialog target={categoryDialog} onSave={saveCategory} onCancel={() => setCategoryDialog(null)} />
      )}
    </div>
  )
}

/**
 * Adding a category or editing one: the name, the direction (two buttons), the kind following it (an expense's mandatory or
 * optional, an income's active or passive) and, for income, the one-off flag. On edit the direction and the income kind are
 * shown but fixed: lines already depend on them.
 */
function CategoryDialog({ target, onSave, onCancel }: {
  target: 'add' | SpendingCategory
  onSave: (target: 'add' | SpendingCategory, form: CategoryForm, onDuplicate: () => void) => Promise<boolean>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const adding = target === 'add'
  const [submitted, setSubmitted] = useState(false)
  const [duplicate, setDuplicate] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<CategoryForm>(() => adding
    ? { name: '', direction: 'expense', kind: 'mandatory', flow: 'active', oneOff: false }
    : {
      name: target.name, direction: directionOf(target.flow), oneOff: target.oneOff,
      kind: target.kind === 'optional' ? 'optional' : 'mandatory', flow: target.flow === 'passive' ? 'passive' : 'active',
    })
  const [start] = useState(form)
  const dirty = JSON.stringify(form) !== JSON.stringify(start)
  const { confirmDiscard } = useUnsavedChanges(dirty)
  const patch = (change: Partial<CategoryForm>) => setForm(f => ({ ...f, ...change }))
  const income = form.direction === 'income'
  const nameMissing = submitted && !form.name.trim()
  const nameError = nameMissing ? t(`${P}.categories.needName`) : duplicate ? t('errors.category_exists') : ''
  const submit = () => {
    setSubmitted(true)
    const submittedName = form.name.trim()
    if (!submittedName) { nameRef.current?.focus(); return false }
    return onSave(target, form, () => {
      if (nameRef.current?.value.trim() !== submittedName) return
      setDuplicate(true)
      nameRef.current.focus()
    })
  }
  return (
    <FormDialog title={t(adding ? `${P}.categories.newTitle` : `${P}.categories.editTitle`)} submitLabel={t(adding ? `${P}.categories.create` : 'data.common.save')}
      description={adding ? undefined : t(`${F}.categories.fixedHint`)} onSubmit={submit} onCancel={onCancel} beforeCancel={dirty ? confirmDiscard : undefined}>
      <div className="form-stack">
        <Field label={t('data.field.name')} error={nameError}>
          <input ref={nameRef} aria-invalid={!!nameError || undefined} className="admin-input" maxLength={NAME_LIMIT} value={form.name} onChange={e => { setDuplicate(false); patch({ name: e.target.value }) }} />
        </Field>
        <Field label={t(`${F}.categories.direction`)} group>
          <OptionPicker<CategoryDirection> options={[{ value: 'expense', label: t(`${F}.direction.expense`) }, { value: 'income', label: t(`${F}.direction.income`) }]}
            value={form.direction} onChange={direction => patch({ direction })} disabled={!adding} />
        </Field>
        {income ? (
          <>
            <Field label={t(`${F}.categories.incomeKind`)} hint={t(`${F}.categories.incomeKindHint`)}>
              <Select value={form.flow} disabled={!adding} onChange={e => patch({ flow: e.target.value as CategoryForm['flow'] })}>
                <option value="active">{t(`${F}.kind.active`)}</option>
                <option value="passive">{t(`${F}.kind.passive`)}</option>
              </Select>
            </Field>
            <div>
              <label className="switch-field">
                <input type="checkbox" className="admin-cb" checked={form.oneOff} onChange={e => patch({ oneOff: e.target.checked })} />
                {t(`${F}.categories.oneOffLabel`)}
              </label>
              <p className="field__hint">{t(`${F}.categories.oneOffHint`)}</p>
            </div>
          </>
        ) : (
          <Field label={t(`${P}.categories.kind`)} hint={t(`${P}.categories.kindHint`)}>
            <Select value={form.kind} onChange={e => patch({ kind: e.target.value as CategoryForm['kind'] })}>
              <option value="mandatory">{t(`${P}.kind.mandatory`)}</option>
              <option value="optional">{t(`${P}.kind.optional`)}</option>
            </Select>
          </Field>
        )}
      </div>
    </FormDialog>
  )
}
