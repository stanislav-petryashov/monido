import type { FinanceSnapshot } from '../../src/domain/types'
import { DEMO_FAMILIES } from '../../src/demo/family'
import { makeSnapshot } from './snapshot'

export const [robin, noa] = DEMO_FAMILIES['en-US'].members
type Cls = 'bank' | 'broker'
const account = (name: string, member: string, cls: Cls, currency: string, value: number, valueBase: number) => ({ name, member, class: cls, currency, value, valueBase })
const property = (name: string, member: string, currency: string, value: number, valueBase: number) => ({ name, member, currency, value, valueBase })

/**
 * The mock-up's month: eight holdings, 1 144 127 at the end, 1 141 971 a month earlier (+2 156); the apartment in
 * Leipzig fell on the euro rate alone, the house did not move, Rheinau Bank is in euros.
 */
export function mockupMonth(over: Partial<FinanceSnapshot> = {}): FinanceSnapshot {
  const end = {
    ...makeSnapshot().capital!,
    date: '2031-06-30', liquid: 58723,
    accounts: [
      account('Granite Peak 401(k)', robin, 'broker', 'USD', 80580, 80580), account('Silverleaf 401(k)', noa, 'broker', 'USD', 55830, 55830),
      account('Kestrel Brokerage', robin, 'broker', 'USD', 35900, 35900), account('Harborline Checking', robin, 'bank', 'USD', 32000, 32000),
      account('Bluefinch Savings', noa, 'bank', 'USD', 16000, 16000), account('Rheinau Bank', noa, 'bank', 'EUR', 9300, 10723),
    ],
    realEstate: [property('House on Maple Street', robin, 'USD', 568000, 568000), property('Apartment in Leipzig', noa, 'EUR', 299500, 345094)],
  }
  const prev = {
    ...end, date: '2031-05-31',
    accounts: [
      account('Granite Peak 401(k)', robin, 'broker', 'USD', 79630, 79630), account('Silverleaf 401(k)', noa, 'broker', 'USD', 55080, 55080),
      account('Kestrel Brokerage', robin, 'broker', 'USD', 35570, 35570), account('Harborline Checking', robin, 'bank', 'USD', 30280, 30280),
      account('Bluefinch Savings', noa, 'bank', 'USD', 15720, 15720), account('Rheinau Bank', noa, 'bank', 'EUR', 9170, 10573),
    ],
    realEstate: [property('House on Maple Street', robin, 'USD', 568000, 568000), property('Apartment in Leipzig', noa, 'EUR', 299500, 347118)],
  }
  return makeSnapshot({ capital: end, previousCapital: prev, capitalCoverage: ['2031-05', '2031-06'].map(month => ({ month, assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] })), ...over })
}
