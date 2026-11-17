// The German family: Jonas and Lena, euros and a dollar account, a house in Freiburg with a 30-year loan and a rented-out
// apartment in Leipzig. Every name, bank and amount is invented; changing one
// changes every generated row.
import { EUR_PER_USD_BY_MONTH } from '../eurRates'
import type { FamilyProfile } from '../family'
import type { DemoStrings } from '../strings'
import names from '../de-DE.json'

const strings: DemoStrings = names
/** The first early payment's exact figures from the bank statement */
const EXACT = { new_payment: 1840.76, principal_credit: 4991.4 }

export const DE_DE: FamilyProfile = {
  key: 'de-DE',
  strings,
  currency: 'EUR',
  foreign: 'USD',
  rates: { currency: 'EUR', perUsdByMonth: EUR_PER_USD_BY_MONTH },
  inflationRate: 2.5,
  checking: {
    salary: [3900, 4050, 4200], bonus: 4000,
    expense: { base: 2300, swing: 220, december: 600 },
    balance: { start: 5200, slope: 25, swing: 500, december: 700 },
  },
  savings: {
    salary: [3100, 3250, 3400], interest: 0.025, trip: 3200,
    expense: { base: 2200, swing: 200, december: 0 },
    balance: { start: 18000, slope: 260, swing: 300 },
  },
  pensionA: { start: 26000, monthly: 420, swing: 1500 },
  pensionB: { start: 17000, monthly: 330, swing: 1100 },
  broker: { start: 15000, monthly: 300, swing: 1100 },
  // a dollar account for a US index fund's cash: about $120 a month, no flows
  foreignAccount: { balance: { start: 4000, slope: 120, swing: 150 }, upkeep: null },
  rent: { before: 780, after: 830, account: 'savings' },
  home: { price: 520000, growth: 1.02 },
  rental: { price: 210000, growth: 1.025 },
  mortgage: { principal: 410000, rate: 3.6, term: 360, early: [5000, 6000, 4000, 7000], exact: EXACT },
  car: { principal: 24000, rate: 5.9, term: 60 },
  goals: { emergency: [33000, 17000], vacation: [6500, 2400], fire: [1400000, 160000] },
  // a new heating system
  repair: 6500,
}
