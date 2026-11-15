import { parseAmount, parseDecimal } from '../../src/pages/admin/amount'

describe('parseAmount', () => {
  it.each([
    ['7420,5', 7420.5], ['7420.5', 7420.5], ['2 350,75', 2350.75], ['3\u00a0200', 3200], ['0', 0], ['-85', -85], ['  27  ', 27],
  ])('reads %j as %d', (text, value) => {
    expect(parseAmount(text)).toEqual({ value, invalid: false })
  })

  it('treats an empty field as not filled, not as an error', () => {
    expect(parseAmount('')).toEqual({ value: null, invalid: false })
    expect(parseAmount('   ')).toEqual({ value: null, invalid: false })
  })

  // '1.000' and '1,000' can mean a thousand or one: do not guess, or an amount is recorded a thousand times too small
  it.each(['1.000', '1,000', '1.000,50', '1,000.50', '1e5', '0x10', 'abc', '-', '12,', ',5', '1,2,3', '12 rub'])('refuses %j instead of guessing', text => {
    expect(parseAmount(text)).toEqual({ value: null, invalid: true })
  })

  it('accepts cents and a fraction longer or shorter than three digits', () => {
    expect(parseAmount('2,5')).toEqual({ value: 2.5, invalid: false })
    expect(parseAmount('3,75')).toEqual({ value: 3.75, invalid: false })
    expect(parseAmount('4,6789')).toEqual({ value: 4.6789, invalid: false })
  })
})

describe('parseDecimal', () => {
  // a rate or a term has no thousands: "6.125" is six and an eighth, not six thousand
  it.each([['6.125', 6.125], ['3,875', 3.875], ['7,5', 7.5], ['360', 360], ['0', 0], [' 12 ', 12], ['-1.5', -1.5]])('reads %j as %d', (text, value) => {
    expect(parseDecimal(text)).toBe(value)
  })

  it.each(['', '   ', 'abc', '1,2,3', '12,', ',5', '1 000', '1e5'])('reads %j as nothing', text => {
    expect(parseDecimal(text)).toBeNull()
  })
})
