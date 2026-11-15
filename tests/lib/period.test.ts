import { PERIODS, balanceStart, flowStart, readStoredPeriod, storePeriod, PERIOD_STORAGE_KEY } from '../../src/lib/period'

describe('period windows', () => {
  it('lists the periods in order', () => expect(PERIODS).toEqual(['ytd', '1y', '5y', 'all']))

  it('starts balances at the month-end before the window', () => {
    expect(balanceStart('1y', '2026-09')).toBe('2025-09')
    expect(balanceStart('5y', '2026-09')).toBe('2021-09')
    expect(balanceStart('ytd', '2026-09')).toBe('2025-12')
    expect(balanceStart('ytd', '2026-12')).toBe('2025-12')
    expect(balanceStart('all', '2026-09')).toBeNull()
  })

  it('starts flows one month after the balance start', () => {
    expect(flowStart('1y', '2026-09')).toBe('2025-10')
    expect(flowStart('5y', '2026-09')).toBe('2021-10')
    expect(flowStart('ytd', '2026-01')).toBe('2026-01')
    expect(flowStart('ytd', '2026-09')).toBe('2026-01')
    expect(flowStart('all', '2026-09')).toBeNull()
  })
})

describe('stored period', () => {
  afterEach(() => localStorage.clear())
  it('defaults to 1y and ignores unknown values', () => {
    expect(readStoredPeriod()).toBe('1y')
    localStorage.setItem(PERIOD_STORAGE_KEY, '12m')
    expect(readStoredPeriod()).toBe('1y')
  })
  it('remembers the choice', () => {
    storePeriod('5y')
    expect(localStorage.getItem('fc.period')).toBe('5y')
    expect(readStoredPeriod()).toBe('5y')
  })
})
