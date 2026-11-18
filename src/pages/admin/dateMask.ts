import { isDateFormat } from '../../domain/dateFormat'

type Part = 'd' | 'm' | 'y'

/**
 * What a date or month field gives while its text is not empty and cannot be read (cut short, or no such day): not '',
 * which would erase a stored date. A form holding it is not saved (hasUnreadDate).
 */
export const UNREAD_DATE = 'unread-date'

/** True when a field of the form holds UNREAD_DATE: the form is not saved until the date is finished or cleared. */
export const hasUnreadDate = (data: Record<string, unknown>): boolean => Object.values(data).includes(UNREAD_DATE)

/** The order of day, month and year in `locale` and its separator (ru-RU: d.m.y, en-US: m/d/y), read from Intl. */
export function datePattern(locale: string): { order: Part[]; sep: string } {
  if (isDateFormat(locale)) return { order: [...locale] as Part[], sep: '.' }
  const parts = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(Date.UTC(2000, 0, 2)))
  const order: Part[] = []
  for (const p of parts) {
    if (p.type === 'day') order.push('d')
    else if (p.type === 'month') order.push('m')
    else if (p.type === 'year') order.push('y')
  }
  return { order, sep: parts.find(p => p.type === 'literal')?.value.trim() || '/' }
}

const MAX_LENGTH: Record<Part, number> = { d: 2, m: 2, y: 4 }

/** The parts a field of kind `parts` holds, in the order of `locale`. */
function fieldOrder(locale: string, parts: 'dmy' | 'my'): { order: Part[]; sep: string } {
  const { order, sep } = datePattern(locale)
  return { order: parts === 'my' ? order.filter(p => p !== 'd') : order, sep }
}

/**
 * Typed or pasted text as a date display: digits only, the locale's separators inserted, a one-digit day or month
 * zero-padded once a separator follows it. `forward` (text was inserted, not deleted) also appends the separator after a
 * complete day or month. An ISO paste ("2014-03-15") becomes the locale's order. `parts` 'my' is a month field.
 */
export function maskDate(typed: string, locale: string, forward: boolean, parts: 'dmy' | 'my'): string {
  const { order, sep } = fieldOrder(locale, parts)
  const iso = /^\s*(\d{4})-(\d{1,2})(?:-(\d{1,2}))?\s*$/.exec(typed)
  if (iso && (parts === 'my' || iso[3] !== undefined)) {
    const values: Record<Part, string> = { y: iso[1], m: iso[2].padStart(2, '0'), d: (iso[3] ?? '').padStart(2, '0') }
    return order.map(p => values[p]).join(sep)
  }
  const groups: string[] = []
  let current = ''
  let ended = false // the last group was closed by a typed separator
  // a part closed by a separator before it was full: the text may be in another order than the field's
  let short = false
  const close = (): void => {
    const part = order[groups.length]
    if (current.length < MAX_LENGTH[part]) short = true
    groups.push(part !== 'y' && current.length === 1 ? `0${current}` : current)
    current = ''
  }
  // digits past a full date: one typed past the end is dropped, but after a part closed short they are kept on the last
  // part, so the field reads as unfinished rather than as another date ("15.03.2024" in a year-first field is not 2015-03-20)
  let surplus = ''
  for (const ch of typed) {
    if (/\d/.test(ch)) {
      if (groups.length === order.length) { surplus += ch; continue }
      if (current.length === MAX_LENGTH[order[groups.length]]) {
        close()
        if (groups.length === order.length) { surplus += ch; continue }
      }
      current += ch
      ended = false
    } else if (current !== '') {
      close()
      ended = true
    }
  }
  if (groups.length < order.length && current !== '') {
    groups.push(current)
    ended = false
    if (forward && groups.length < order.length && current.length === MAX_LENGTH[order[groups.length - 1]]) ended = true
  }
  if (surplus && short) groups[groups.length - 1] += surplus
  const text = groups.join(sep)
  return ended && groups.length < order.length ? text + sep : text
}

/** The years a date field takes: one outside them is a typo ("0214" for 2014), not a date */
const MIN_YEAR = 1900
const MAX_YEAR = 2100
const yearOutside = (year: number) => year < MIN_YEAR || year > MAX_YEAR

function daysIn(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function readParts(display: string, order: Part[]): Record<Part, number> | null {
  const groups = display.split(/\D+/).filter(Boolean)
  if (groups.length !== order.length) return null
  const values = { d: 1, m: 1, y: 0 }
  for (const [i, p] of order.entries()) {
    if (p === 'y' && groups[i].length !== 4) return null
    // a day or a month with surplus digits ("001") is unfinished, never read as another day
    if (p !== 'y' && groups[i].length > MAX_LENGTH[p]) return null
    values[p] = Number(groups[i])
  }
  return values
}

/** The ISO "YYYY-MM-DD" of a complete date display; null while it is incomplete, 'invalid' for a day the month lacks or a year outside 1900–2100. */
export function readDate(display: string, locale: string): string | null {
  const v = readParts(display, datePattern(locale).order)
  if (!v) return null
  if (yearOutside(v.y) || v.m < 1 || v.m > 12 || v.d < 1 || v.d > daysIn(v.y, v.m)) return 'invalid'
  return `${String(v.y).padStart(4, '0')}-${String(v.m).padStart(2, '0')}-${String(v.d).padStart(2, '0')}`
}

/** The ISO "YYYY-MM" of a complete month display; null while it is incomplete, 'invalid' for a month that does not exist or a year outside 1900–2100. */
export function readMonth(display: string, locale: string): string | null {
  const v = readParts(display, fieldOrder(locale, 'my').order)
  if (!v) return null
  if (yearOutside(v.y) || v.m < 1 || v.m > 12) return 'invalid'
  return `${String(v.y).padStart(4, '0')}-${String(v.m).padStart(2, '0')}`
}

/**
 * On blur: a two-digit year becomes four — 20yy when yy is at most this year's last two digits plus ten, else 19yy.
 * `parts` says whether the field is a date (default) or a month; text with fewer parts than the field is left alone.
 */
export function completeYear(display: string, locale: string, today: Date, parts: 'dmy' | 'my' = 'dmy'): string {
  const { order } = fieldOrder(locale, parts)
  const groups = display.split(/\D+/).filter(Boolean)
  const at = order.indexOf('y')
  if (groups.length !== order.length || groups[at].length !== 2) return display
  const yy = Number(groups[at])
  const year = (yy <= (today.getUTCFullYear() % 100) + 10 ? 2000 : 1900) + yy
  let i = -1
  return display.replace(/\d+/g, digits => (++i === at ? String(year) : digits))
}

/** The display of a stored ISO date ("2014-03-15") or month ("2014-03") in the order of `locale`; '' for text that is neither. */
export function showDate(iso: string, locale: string, parts: 'dmy' | 'my'): string {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso)
  if (!match || (parts === 'dmy' && match[3] === undefined)) return ''
  const { order, sep } = fieldOrder(locale, parts)
  const values: Record<Part, string> = { y: match[1], m: match[2], d: match[3] ?? '' }
  return order.map(p => values[p]).join(sep)
}
