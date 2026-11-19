// The Brazilian family: Rafael and Mariana, reais and a dollar account, an apartment in Campinas with a 30-year
// financing and a rented-out apartment in Santos. Every name, bank and amount is invented; changing one
// changes every generated row.
import { BRL_PER_USD_BY_MONTH } from '../brlRates'
import type { FamilyProfile } from '../family'
import type { DemoStrings } from '../strings'
import names from '../pt-BR.json'

const strings: DemoStrings = names
/** The first early payment's exact figures from the bank statement */
const EXACT = { new_payment: 5792.66, principal_credit: 14974.05 }

export const PT_BR: FamilyProfile = {
  key: 'pt-BR',
  strings,
  currency: 'BRL',
  foreign: 'USD',
  rates: { currency: 'BRL', perUsdByMonth: BRL_PER_USD_BY_MONTH },
  inflationRate: 4.5,
  checking: {
    salary: [14000, 15000, 16000], bonus: 15000,
    expense: { base: 8800, swing: 800, december: 2500 },
    balance: { start: 18000, slope: 120, swing: 1800, december: 2500 },
  },
  savings: {
    salary: [11000, 11800, 12500], interest: 0.1, trip: 16000,
    expense: { base: 8200, swing: 700, december: 0 },
    balance: { start: 60000, slope: 1100, swing: 1300 },
  },
  broker: { start: 70000, monthly: 1300, swing: 4500 },
  // a dollar account abroad: about $100 a month, no flows
  foreignAccount: { balance: { start: 3500, slope: 100, swing: 130 }, upkeep: null },
  rent: { before: 2800, after: 3000, account: 'savings' },
  home: { price: 850000, growth: 1.05 },
  rental: { price: 480000, growth: 1.05 },
  mortgage: { principal: 600000, rate: 11.5, term: 360, early: [15000, 20000, 12000, 25000], exact: EXACT },
  car: { principal: 90000, rate: 19.5, term: 48 },
  renovation: { principal: 20000, rate: 26 },
  goals: { emergency: [110000, 50000], vacation: [30000, 9000], fire: [6000000, 600000] },
  // the bathroom and the kitchen redone
  repair: 32000,
}
