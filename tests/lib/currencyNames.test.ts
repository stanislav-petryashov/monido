import { currencyMatches } from '../../src/lib/currencyNames'

/** A word of a currency's Russian name, taken from Intl so this file holds no Cyrillic. */
const ruWord = (code: string) => new Intl.DisplayNames(['ru-RU'], { type: 'currency' }).of(code)!.split(' ').at(-1)!

const codes = (query: string, language: string, exclude: readonly string[] = []) => currencyMatches(query, language, exclude).map(m => m.code)

describe('currencyMatches', () => {
  it('finds a currency by its name in the UI language', () => {
    expect(codes(ruWord('GEL'), 'ru-RU')[0]).toBe('GEL')
  })

  it('finds a currency by its English name whatever the UI language', () => {
    expect(codes('dirham', 'ru-RU')).toContain('AED')
  })

  it('drops the currencies the family already has', () => {
    expect(codes('us', 'ru-RU', ['USD'])).not.toContain('USD')
  })

  it('a code prefix comes first, case-insensitively', () => {
    expect(codes('KZ', 'en-US')[0]).toBe('KZT')
    expect(codes('kz', 'en-US')[0]).toBe('KZT')
  })

  it('an exact code beats a code prefix, which beats a name', () => {
    // USD starts with "us"; "Australian Dollar" only has it inside the name
    const us = codes('us', 'en-US')
    expect(us.indexOf('USD')).toBeLessThan(us.indexOf('AUD'))
    expect(codes('usd', 'en-US')[0]).toBe('USD')
  })

  it('gives at most eight and nothing for an empty query', () => {
    expect(codes('a', 'en-US').length).toBeLessThanOrEqual(8)
    expect(codes('', 'en-US')).toEqual([])
    expect(codes('   ', 'en-US')).toEqual([])
  })

  it('names each currency in the UI language', () => {
    expect(currencyMatches('KZT', 'en-US', [])[0]).toEqual({ code: 'KZT', name: 'Kazakhstani Tenge' })
  })
})
