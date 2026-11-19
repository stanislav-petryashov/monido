// The Chinese family: Zhou Ran and Lin Yue, yuan and a dollar account, an apartment in Hangzhou with a 30-year mortgage
// and a rented-out apartment in Suzhou whose price has eased. Every name, bank and amount is invented; changing one
// changes every generated row.
import { CNY_PER_USD_BY_MONTH } from '../cnyRates'
import type { FamilyProfile } from '../family'
import type { DemoStrings } from '../strings'
import names from '../zh-CN.json'

const strings: DemoStrings = names
/** The first early payment's exact figures from the bank statement */
const EXACT = { new_payment: 12930.18, principal_credit: 19965.4 }

export const ZH_CN: FamilyProfile = {
  key: 'zh-CN',
  strings,
  currency: 'CNY',
  foreign: 'USD',
  rates: { currency: 'CNY', perUsdByMonth: CNY_PER_USD_BY_MONTH },
  inflationRate: 1,
  checking: {
    salary: [24000, 25500, 27000], bonus: 26000,
    expense: { base: 11500, swing: 1100, december: 3000 },
    balance: { start: 30000, slope: 200, swing: 3000, december: 3500 },
  },
  savings: {
    salary: [17000, 18000, 19000], interest: 0.015, trip: 28000,
    expense: { base: 10500, swing: 900, december: 0 },
    balance: { start: 160000, slope: 3000, swing: 3500 },
  },
  broker: { start: 150000, monthly: 2000, swing: 9000 },
  // a dollar account: about $150 a month, no flows
  foreignAccount: { balance: { start: 6000, slope: 150, swing: 180 }, upkeep: null },
  rent: { before: 3500, after: 3600, account: 'savings' },
  home: { price: 4200000, growth: 0.99 },
  rental: { price: 1500000, growth: 0.98 },
  mortgage: { principal: 2900000, rate: 3.5, term: 360, early: [20000, 30000, 15000, 40000], exact: EXACT },
  car: { principal: 150000, rate: 4, term: 36 },
  renovation: { principal: 30000, rate: 4.2 },
  goals: { emergency: [150000, 80000], vacation: [40000, 12000], fire: [12000000, 1500000] },
  // the apartment refitted
  repair: 60000,
}
