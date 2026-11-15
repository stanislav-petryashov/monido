import { Fragment, useId, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import type { Valuation, ValuationChange } from '../../../domain/realEstate'
import { fmtNum, fmtPct } from '../../../lib/formatters'
import { PRIVACY_MASK, useMoney, usePrivacy } from '../../../lib/privacy'
import { parseAmount } from '../../../pages/admin/amount'
import { AmountInput } from '../../../pages/admin/ui/AmountInput'
import { Field } from '../../../pages/admin/ui/Field'
import { RowMenu } from '../../../pages/admin/ui/RowMenu'
import { CurrencyField } from './fields'
import { useSignedMoney } from './money'

type Fields = Record<string, string>

/** A stored valuation row with its change */
export type TableValuation = ValuationChange<Valuation & { rowid: number; notes: string | null }>

interface ValuationEditorProps {
  data: Fields
  setData: Dispatch<SetStateAction<Fields>>
  currencies: string[]
  saving: boolean
  submitDisabled?: boolean
  /** The valuation the typed one is compared with, and the purchase; null — no live line (an edit) */
  compare: { year: number; value: number; currency: string; price: number; priceCurrency: string } | null
  /** The value's placeholder: the last valuation */
  placeholder?: number
  saveLabel: string
  onSave: () => void
  onCancel: () => void
}

/**
 * A valuation's fields in a full-width table row: year, value with its currency inside, currency, note; with a compared
 * valuation a live line — the change against it and since purchase. Enter in a field saves, Escape cancels.
 */
export function ValuationEditor({ data, setData, currencies, saving, submitDisabled, compare, placeholder, saveLabel, onSave, onCancel }: ValuationEditorProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const money = useMoney()
  const signedMoney = useSignedMoney()
  const liveId = useId()
  const set = (f: string) => (value: string) => setData(d => ({ ...d, [f]: value }))
  const currency = data['currency'] ?? ''
  const typed = parseAmount(data['value'] ?? '').value
  const live = !compare ? null : typed === null || compare.currency !== currency
    ? t('modules.real_estate.live.last', { year: compare.year, value: money(compare.value, compare.currency) })
    : [
      t('modules.real_estate.live.change', { year: compare.year, change: signedMoney(typed - compare.value, currency), pct: compare.value ? fmtPct(((typed - compare.value) / compare.value) * 100, { sign: true }) : '' }),
      ...(compare.priceCurrency === currency ? [t('modules.real_estate.live.since', { change: signedMoney(typed - compare.price, currency) })] : []),
    ].join(' · ')
  return (
    <tr className="re-edrow">
      <td colSpan={5}>
        <div className="re-editor" onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          else if (e.key === 'Enter' && !e.defaultPrevented && e.target instanceof HTMLInputElement) { e.preventDefault(); onSave() }
        }}>
          <fieldset className="re-editor__fields" disabled={saving}>
            <Field label={t('modules.real_estate.field.year')}>
              <input className="admin-input admin-input--num" inputMode="numeric" value={data['valuation_year'] ?? ''} onChange={e => set('valuation_year')(e.target.value)} />
            </Field>
            <Field label={t('modules.real_estate.field.value')}>
              <AmountInput label={t('modules.real_estate.field.value')} unit={currency || undefined} value={data['value'] ?? ''} onChange={set('value')} autoFocus
                describedBy={live ? liveId : undefined} placeholder={placeholder === undefined ? undefined : hidden ? PRIVACY_MASK : fmtNum(placeholder, 0)} />
            </Field>
            <CurrencyField label={t('common.currency')} value={currency} currencies={currencies} onChange={set('currency')} />
            <div className="re-editor__note">
              <Field label={t('modules.real_estate.field.notes')}>
                <input className="admin-input" value={data['notes'] ?? ''} onChange={e => set('notes')(e.target.value)} />
              </Field>
            </div>
          </fieldset>
          <div className="form-actions">
            {live && <span id={liveId} className="re-editor__live" aria-live="polite">{live}</span>}
            <button type="button" className="btn btn--ghost" disabled={saving} onClick={onCancel}>{t('common.cancel')}</button>
            <button type="button" className="btn btn--primary" disabled={saving || submitDisabled} onClick={onSave}>{saveLabel}</button>
          </div>
        </div>
      </td>
    </tr>
  )
}

interface ValuationsTableProps {
  /** Newest first */
  valuations: TableValuation[]
  currency: string
  /** The new valuation's editor, drawn as the top row */
  adding: ReactNode
  /** The row being edited and its editor */
  editing: { rowid: number; editor: ReactNode } | null
  /** The row menu's actions; null — none (a viewer) */
  actions: { edit: (v: TableValuation) => void; remove: (v: TableValuation) => void } | null
}

/** «Valuations by year»: year, value, the change against the previous valuation (the first: the purchase), note, «···». */
export function ValuationsTable({ valuations, currency, adding, editing, actions }: ValuationsTableProps) {
  const { t } = useTranslation()
  const money = useMoney()
  const signedMoney = useSignedMoney()
  const titleId = useId()
  return (
    <section className="admin-panel admin-chart" aria-labelledby={titleId}>
      <div className="card-hd--row acc-card__hd">
        <h2 className="card-hd" id={titleId}>{t('modules.real_estate.valuations')}</h2>
        <span className="acc-card__meta">{t('modules.real_estate.tableMeta', { count: valuations.length, currency })}</span>
      </div>
      <div className="admin-table-scroll" role="region" aria-label={t('modules.real_estate.valuations')} tabIndex={0}>
      <table className="re-vals" role="table">
        <thead role="rowgroup">
          <tr>
            <th>{t('modules.real_estate.field.year')}</th>
            <th className="re-vals__n">{t('modules.real_estate.field.value')}</th>
            <th className="re-vals__n">{t('modules.real_estate.vsPrevious')}</th>
            <th className="re-vals__note">{t('modules.real_estate.field.notes')}</th>
            <th><span className="sr-only">{t('modules.real_estate.actions')}</span></th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {adding}
          {valuations.map(v => (editing?.rowid === v.rowid ? <Fragment key={v.rowid}>{editing.editor}</Fragment> : (
            <tr key={v.rowid} className="re-vals__row" role="row">
              <td className="re-vals__yr">{v.year}</td>
              <td className="re-vals__n num">{money(v.value, v.currency)}</td>
              <td className="re-vals__n num">
                {v.change === null ? '—' : v.againstPurchase && v.change === 0 ? <span className="re-vals__mut">{t('modules.real_estate.equalsPrice')}</span> : (
                  <>{signedMoney(v.change, v.currency)}{v.pct !== null && <span className="re-vals__mut"> {fmtPct(v.pct, { sign: true, digits: 0 })}</span>}</>
                )}
              </td>
              <td className="re-vals__note">{v.notes ?? ''}</td>
              <td className="re-vals__act">
                {actions && <RowMenu label={String(v.year)} items={[
                  { label: t('data.common.edit'), onSelect: () => actions.edit(v) },
                  { label: t('data.common.delete'), danger: true, onSelect: () => actions.remove(v) },
                ]} />}
              </td>
            </tr>
          )))}
          {valuations.length === 0 && !adding && <tr><td colSpan={5} className="admin-empty">{t('modules.real_estate.noValuations')}</td></tr>}
        </tbody>
      </table>
      </div>
    </section>
  )
}
