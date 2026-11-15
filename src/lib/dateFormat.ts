import { currentLanguage } from '../i18n/client'
import { isDateFormat, type DateFormat } from '../domain/dateFormat'

let selected: DateFormat | null = null
export const currentDateFormat = () => selected
export const currentDatePattern = () => selected ?? currentLanguage()
export function applyDateFormat(value: unknown) {
  selected = isDateFormat(value) ? value : null
}
