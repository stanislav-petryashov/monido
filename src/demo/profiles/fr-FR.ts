// The French family: Julien and Camille, euros and a dollar account, a house in Nantes with a 25-year loan and a
// rented-out studio in Lyon. Every name, bank and amount is invented; changing one
// changes every generated row.
import { EUR_PER_USD_BY_MONTH } from '../eurRates'
import type { FamilyProfile } from '../family'
import type { DemoStrings } from '../strings'
import names from '../fr-FR.json'

const strings: DemoStrings = names
/** The first early payment's exact figures from the bank statement */
const EXACT = { new_payment: 1533.57, principal_credit: 3993.1 }

export const FR_FR: FamilyProfile = {
  key: 'fr-FR',
  strings,
  currency: 'EUR',
  foreign: 'USD',
  rates: { currency: 'EUR', perUsdByMonth: EUR_PER_USD_BY_MONTH },
  inflationRate: 2.5,
  checking: {
    salary: [3200, 3300, 3400], bonus: 3300,
    expense: { base: 2000, swing: 190, december: 550 },
    balance: { start: 4600, slope: 22, swing: 420, december: 600 },
  },
  savings: {
    salary: [2700, 2800, 2900], interest: 0.03, trip: 2900,
    expense: { base: 1900, swing: 170, december: 0 },
    balance: { start: 15000, slope: 220, swing: 260 },
  },
  pensionA: { start: 18000, monthly: 260, swing: 1100 },
  pensionB: { start: 12000, monthly: 210, swing: 800 },
  broker: { start: 11000, monthly: 230, swing: 900 },
  // a dollar account: about $100 a month, no flows
  foreignAccount: { balance: { start: 3000, slope: 100, swing: 120 }, upkeep: null },
  rent: { before: 650, after: 690, account: 'savings' },
  home: { price: 380000, growth: 1.02 },
  rental: { price: 170000, growth: 1.02 },
  mortgage: { principal: 304000, rate: 3.7, term: 300, early: [4000, 5000, 3000, 6000], exact: EXACT },
  car: { principal: 20000, rate: 5.5, term: 60 },
  goals: { emergency: [27000, 13000], vacation: [5500, 2000], fire: [1000000, 110000] },
  // the roof redone
  repair: 6200,
}
