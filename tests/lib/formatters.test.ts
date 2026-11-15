import { classLabel, fmtCompactCurrency, fmtCurrency, fmtCurrencyCents, fmtDay, fmtDayNumeric, fmtDayYear, fmtDayTime, fmtInMonth, fmtMoney, fmtMonth, fmtNum, fmtPct, fmtDate, fmtMonths, fmtMonthShort, fmtMonthYear, fmtYears } from '../../src/lib/formatters'
import { ru, withLanguage } from '../helpers/i18n'

// Tests run in English (tests/setup.ts); the Russian cases switch with withLanguage.
describe('fmtCompactCurrency', () => {
  it('shortens thousands and millions, with a typographic minus', () => {
    expect(fmtCompactCurrency(780000, 'USD')).toBe('$780K')
    expect(fmtCompactCurrency(1250000, 'USD')).toBe('$1.25M')
    expect(fmtCompactCurrency(0, 'USD')).toBe('$0')
    expect(fmtCompactCurrency(-40000, 'USD')).toBe('−$40K')
  })
  it('follows the language: in Russian the sign comes after the number and the unit is a word', async () => {
    await withLanguage('ru-RU', () => expect(fmtCompactCurrency(780000, 'USD')).toMatch(/^780\s\S+\s\$$/u))
  })
  it('puts a code Intl rejects after the number', () => {
    expect(fmtCompactCurrency(780000, 'XX')).toMatch(/780K XX$/)
  })
})

describe('fmtCurrency', () => {
  it('writes no number as a dash, not "$NaN"', () => {
    for (const v of [NaN, Infinity]) {
      expect(fmtCurrency(v, 'USD')).toBe('—')
      expect(fmtCompactCurrency(v, 'USD')).toBe('—')
      expect(fmtCurrencyCents(v, 'USD')).toBe('—')
    }
  })

  it('formats thousands with the English separator and the currency sign', () => {
    expect(fmtCurrency(2718, 'USD')).toBe('$2,718')
    expect(fmtCurrency(372000, 'USD')).toBe('$372,000')
    expect(fmtCurrency(1000, 'GBP')).toBe('£1,000')
  })
  it('rounds and writes a typographic minus for negative values', () => {
    expect(fmtCurrency(-41500, 'USD')).toBe('−$41,500')
    expect(fmtCurrency(-1234.6, 'USD')).toBe('−$1,235')
  })
  it('formats zero without a minus', () => {
    expect(fmtCurrency(0, 'USD')).toBe('$0')
    expect(fmtCurrency(-0.4, 'USD')).toBe('$0')
  })
  it('names a currency without a sign by its code', () => {
    expect(fmtCurrency(5, 'XYZ')).toContain('XYZ')
    expect(fmtCurrency(5, 'not a code')).toBe('5 not a code')
  })
})

describe('fmtNum', () => {
  it('uses a decimal point and at most one digit', () => {
    expect(fmtNum(2.38)).toBe('2.4')
    expect(fmtNum(37)).toBe('37')
    expect(fmtNum(5678.91)).toBe('5,678.9')
    expect(fmtNum(13.6, 0)).toBe('14')
  })

  it('writes a typographic minus and never a negative zero', () => {
    expect(fmtNum(-47)).toBe('−47')
    expect(fmtNum(-0.02)).toBe('0')
    expect(fmtNum(-0.03)).toBe('0')
  })

  it('shows a dash when there is no number', () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity]) expect(fmtNum(v)).toBe('—')
  })

  it('follows the language: Russian separators', async () => {
    await withLanguage('ru-RU', () => {
      expect(fmtNum(5678.91)).toBe((5678.9).toLocaleString('ru-RU'))
      expect(fmtNum(-3.4)).toBe(`−${(3.4).toLocaleString('ru-RU')}`)
      expect(fmtCurrency(2718, 'USD')).toBe(`${(2718).toLocaleString('ru-RU')}\u00a0$`)
    })
    expect(fmtNum(5678.91)).toBe('5,678.9')
  })
})

