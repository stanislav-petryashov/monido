export const DATE_FORMATS = ['dmy', 'mdy', 'ymd'] as const
export type DateFormat = typeof DATE_FORMATS[number]
export const isDateFormat = (value: unknown): value is DateFormat => DATE_FORMATS.some(format => format === value)

/** ISO calendar parts stay unchanged; only their display order changes. */
export function formatDateParts(iso: string, format: DateFormat): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  const values = { y, m, d }
  return [...format].filter(part => part !== 'd' || d !== undefined).map(part => values[part as keyof typeof values]).join('.')
}
