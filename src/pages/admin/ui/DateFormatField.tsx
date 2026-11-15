import { useTranslation } from 'react-i18next'
import { DATE_FORMATS, formatDateParts, type DateFormat } from '../../../domain/dateFormat'
import { Field } from './Field'
import { Select } from './Select'

export function DateFormatField({ value, disabled, onChange }: { value: DateFormat; disabled?: boolean; onChange: (value: DateFormat) => void }) {
  const { t } = useTranslation()
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return <>
    <Field variant="inset" label={t('data.params.dateFormat')}>
      <Select value={value} disabled={disabled} onChange={event => onChange(event.target.value as DateFormat)}>
        {DATE_FORMATS.map(format => <option key={format} value={format}>{formatDateParts(iso, format)}</option>)}
      </Select>
    </Field>
  </>
}