describe('fmtPct', () => {
  it('formats a share without a sign by default', () => {
    expect(fmtPct(7.3)).toBe('7.3%')
    expect(fmtPct(-47)).toBe('−47%')
  })

  it('adds a plus for growth when asked', () => {
    expect(fmtPct(3.4, { sign: true })).toBe('+3.4%')
    expect(fmtPct(-2.7, { sign: true })).toBe('−2.7%')
    expect(fmtPct(0, { sign: true })).toBe('0%')
  })

  it('takes more decimals when asked (a rate)', () => {
    expect(fmtPct(9.25, { digits: 2 })).toBe('9.25%')
    expect(fmtPct(9, { digits: 2 })).toBe('9%')
  })

  it('shows a dash when there is no number', () => {
    expect(fmtPct(null)).toBe('—')
  })
})

describe('fmtMonths', () => {
  it('formats months with the unit from the locale', () => {
    expect(fmtMonths(4)).toBe('4 mo')
    expect(fmtMonths(2.38)).toBe('2.4 mo')
    expect(fmtMonths(null)).toBe('—')
  })

  it('keeps the Russian unit the same for any count', async () => {
    await withLanguage('ru-RU', () => {
      for (const n of [1, 3, 6, 12, 21, 23, 26]) expect(fmtMonths(n)).toBe(ru('units.months', { value: String(n) }))
      expect(fmtMonths(2.38)).toBe(ru('units.months', { value: (2.4).toLocaleString('ru-RU') }))
    })
  })
})

describe('fmtDate', () => {
  it("formats YYYY-MM-DD as Mon'YY", () => {
    expect(fmtDate('2031-09-01')).toBe("Sep'31")
  })

  it('accepts a bare month the way the cash-flow chart passes it', () => {
    expect(fmtDate('2031-09')).toBe("Sep'31")
    expect(fmtDate('2030-02')).toBe("Feb'30")
  })

  it('takes short month names from the locale', async () => {
    await withLanguage('ru-RU', () => {
      expect(fmtDate('2031-09')).toBe(`${ru('dates.monthShort.9')}'31`)
    })
  })
})

describe('fmtMonthYear', () => {
  it('formats a month as "Sep 2031" for the account history table', () => {
    expect(fmtMonthYear('2031-09')).toBe('Sep 2031')
    expect(fmtMonthYear('2030-02')).toBe('Feb 2030')
  })
})

describe('fmtMonthShort', () => {
  it('names the month alone, for a chart axis', () => {
    expect(fmtMonthShort('2031-09')).toBe('Sep')
    expect(fmtMonthShort('2030-12')).toBe('Dec')
  })
})

describe('fmtDayYear', () => {
  it('writes the day with its year, the Russian month in the genitive', async () => {
    expect(fmtDayYear('2025-09-30')).toBe('September 30, 2025')
    await withLanguage('ru-RU', () => expect(fmtDayYear('2025-09-30')).toBe(`30 ${ru('dates.monthOf.9')} 2025`))
  })
})

describe('fmtMoney', () => {
  it('always shows two decimals with thousands separators', () => {
    expect(fmtMoney(48210.7)).toBe('48,210.70')
    expect(fmtMoney(0)).toBe('0.00')
    expect(fmtMoney(-0.002)).toBe('0.00')
    expect(fmtMoney(-2300)).toBe('−2,300.00')
  })

  it('shows a dash when there is no number', () => {
    expect(fmtMoney(null)).toBe('—')
    expect(fmtMoney(NaN)).toBe('—')
  })
})

describe('fmtYears', () => {
  it('words years by the rounded value, with the plural of the language', () => {
    expect(fmtYears(1)).toBe('1 year')
    expect(fmtYears(4)).toBe('4 years')
    expect(fmtYears(7.4)).toBe('7.4 years')
    expect(fmtYears(null)).toBe('—')
  })

  it('declines the year in Russian by the rounded value and keeps the fraction form for fractions', async () => {
    await withLanguage('ru-RU', () => {
      const year = (count: number, value: string) => ru('units.years', { count, value })
      expect(fmtYears(1)).toBe(year(1, '1'))
      expect(fmtYears(4)).toBe(year(4, '4'))
      expect(fmtYears(26)).toBe(year(26, '26'))
      expect(fmtYears(31)).toBe(year(31, '31'))
      expect(fmtYears(7.4)).toBe(year(7.4, '7,4'))
      // the one / few / many forms are three different words
      expect(new Set([fmtYears(1), fmtYears(4), fmtYears(26)].map(text => text.split(' ')[1])).size).toBe(3)
    })
  })
})

