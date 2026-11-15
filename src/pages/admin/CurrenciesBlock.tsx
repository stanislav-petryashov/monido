import { useTranslation } from 'react-i18next'
import { apiSend } from '../../lib/api'
import { PARAMETER_WRITES, useAdminWrite } from './adminQuery'
import type { Currency } from './shared'
import { TagList } from './ui/TagList'
import { CurrencyCombobox } from './ui/CurrencyCombobox'

export interface CurrenciesBlockProps {
  currencies: Currency[]
  inputLabel?: string
  readOnly?: boolean
  /** The family currency: its tag comes first without "×", with balanced tag padding */
  lockedCode?: string
  lockedLabel?: string
  /** No tag has a "×", the search stays (the wizard while the family currency is unknown: a failed settings read) */
  readOnlyRemove?: boolean
}

/** The project's currencies as tags with the search that adds one: POST/DELETE /api/admin/currencies */
export function CurrenciesBlock({ currencies, inputLabel, readOnly = false, lockedCode, lockedLabel, readOnlyRemove = false }: CurrenciesBlockProps) {
  const { t } = useTranslation()
  const write = useAdminWrite(PARAMETER_WRITES)

  /** The combobox has checked the code: three Latin letters. False — the write failed, the field keeps the text */
  function addCurrency(code: string): Promise<boolean> {
    return write(() => apiSend('/api/admin/currencies', 'POST', { code }), [t('data.params.currencyAdded'), code], t('data.common.saveFailed'))
  }

  async function deleteCurrency(rowid: number) {
    await write(() => apiSend(`/api/admin/currencies/${rowid}`, 'DELETE'), t('data.params.currencyDeleted'), t('data.common.deleteFailed'))
  }

  const label = t('data.params.currencies')
  const adder = <CurrencyCombobox inputLabel={inputLabel} label={label} exclude={currencies.map(c => c.code)} onPick={addCurrency} />
  const locked = lockedCode ? currencies.filter(c => c.code === lockedCode) : []
  const remove = (key: string | number) => deleteCurrency(Number(key))
  if (!locked.length && !readOnlyRemove) {
    return <TagList label={label} tags={currencies.map(c => ({ key: c.rowid, text: c.code }))} readOnly={readOnly} onRemove={remove} adder={adder} />
  }
  const tags = [...locked, ...currencies.filter(c => c.code !== lockedCode)]
    .map(c => ({ key: c.rowid, text: c.code, note: c.code === lockedCode ? lockedLabel : undefined, fixed: readOnlyRemove || c.code === lockedCode }))
  return (
    <>
      <TagList label={label} tags={tags} readOnly={readOnly} onRemove={remove} adder={adder} />
    </>
  )
}
