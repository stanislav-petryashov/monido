// The Spanish family: Javier and Lucía, euros and a dollar account, a flat in Valencia with a 30-year mortgage and a
// rented-out apartment in Alicante. Every name, bank and amount is invented; changing one
// changes every generated row.
import { EUR_PER_USD_BY_MONTH } from '../eurRates'
import type { FamilyProfile } from '../family'
import type { DemoStrings } from '../strings'
import names from '../es-ES.json'

const strings: DemoStrings = names
/** The first early payment's exact figures from the bank statement */
const EXACT = { new_payment: 990.01, principal_credit: 2994.85 }

export const ES_ES: FamilyProfile = {
  key: 'es-ES',
  strings,
  currency: 'EUR',
  foreign: 'USD',
  rates: { currency: 'EUR', perUsdByMonth: EUR_PER_USD_BY_MONTH },
  inflationRate: 3,
  checking: {
    salary: [2600, 2700, 2800], bonus: 2700,
    expense: { base: 1600, swing: 150, december: 450 },
    balance: { start: 3800, slope: 20, swing: 350, december: 500 },
  },
  savings: {
    salary: [2200, 2300, 2400], interest: 0.02, trip: 2600,
    expense: { base: 1550, swing: 140, december: 0 },
    balance: { start: 12000, slope: 180, swing: 220 },
  },
  pensionA: { start: 14000, monthly: 200, swing: 900 },
  pensionB: { start: 9000, monthly: 150, swing: 650 },
  broker: { start: 8000, monthly: 180, swing: 700 },
  // a dollar account: about $90 a month, no flows
  foreignAccount: { balance: { start: 2500, slope: 90, swing: 110 }, upkeep: null },
  rent: { before: 750, after: 800, account: 'savings' },
  home: { price: 290000, growth: 1.045 },
  rental: { price: 165000, growth: 1.05 },
  mortgage: { principal: 232000, rate: 3.2, term: 360, early: [3000, 4000, 2500, 5000], exact: EXACT },
  car: { principal: 18000, rate: 6.5, term: 60 },
  goals: { emergency: [24000, 11000], vacation: [5000, 1800], fire: [900000, 95000] },
  // the kitchen redone
  repair: 5800,
}
