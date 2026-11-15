import { periodSuffix, signed } from '../../src/lib/pageHelpers'
import { PRIVACY_MASK } from '../../src/lib/privacy'

describe('page helpers', () => {
  it('signs growth and leaves a fall as formatted', () => {
    expect(signed(8, v => `$${v}`)).toBe('+$8')
    expect(signed(-8, v => `−$${-v}`)).toBe('−$8')
    expect(signed(0, v => `$${v}`)).toBe('$0')
  })

  it('gives the privacy mask no sign: it does not tell growth from a fall', () => {
    expect(signed(8, () => PRIVACY_MASK)).toBe(PRIVACY_MASK)
  })

  it('appends the month to a label from a month or a date, and nothing without a period', () => {
    expect(periodSuffix('2031-09')).toBe(' · September 2031')
    expect(periodSuffix('2031-09-30')).toBe(' · September 2031')
    expect(periodSuffix(null)).toBe('')
    expect(periodSuffix(undefined)).toBe('')
  })
})
