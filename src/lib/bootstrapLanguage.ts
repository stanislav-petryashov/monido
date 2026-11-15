import { isLanguage, type Language } from '../i18n/languages'
import { readItem, writeItem } from './storage'

// Only the locale of this tab's new-installation password setup; never a family preference or credential.
const KEY = 'fc.bootstrapLanguage'
export function bootstrapLanguage(): Language | null {
  const value = readItem('session', KEY)
  return isLanguage(value) ? value : null
}
export function carryBootstrapLanguage(language: Language): void {
  writeItem('session', KEY, language)
}
export function clearBootstrapLanguage(): void {
  writeItem('session', KEY, null)
}