describe('month names', () => {
  it('names a month, a month in a sentence and a day', () => {
    expect(fmtMonth('2031-09')).toBe('September 2031')
    expect(fmtInMonth('2031-09')).toBe('in September')
    expect(fmtDay('2031-02-01')).toBe('February 1')
  })

  it('declines the month in Russian', async () => {
    await withLanguage('ru-RU', () => {
      expect(fmtMonth('2030-11')).toBe(`${ru('dates.month.11')} 2030`)
      expect(fmtInMonth('2031-09')).toBe(ru('dates.inMonth.9'))
      expect(fmtDay('2031-07-23')).toBe(ru('dates.dayOfMonth', { day: 23, month: ru('dates.monthOf.7') }))
    })
  })
})

describe('fmtDayNumeric', () => {
  it('writes an ISO date in the numeric format of the UI language and shows a dash for nothing', async () => {
    expect(fmtDayNumeric('2031-11-27')).toBe('11/27/2031')
    expect(fmtDayNumeric(null)).toBe('—')
    expect(fmtDayNumeric('')).toBe('—')
    expect(fmtDayNumeric('bad')).toBe('bad')
    await withLanguage('ru-RU', () => expect(fmtDayNumeric('2031-11-27')).toBe('27.11.2031'))
  })

  it('returns a day the month does not have, or a stray tail, as is instead of guessing', () => {
    expect(fmtDayNumeric('2026-02-30')).toBe('2026-02-30')
    expect(fmtDayNumeric('2026-02-03extra')).toBe('2026-02-03extra')
    expect(fmtDayNumeric('2026-02-03T10:00:00Z')).toBe('02/03/2026')
  })
})

describe('fmtDayTime', () => {
  it('writes a moment as the numeric day with a four-digit year and the time, in the UI language', async () => {
    const moment = new Date(2031, 10, 27, 14, 5)   // local: the moment is shown in the browser's zone
    expect(fmtDayTime(moment)).toBe('11/27/2031, 2:05 PM')
    expect(fmtDayTime(moment.toISOString())).toBe('11/27/2031, 2:05 PM')
    await withLanguage('ru-RU', () => expect(fmtDayTime(moment)).toBe('27.11.2031, 14:05'))
  })

  it('shows a dash for nothing or an unreadable value', () => {
    expect(fmtDayTime(null)).toBe('—')
    expect(fmtDayTime('')).toBe('—')
    expect(fmtDayTime('bad')).toBe('—')
  })
})

describe('classLabel', () => {
  it('labels account classes and real estate alike', () => {
    expect(classLabel('bank')).toBe('Bank')
    expect(classLabel('real_estate')).toBe('Real estate')
  })
  it('in Russian comes from the Russian locale', async () => {
    await withLanguage('ru-RU', () => expect(classLabel('broker')).toBe(ru('accounts.class.broker')))
  })
})

it('keeps tiny percent signs and genuine zero with localized thresholds', async () => {
  expect(fmtPct(0.04, { preserveNonzero: true })).toBe('<0.1%')
  expect(fmtPct(-0.04, { preserveNonzero: true })).toBe('>−0.1%')
  expect(fmtPct(Number.MIN_VALUE, { preserveNonzero: true })).toBe('<0.1%')
  expect(fmtPct(0, { preserveNonzero: true })).toBe('0%')
  expect(fmtPct(1.2, { sign: true, preserveNonzero: true })).toBe('+1.2%')
  expect(fmtPct(0.0004, { digits: 3, preserveNonzero: true })).toBe('<0.001%')
  await withLanguage('ru-RU', () => {
    expect(fmtPct(0.04, { preserveNonzero: true })).toBe('<0,1%')
    expect(fmtPct(-0.04, { preserveNonzero: true })).toBe('>−0,1%')
  })
})


describe('fmtCurrencyCents', () => {
  it('keeps cents, negative values and zero in the requested currency', () => {
    expect(fmtCurrencyCents(12345, 'USD')).toBe('$12,345.00')
    expect(fmtCurrencyCents(-12.34, 'GBP')).toBe('−£12.34')
    expect(fmtCurrencyCents(0, 'USD')).toBe('$0.00')
  })
  it('uses Russian currency placement and separators', async () => {
    await withLanguage('ru-RU', () => {
      expect(fmtCurrencyCents(12345.67, 'RUB').replace(/\u00a0/g, ' ')).toBe('12 345,67 ₽')
    })
  })
})
