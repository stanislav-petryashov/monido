// The Russian family: Artyom and Polina, rubles and cash dollars, an apartment in Moscow with a 20-year mortgage and a
// rented-out apartment in Kazan. The numbers are the spec's (section 2); only the swings of the growing accounts are
// the builder's choice. Changing one changes every generated row.
import { RUB_PER_USD_BY_MONTH } from '../rubRates'
import type { FamilyProfile } from '../family'
import type { DemoStrings } from '../strings'
import ru from '../ru-RU.json'

const strings: DemoStrings = ru

export const RU_RU: FamilyProfile = {
  key: 'ru-RU',
  strings,
  currency: 'RUB',
  foreign: 'USD',
  rates: { currency: 'RUB', perUsdByMonth: RUB_PER_USD_BY_MONTH },
  inflationRate: 8,
  checking: {
    salary: [210000, 230000, 250000], bonus: 150000,
    expense: { base: 95000, swing: 9000, december: 30000 },
    balance: { start: 320000, slope: 2500, swing: 60000, december: 80000 },
  },
  savings: {
    // the expense holds the Kazan apartment's upkeep (about 6 000) and, in December, its property tax
    salary: [150000, 160000, 170000], interest: 0.13, trip: 180000,
    expense: { base: 91000, swing: 8000, december: 9000 },
    balance: { start: 650000, slope: 28000, swing: 35000 },
  },
  pensionA: { start: 1200000, monthly: 45000, swing: 60000 },
  pensionB: { start: 600000, monthly: 20000, swing: 30000 },
  broker: { start: 900000, monthly: 25000, swing: 40000 },
  // cash dollars: the family buys about $150 a month; no flows
  foreignAccount: { balance: { start: 5000, slope: 150, swing: 120 }, upkeep: null },
  rent: { before: 32000, after: 35000, account: 'savings' },
  home: { price: 13500000, growth: 1.06 },
  rental: { price: 4200000, growth: 1.09 },
  mortgage: { principal: 9500000, rate: 10.4, term: 240, early: [300000, 400000, 250000, 500000], exact: { new_payment: 91168.74, principal_credit: 299573.21 } },
  car: { principal: 1500000, rate: 16.9, term: 60 },
  goals: { emergency: [1500000, 900000], vacation: [600000, 220000], fire: [60000000, 5100000] },
}
