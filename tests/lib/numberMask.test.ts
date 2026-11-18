import { caretAt, maskNumber, numberSymbols, showNumber, significantBefore } from '../../src/pages/admin/numberMask'

const amount = { decimals: 2, signed: false, guessThousands: true }
const ru = numberSymbols('ru-RU')

describe('maskNumber', () => {
  it('a pasted accounting minus, "(500)" or "500-", is a minus in a field that may be negative', () => {
    const signed = { decimals: 2, signed: true, guessThousands: true }
    expect(maskNumber('(500)', signed, true)).toBe('-500')
    expect(maskNumber('500-', signed, true)).toBe('-500')
    expect(maskNumber('(1 250,50)', signed, true)).toBe('-1250.5')
    expect(maskNumber('(500)', { ...signed, signed: false }, true)).toBe('500')
  })

  it('keeps one decimal separator and two decimals while typing', () => {
    expect(maskNumber('12,5', amount, false)).toBe('12.5')
    expect(maskNumber('12.', amount, false)).toBe('12.')
    expect(maskNumber('12,345', amount, false)).toBe('12345') // thousands guess
    expect(maskNumber('0,125', amount, false)).toBe('0.12') // zero whole part: no guess
    expect(maskNumber('1a2b3', amount, false)).toBe('123')
    expect(maskNumber('-5', amount, false)).toBe('5') // unsigned
    expect(maskNumber('-5', { ...amount, signed: true }, false)).toBe('-5')
  })

  it('reads a pasted dash of any kind as the minus', () => {
    for (const dash of ['–', '‒', '﹣', '－']) expect(maskNumber(`${dash}500`, { ...amount, signed: true }, true)).toBe('-500')
  })

  it('allows the in-progress states and drops leading zeros', () => {
    const signed = { ...amount, signed: true }
    expect(maskNumber('-', signed, false)).toBe('-')
    expect(maskNumber('', amount, false)).toBe('')
    expect(maskNumber('007', amount, false)).toBe('7')
    expect(maskNumber('0.5', amount, false)).toBe('0.5')
    expect(maskNumber('12,3,4', amount, false)).toBe('12.34')
    expect(maskNumber('12.7', { ...amount, decimals: 0 }, false)).toBe('12')
  })

  it('reads pasted bank text', () => {
    expect(maskNumber('1.250.000,50 ₽', amount, true)).toBe('1250000.5')
    expect(maskNumber('1,250.5', amount, true)).toBe('1250.5')
    expect(maskNumber('1 250 000', amount, true)).toBe('1250000')
    expect(maskNumber('1 250 000 RUB', amount, true)).toBe('1250000')
  })

  it('rounds pasted extra decimals half away from zero instead of cutting them', () => {
    expect(maskNumber('1,234.5678', amount, true)).toBe('1234.57')
    expect(maskNumber('0,125', amount, true)).toBe('0.13')
    expect(maskNumber('-0,125', { ...amount, signed: true }, true)).toBe('-0.13')
    expect(maskNumber('9.9999', amount, true)).toBe('10')
    expect(maskNumber('0.124', amount, true)).toBe('0.12')
    expect(maskNumber('12.5', { ...amount, decimals: 0 }, true)).toBe('13')
  })

  it('does not guess thousands for a rate', () => {
    expect(maskNumber('6,125', { decimals: 3, signed: false, guessThousands: false }, false)).toBe('6.125')
  })
})

describe('showNumber', () => {
  it('shows the canonical text in the UI language', () => {
    expect(showNumber('-1250000.5', 'ru-RU')).toBe(`−1${ru.group}250${ru.group}000${ru.decimal}5`)
    expect(showNumber('1250000.5', 'en-US')).toBe('1,250,000.5')
    expect(showNumber('12.', 'ru-RU')).toBe(`12${ru.decimal}`)
  })
})

describe('caret mapping', () => {
  it('keeps the caret after the same digit', () => {
    expect(significantBefore('125000', 5)).toBe(5)
    expect(caretAt(showNumber('1250000', 'ru-RU'), 5, 'ru-RU')).toBe(7) // "1 250 0|00"
    expect(caretAt(showNumber('-5', 'ru-RU'), 0, 'ru-RU')).toBe(1) // after the minus
  })

  it('counts only the decimal separator of the locale', () => {
    expect(significantBefore('1,250.5', 7, 'en-US')).toBe(6)
    expect(caretAt('1,250.5', 6, 'en-US')).toBe(7)
    expect(caretAt('1,250.5', 99, 'en-US')).toBe(7)
  })
})
