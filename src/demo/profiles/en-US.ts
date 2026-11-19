// The American family: Ryan and Annika, dollars and euros, a house in the USA and a rented-out apartment in Germany.
// These are the constants the screenshots and the tests were taken with; changing one changes every generated row.
import { EUR_PER_USD_BY_MONTH } from '../eurRates'
import type { FamilyProfile } from '../family'
import type { DemoStrings } from '../strings'
import en from '../en-US.json'

const strings: DemoStrings = en

export const EN_US: FamilyProfile = {
  key: 'en-US',
  strings,
  currency: 'USD',
  foreign: 'EUR',
  rates: { currency: 'EUR', perUsdByMonth: EUR_PER_USD_BY_MONTH },
  inflationRate: 3,
  checking: {
    salary: [6600, 6850, 7100], bonus: 7000,
    expense: { base: 3700, swing: 350, december: 900 },
    balance: { start: 8600, slope: 30, swing: 900, december: 1200 },
  },
  savings: {
    salary: [5000, 5250, 5450], interest: 0.042, trip: 3800,
    expense: { base: 3700, swing: 300, december: 0 },
    balance: { start: 21000, slope: 330, swing: 400 },
  },
  broker: { start: 20000, monthly: 350, swing: 1500 },
  foreignAccount: {
    balance: { start: 5200, slope: 260, swing: 450 },
    upkeep: { base: 310, swing: 60, extraMonth: 3, extra: 640 },
  },
  rent: { before: 1050, after: 1120, account: 'foreign' },
  home: { price: 520000, growth: 1.03 },
  rental: { price: 216000, growth: 1.037 },
  mortgage: { principal: 416000, rate: 6.5, term: 360, early: [5000, 6000, 4000, 7500], exact: { new_payment: 2597.36, principal_credit: 4991.35 } },
  car: { principal: 25000, rate: 7, term: 60 },
  goals: { emergency: [63000, 32000], vacation: [9000, 3400], fire: [2000000, 205000] },
  // a new roof
  repair: 7200,
}
