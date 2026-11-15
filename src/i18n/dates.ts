import type { Translate } from './core'

// Month names come from the locale files, not Intl: Russian needs its own grammatical cases

const monthIndex = (yearMonth: string) => Number(yearMonth.slice(5, 7))

/** 'YYYY-MM' → 'May 2026' */
export function monthTitle(t: Translate, ym: string): string {
  return `${t(`dates.month.${monthIndex(ym)}`)} ${ym.slice(0, 4)}`
}

/** 'YYYY-MM' → 'in May' */
export function inMonth(t: Translate, ym: string): string {
  return t(`dates.inMonth.${monthIndex(ym)}`)
}

/** 'YYYY-MM-DD' → 'November 1' */
export function dayOfMonth(t: Translate, date: string): string {
  return t('dates.dayOfMonth', { day: Number(date.slice(8, 10)), month: t(`dates.monthOf.${monthIndex(date)}`) })
}

/** 1..12 → 'Jan'..'Dec' */
export function monthShort(t: Translate, month: number): string {
  return t(`dates.monthShort.${month}`)
}
