import { afterEach, expect, it } from 'vitest'
import { DATE_FORMATS, formatDateParts } from '../../src/domain/dateFormat'
import { applyDateFormat } from '../../src/lib/dateFormat'
import { fmtDayNumeric, fmtDayTime, fmtMonthNumeric } from '../../src/lib/formatters'
import { maskDate, readDate, showDate } from '../../src/pages/admin/dateMask'

afterEach(() => applyDateFormat(null))
it('uses the same order for display, typing, ISO paste and parsing, including a leap day', () => {
  expect(DATE_FORMATS.map(format => formatDateParts('2026-11-13', format))).toEqual(['13.11.2026', '11.13.2026', '2026.11.13'])
  for (const format of DATE_FORMATS) {
    applyDateFormat(format)
    const shown = formatDateParts('2024-02-29', format)
    expect(fmtDayNumeric('2024-02-29')).toBe(shown)
    expect(showDate('2024-02-29', format, 'dmy')).toBe(shown)
    expect(maskDate('2024-02-29', format, false, 'dmy')).toBe(shown)
    expect(readDate(shown, format)).toBe('2024-02-29')
    expect(readDate(shown.replace('2024', '2025'), format)).toBe('invalid')
    expect(fmtMonthNumeric('2024-02')).toBe(format === 'ymd' ? '2024.02' : '02.2024')
    expect(fmtDayTime(new Date(2024, 1, 29, 12))).toContain(shown)
  }
})
