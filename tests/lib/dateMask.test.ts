import { completeYear, datePattern, maskDate, readDate, readMonth, showDate } from '../../src/pages/admin/dateMask'

describe('dateMask', () => {
  it('orders the parts the way the UI language does', () => {
    expect(datePattern('ru-RU')).toEqual({ order: ['d', 'm', 'y'], sep: '.' })
    expect(datePattern('en-US')).toEqual({ order: ['m', 'd', 'y'], sep: '/' })
  })

  it('inserts separators and pads a one-digit part', () => {
    expect(maskDate('15032014', 'ru-RU', true, 'dmy')).toBe('15.03.2014')
    expect(maskDate('5.3.', 'ru-RU', true, 'dmy')).toBe('05.03.')
    expect(maskDate('15', 'ru-RU', true, 'dmy')).toBe('15.')
    expect(maskDate('15', 'ru-RU', false, 'dmy')).toBe('15') // deleting does not re-add the dot
    expect(maskDate('2014-03-15', 'ru-RU', true, 'dmy')).toBe('15.03.2014')
    expect(maskDate('03152014', 'en-US', true, 'dmy')).toBe('03/15/2014')
    expect(maskDate('122030', 'ru-RU', true, 'my')).toBe('12.2030')
    expect(maskDate('2030-12', 'ru-RU', true, 'my')).toBe('12.2030')
    expect(maskDate('150320141', 'ru-RU', true, 'dmy')).toBe('15.03.2014')
    expect(maskDate('', 'ru-RU', true, 'dmy')).toBe('')
  })

  it('a date typed in another order is left unread, not read as another day', () => {
    // a year-first field (zh-CN) given a day-first date: the digits past it stay, so it is not 2015-03-20
    const shown = maskDate('15.03.2024', 'zh-CN', true, 'dmy')
    // leaving the field completes a two-digit year: "15/03/20" became 2015-03-20, a valid date nobody typed
    expect(readDate(completeYear(shown, 'zh-CN', new Date('2026-11-18')), 'zh-CN')).not.toBe('2015-03-20')
    expect(shown).toBe('15/03/2024')
    // a day with a surplus digit is not read either ("001" is not the 1st)
    expect(readDate('2024/03/001', 'zh-CN')).toBeNull()
  })

  it('reads a complete date, refuses a day the month lacks', () => {
    expect(readDate('15.03.2014', 'ru-RU')).toBe('2014-03-15')
    expect(readDate('03/15/2014', 'en-US')).toBe('2014-03-15')
    expect(readDate('30.02.2014', 'ru-RU')).toBe('invalid')
    expect(readDate('29.02.2024', 'ru-RU')).toBe('2024-02-29')
    expect(readDate('29.02.2023', 'ru-RU')).toBe('invalid')
    expect(readDate('15.03', 'ru-RU')).toBeNull()
    expect(readDate('15.03.14', 'ru-RU')).toBeNull()
    expect(readMonth('13.2030', 'ru-RU')).toBe('invalid')
    expect(readMonth('12.2030', 'ru-RU')).toBe('2030-12')
    expect(readMonth('12.', 'ru-RU')).toBeNull()
  })

  it('refuses a year outside 1900–2100: a typo, not a date', () => {
    expect(readDate('15.03.0214', 'ru-RU')).toBe('invalid')
    expect(readDate('15.03.2214', 'ru-RU')).toBe('invalid')
    expect(readDate('01.01.1900', 'ru-RU')).toBe('1900-01-01')
    expect(readDate('31.12.2100', 'ru-RU')).toBe('2100-12-31')
    expect(readMonth('03.0214', 'ru-RU')).toBe('invalid')
    expect(readMonth('03.2101', 'ru-RU')).toBe('invalid')
    expect(readMonth('03.1900', 'ru-RU')).toBe('1900-03')
  })

  it('completes a two-digit year', () => {
    const today = new Date(Date.UTC(2026, 9, 23))
    expect(completeYear('05.03.14', 'ru-RU', today)).toBe('05.03.2014')
    expect(completeYear('05.03.98', 'ru-RU', today)).toBe('05.03.1998')
    expect(completeYear('05.03.36', 'ru-RU', today)).toBe('05.03.2036')
    expect(completeYear('05.03.37', 'ru-RU', today)).toBe('05.03.1937')
    expect(completeYear('03.14', 'ru-RU', today, 'my')).toBe('03.2014')
    expect(completeYear('05.03', 'ru-RU', today)).toBe('05.03') // an unfinished date is left alone
  })

  it('shows a stored date or month', () => {
    expect(showDate('2014-03-15', 'ru-RU', 'dmy')).toBe('15.03.2014')
    expect(showDate('2014-03-15', 'en-US', 'dmy')).toBe('03/15/2014')
    expect(showDate('2014-03', 'ru-RU', 'my')).toBe('03.2014')
    expect(showDate('2014-03-01', 'ru-RU', 'my')).toBe('03.2014')
  })
})
