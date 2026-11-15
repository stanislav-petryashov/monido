import { shiftMonth } from '../domain/dates'
import { writeItem, readItem } from './storage'

export type PeriodKey = 'ytd' | '1y' | '5y' | 'all'

/** The period switch lists the keys in this order. */
export const PERIODS: PeriodKey[] = ['ytd', '1y', '5y', 'all']
const DEFAULT_PERIOD: PeriodKey = '1y'

/** The localStorage key of the chosen period. @public */
export const PERIOD_STORAGE_KEY = 'fc.period'

export function readStoredPeriod(): PeriodKey {
  const value = readItem('local', PERIOD_STORAGE_KEY)
  return PERIODS.includes(value as PeriodKey) ? (value as PeriodKey) : DEFAULT_PERIOD
}

export function storePeriod(period: PeriodKey): void {
  writeItem('local', PERIOD_STORAGE_KEY, period)
}

/** The month-end a balance window starts at (inclusive), for the last closed month `last`; null — from the beginning. */
export function balanceStart(period: PeriodKey, last: string): string | null {
  switch (period) {
    case '1y': return shiftMonth(last, -12)
    case '5y': return shiftMonth(last, -60)
    case 'ytd': return `${Number(last.slice(0, 4)) - 1}-12`
    case 'all': return null
  }
}

/** The first month of a flow window ending at `last`; null — from the beginning. */
export function flowStart(period: PeriodKey, last: string): string | null {
  const start = balanceStart(period, last)
  return start === null ? null : shiftMonth(start, 1)
}
