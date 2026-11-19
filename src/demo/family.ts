// The fictional families, one per UI language, each in its country's currency, for the demo, the seed, the test
// fixtures and the screenshots: one generic builder fed by a FamilyProfile (profiles/). The English one is an American
// couple with dollars and euros and a rented-out apartment in Germany; the Russian one a Moscow couple with rubles and
// cash dollars; the German, Spanish and French ones live in euros, the Brazilian one in reais, the Chinese one in yuan,
// each with a dollar account. Every name, bank, amount and date is invented; only the exchange rates are real
// (eurRates.ts, rubRates.ts, brlRates.ts, cnyRates.ts). buildFamily is pure: the same `today` and family always give the
// same rows. Each field is an array of rows keyed by the column names of its table in schema.sql.
import { isoDate, monthEnd, monthOf, monthsBetween, shiftMonth } from '../domain/dates'
import { round2 } from '../domain/fx'
import { calcMonthlyPayment, computeSchedule, type LoanRow as ScheduleLoan } from '../domain/loans'
import { requiredRateDates } from '../domain/snapshot'
import type { AccountTransferInput, CashflowInput, CategoryFlow, CategorySpendingInput, FlowLineInput, GoalRow, LoanPaymentInput } from '../domain/types'
import { LANGUAGES, type Language } from '../i18n/languages'
import { DE_DE } from './profiles/de-DE'
import { EN_US } from './profiles/en-US'
import { ES_ES } from './profiles/es-ES'
import { FR_FR } from './profiles/fr-FR'
import { PT_BR } from './profiles/pt-BR'
import { RU_RU } from './profiles/ru-RU'
import { ZH_CN } from './profiles/zh-CN'
import type { DemoStrings } from './strings'

interface MemberRow { name: string }
/** Rights are 0/1 like the columns; no email or telegram_id: the demo never signs anyone in through them. */
interface UserRow { member: string; can_edit: 0 | 1; can_vote: 0 | 1; can_manage: 0 | 1; created_at: string; updated_at: string }
/** inflation = 1 — the currency the inflation parameter is measured in */
interface CurrencyRow { code: string; inflation: 0 | 1 }
interface AssetRow { date: string; class: string; name: string; value: number; currency: string; member: string }
interface LoanRow {
  name: string; description: string; issue_date: string; principal: number; rate: number; term_months: number
  monthly_payment: number; currency: string; member: string; payment_day: number; status: 'active' | 'closed'
  closed_date: string | null; type: 'mortgage' | 'consumer'
  /** The property the loan is secured by (real_estate name); null — none */
  secured_by: string | null
}
interface EarlyPaymentRow {
  loan_name: string; payment_date: string; amount: number; strategy: 'reduce_term' | 'reduce_payment'
  notes: string | null; new_payment: number | null; principal_credit: number | null
}
interface RealEstateRow {
  name: string; purchase_date: string; purchase_price: number; purchase_currency: string
  valuation_year: number; value: number; currency: string; notes: string | null; member: string
}
/** The family's own category; the reserved `loan_payments` one is not here, the migration owns it */
interface SpendingCategoryRow { id: number; name: string; kind: 'mandatory' | 'optional'; flow: CategoryFlow; one_off: 0 | 1 }
interface ParameterRow { key: string; value: number; description: string }
interface ClosedMonthRow { month: string; closed_at: string; closed_by: string }
interface FxRateRow { date: string; currency: string; per_usd: number; source_date: string }

export interface DemoFamily {
  members: MemberRow[]
  users: UserRow[]
  currencies: CurrencyRow[]
  assets: AssetRow[]
  cashflow: CashflowInput[]
  loans: LoanRow[]
  loanEarlyPayments: EarlyPaymentRow[]
  realEstate: RealEstateRow[]
  goals: GoalRow[]
  parameters: ParameterRow[]
  closedMonths: ClosedMonthRow[]
  loanPayments: LoanPaymentInput[]
  /** Written before categorySpending (its foreign key); the ids start after the reserved category's */
  spendingCategories: SpendingCategoryRow[]
  categorySpending: CategorySpendingInput[]
  /** Account lines by category (income for the last year, expenses for the statement months), after the cash-flow rows and the categories */
  flowLines: FlowLineInput[]
  /** The brokerage account's monthly deposits (account_transfers), so its result is told apart from what was put in */
  accountTransfers: AccountTransferInput[]
  /** The rates of the profile's non-USD currency for every date the snapshot needs, last month and tomorrow included, so the demo never asks the network. */
  fxRates: FxRateRow[]
}

/** One family per UI language */
export type DemoFamilyKey = Language

/** Everything that makes one demo family: its names and the numbers the builder turns into rows. */
export interface FamilyProfile {
  key: DemoFamilyKey
  strings: DemoStrings
  /** the family currency (inflation = 1) and the second one; `rates` is the one non-USD currency's real series */
  currency: string
  foreign: string
  rates: { currency: string; perUsdByMonth: Readonly<Record<string, number>> }
  inflationRate: number
  checking: { salary: [number, number, number]; bonus: number; expense: { base: number; swing: number; december: number }; balance: { start: number; slope: number; swing: number; december: number } }
  savings: { salary: [number, number, number]; interest: number; trip: number; expense: { base: number; swing: number; december: number }; balance: { start: number; slope: number; swing: number } }
  pensionA: { start: number; monthly: number; swing: number }
  pensionB: { start: number; monthly: number; swing: number }
  broker: { start: number; monthly: number; swing: number }
  foreignAccount: { balance: { start: number; slope: number; swing: number }; upkeep: { base: number; swing: number; extraMonth: number; extra: number } | null }
  /** the rental's rent: before and from month 18; lands on `savings` or on the foreign account */
  rent: { before: number; after: number; account: 'savings' | 'foreign' }
  home: { price: number; growth: number }
  rental: { price: number; growth: number }
  mortgage: { principal: number; rate: number; term: number; early: [number, number, number, number]; exact: { new_payment: number; principal_credit: number } }
  car: { principal: number; rate: number; term: number }
  goals: { emergency: [target: number, current: number]; vacation: [number, number]; fire: [number, number] }
  /** One home repair paid from the checking account, REPAIR_MONTHS_BACK months before the last closed one */
  repair: number
}

/** One family per UI language; demoFamilyLanguage picks the key. */
const PROFILES: Record<DemoFamilyKey, FamilyProfile> = {
  'en-US': EN_US, 'ru-RU': RU_RU, 'de-DE': DE_DE, 'es-ES': ES_ES, 'fr-FR': FR_FR, 'pt-BR': PT_BR, 'zh-CN': ZH_CN,
}

const membersOf = (p: FamilyProfile): readonly string[] => [p.strings.members.a, p.strings.members.b]

/** The members of every demo family, by key; tests name a family's records through it. @public */
export const DEMO_FAMILIES = Object.fromEntries(LANGUAGES.map(key => [key, { members: membersOf(PROFILES[key]) }])) as Record<DemoFamilyKey, { members: readonly string[] }>

/** One family as the demo's sign-in card lists it, in its own language: the client cannot load the other languages' texts. */
export interface DemoFamilyCard { language: DemoFamilyKey; members: [string, string]; place: string; currencies: [string, string] }

/** Every language's family for the sign-in card, in the order of LANGUAGES: the members, the country, its own currency then the second one. */
export const DEMO_FAMILY_CARDS: DemoFamilyCard[] = LANGUAGES.map(language => {
  const p = PROFILES[language]
  return { language, members: [p.strings.members.a, p.strings.members.b], place: p.strings.place, currencies: [p.currency, p.foreign] }
})

/** The family's own currency: the one marked as the inflation currency. */
export function familyCurrency(family: DemoFamily): string {
  const code = family.currencies.find(c => c.inflation === 1)?.code
  if (!code) throw new Error('the family has no inflation currency')
  return code
}

/** The family that goes with a UI language: that language's own, the English one for an unknown language; never throws. */
export function demoFamilyLanguage(language: string): DemoFamilyKey {
  return (LANGUAGES as readonly string[]).includes(language) ? language as DemoFamilyKey : 'en-US'
}

/** Closed months; they end with the month before last, which is left open for the visitor to close. */
const HISTORY_MONTHS = 36

/** The reserved `loan_payments` category the migration creates first (the loan debits of a card statement point to it) */
const LOAN_CATEGORY_ID = 1
type CategoryKey = keyof DemoStrings['categories']
/** The share of the living costs (the expenses without the loan payments) each category takes, per statement card; the shares add up to 1 */
const SPENDING_PLAN: { key: CategoryKey; kind: 'mandatory' | 'optional'; card: 'a' | 'b'; share: number }[] = [
  { key: 'housing', kind: 'mandatory', card: 'a', share: 0.16 },
  { key: 'utilities', kind: 'mandatory', card: 'a', share: 0.08 },
  { key: 'groceries', kind: 'mandatory', card: 'a', share: 0.22 },
  { key: 'transport', kind: 'mandatory', card: 'a', share: 0.09 },
  { key: 'cafes', kind: 'optional', card: 'a', share: 0.07 },
  { key: 'entertainment', kind: 'optional', card: 'a', share: 0.06 },
  { key: 'health', kind: 'mandatory', card: 'b', share: 0.06 },
  { key: 'insurance', kind: 'mandatory', card: 'b', share: 0.1 },
  { key: 'shopping', kind: 'optional', card: 'b', share: 0.08 },
  { key: 'travel', kind: 'optional', card: 'b', share: 0.04 },
  { key: 'other', kind: 'optional', card: 'b', share: 0.04 },
]
/** The months with statement lines: the last six closed ones */
const SPENDING_MONTHS = 6
/** The income categories (the allocation of an account's active or passive income); a one-off one does not repeat */
const INCOME_PLAN: { key: CategoryKey; flow: 'active' | 'passive'; oneOff: boolean }[] = [
  { key: 'salary', flow: 'active', oneOff: false },
  { key: 'bonus', flow: 'active', oneOff: true },
  { key: 'rent', flow: 'passive', oneOff: false },
  { key: 'interest', flow: 'passive', oneOff: false },
  { key: 'dividends', flow: 'passive', oneOff: false },
]
/** The months with income lines: the last twelve closed ones, so a December bonus is always among them */
const INCOME_MONTHS = 12
/** The share of the last month's salary on the checking account that its lines leave unallocated (shown as “Unallocated”) */
const UNALLOCATED_SHARE = 0.04
/** The home repair lands this many months before the last closed one: inside the statement months, so it has its line */
const REPAIR_MONTHS_BACK = 3
/** The repair's category: after the spending and income ones, so their ids stay */
const REPAIR_ID = LOAN_CATEGORY_ID + 1 + SPENDING_PLAN.length + INCOME_PLAN.length
/** The months (0-based) of the mortgage's four early payments */
const EARLY_AT = [4, 16, 22, 28] as const
/** The month (0-based) from which the rental's rent is indexed: a year and a half in */
const RENT_INDEXED_FROM = 18

/** A fixed pseudo-random step in [-1, 1) for month `i`: the history looks lived-in and stays deterministic. */
const wobble = (i: number, salt: number) => (((i + 1) * 7919 + salt * 104729) % 997) / 498.5 - 1
const roundTo = (v: number, step: number) => Math.round(v / step) * step

/** A loan row in the shape computeSchedule reads. */
const scheduleLoan = (l: LoanRow): ScheduleLoan => ({ rowid: 0, ...l })

/** The scheduled payment of the loan in month `ym`; 0 when there is none. */
function paymentIn(schedule: ReturnType<typeof computeSchedule>, ym: string): number {
  return schedule.find(r => monthOf(r.date) === ym)?.scheduledPayment ?? 0
}

/**
 * The profile's non-USD currency per USD in month `ym`: the real one from its table; after it, the table's last value
 * with a small deterministic wobble (±1%); before it, the table's first value.
 */
function ratePerUsd(profile: FamilyProfile, ym: string): number {
  const table = profile.rates.perUsdByMonth
  const known = table[ym]
  if (known !== undefined) return known
  const rateMonths = Object.keys(table).sort()
  const first = rateMonths[0]
  const last = rateMonths[rateMonths.length - 1]
  if (ym < first) return table[first]
  return Math.round(table[last] * (1 + 0.01 * wobble(monthsBetween(last, ym), 11)) * 1e5) / 1e5
}

export function buildFamily({ today = isoDate(new Date()), family = 'en-US' }: { today?: string; family?: DemoFamilyKey } = {}): DemoFamily {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`today must be YYYY-MM-DD, got ${today}`)
  const p = PROFILES[family]
  const s = p.strings
  const [memberA, memberB] = [s.members.a, s.members.b]
  const { checking: CHECKING, savings: SAVINGS, pensionA: PENSION_A, pensionB: PENSION_B, broker: BROKER, foreign: FOREIGN_BANK } = s.accounts
  const MORTGAGE = s.loans.mortgage.name
  const CAR_LOAN = s.loans.car.name
  const cur = p.currency
  // Last month has no rows: it waits in the month-close wizard. The history ends the month before it.
  const open = shiftMonth(monthOf(today), -1)
  const last = shiftMonth(open, -1)
  const first = shiftMonth(last, 1 - HISTORY_MONTHS)
  const months = Array.from({ length: HISTORY_MONTHS }, (_, i) => shiftMonth(first, i))
  const lastYear = Number(last.slice(0, 4))
  const at = (offset: number, day: string) => `${shiftMonth(first, offset)}-${day}`

  // ── Loans: a 30-year mortgage on the home, paid down early four times, and a five-year car loan ──
  const m = p.mortgage
  const mortgage: LoanRow = {
    name: MORTGAGE, description: s.loans.mortgage.description,
    issue_date: at(-13, '15'), principal: m.principal, rate: m.rate, term_months: m.term,
    monthly_payment: round2(calcMonthlyPayment(m.principal, m.rate, m.term)), currency: cur, member: memberA,
    payment_day: 15, status: 'active', closed_date: null, type: 'mortgage',
    // the mortgage is secured by the home: Real estate shows the family's equity in it
    secured_by: s.properties.home,
  }
  const carLoan: LoanRow = {
    name: CAR_LOAN, description: s.loans.car.description,
    issue_date: at(4, '10'), principal: p.car.principal, rate: p.car.rate, term_months: p.car.term,
    monthly_payment: round2(calcMonthlyPayment(p.car.principal, p.car.rate, p.car.term)), currency: cur, member: memberB,
    payment_day: 10, status: 'active', closed_date: null, type: 'consumer', secured_by: null,
  }
  const loanEarlyPayments: EarlyPaymentRow[] = [
    { loan_name: MORTGAGE, payment_date: at(EARLY_AT[0], '20'), amount: m.early[0], strategy: 'reduce_payment', notes: s.notes.bankStatement, new_payment: m.exact.new_payment, principal_credit: m.exact.principal_credit },
    { loan_name: MORTGAGE, payment_date: at(EARLY_AT[1], '08'), amount: m.early[1], strategy: 'reduce_term', notes: s.notes.annualBonus, new_payment: null, principal_credit: null },
    { loan_name: MORTGAGE, payment_date: at(EARLY_AT[2], '14'), amount: m.early[2], strategy: 'reduce_payment', notes: null, new_payment: null, principal_credit: null },
    { loan_name: MORTGAGE, payment_date: at(EARLY_AT[3], '09'), amount: m.early[3], strategy: 'reduce_term', notes: s.notes.annualBonus, new_payment: null, principal_credit: null },
  ]
  const mortgageSchedule = computeSchedule(scheduleLoan(mortgage), loanEarlyPayments.map((e, i) => ({ rowid: i + 1, id: i + 1, ...e })))
  const carSchedule = computeSchedule(scheduleLoan(carLoan), [])

  // ── Month-end balances and first-of-month flows; every account has both, as the wizard writes them ──
  const assets: AssetRow[] = []
  const cashflow: CashflowInput[] = []
  const loanPayments: LoanPaymentInput[] = []
  const spendingCategories: SpendingCategoryRow[] = [
    ...SPENDING_PLAN.map((c, i) => ({ id: LOAN_CATEGORY_ID + 1 + i, name: s.categories[c.key], kind: c.kind, flow: 'expense' as const, one_off: 0 as const })),
    ...INCOME_PLAN.map((c, i) => ({ id: LOAN_CATEGORY_ID + 1 + SPENDING_PLAN.length + i, name: s.categories[c.key], kind: 'optional' as const, flow: c.flow, one_off: c.oneOff ? 1 as const : 0 as const })),
    // the repair's own category, last, so the ids before it stay
    { id: REPAIR_ID, name: s.categories.repair, kind: 'optional' as const, flow: 'expense' as const, one_off: 0 as const },
  ]
  const repairAt = HISTORY_MONTHS - 1 - REPAIR_MONTHS_BACK
  const incomeId = (key: CategoryKey) => LOAN_CATEGORY_ID + 1 + SPENDING_PLAN.length + INCOME_PLAN.findIndex(c => c.key === key)
  const categorySpending: CategorySpendingInput[] = []
  const flowLines: FlowLineInput[] = []
  const accountTransfers: AccountTransferInput[] = []
  const sb = p.savings.balance
  const savingsAt = (i: number) => roundTo(sb.start + sb.slope * i + wobble(i, 3) * sb.swing, 10)
  const growing = ({ start, monthly, swing }: { start: number; monthly: number; swing: number }, i: number, salt: number) =>
    roundTo(start * Math.pow(1.006, i) + monthly * i + wobble(i, salt) * swing, 10)
  const brokerAt = (i: number) => growing(p.broker, i, 5)
  months.forEach((ym, i) => {
    const date = monthEnd(ym)
    const flowDate = `${ym}-01`
    const month = Number(ym.slice(5, 7))
    const december = month === 12
    const year = i < 12 ? 0 : i < 24 ? 1 : 2
    const rent = i < RENT_INDEXED_FROM ? p.rent.before : p.rent.after
    const balance = (name: string, cls: string, value: number, currency: string, member: string) =>
      assets.push({ date, class: cls, name, value, currency, member })
    const flow = (bank: string, member: string, currency: string, active: number, passive: number, expense: number) =>
      cashflow.push({ date: flowDate, bank, member, active_income: active, passive_income: passive, expense, currency })

    // Member A's salary and December bonus land in the checking account, which pays the bills; the mortgage payment is
    // its own loan_payments row, not part of the account's expense.
    // One month pays a home repair on top, from money the account held for it until then.
    // It also holds the money of the early mortgage payments still to come: each leaves it the month it is paid, a
    // transfer to the debt, not an expense (as a loan payment), so net worth does not jump when the debt drops.
    const ck = p.checking
    const repair = i === repairAt ? p.repair : 0
    const earlyAhead = EARLY_AT.reduce((sum, at, k) => sum + (i < at ? m.early[k] : 0), 0)
    const checkingExpense = roundTo(ck.expense.base + wobble(i, 7) * ck.expense.swing + (december ? ck.expense.december : 0), 10) + repair
    balance(CHECKING, 'bank', roundTo(ck.balance.start + ck.balance.slope * i + wobble(i, 1) * ck.balance.swing - (december ? ck.balance.december : 0) + (i < repairAt ? p.repair : 0) + earlyAhead, 10), cur, memberA)
    flow(CHECKING, memberA, cur, ck.salary[year] + (december ? ck.bonus : 0), 0, checkingExpense)
    const incomeBrokenDown = i >= HISTORY_MONTHS - INCOME_MONTHS
    const incomeLine = (bank: string, member: string, key: CategoryKey, amount: number) => {
      if (incomeBrokenDown && amount > 0) flowLines.push({ date: flowDate, bank, member, category_id: incomeId(key), amount })
    }
    // The newest month leaves a slice of the salary unallocated: the Unallocated line of the breakdown.
    incomeLine(CHECKING, memberA, 'salary', ck.salary[year] - (i === HISTORY_MONTHS - 1 ? roundTo(ck.salary[year] * UNALLOCATED_SHARE, 10) : 0))
    incomeLine(CHECKING, memberA, 'bonus', december ? ck.bonus : 0)

    // Member B's salary goes to the savings account; it pays her card and the summer trip (the car loan payment is a
    // loan_payments row too), earns interest, and receives the rent when the profile books it there.
    const sv = p.savings
    const trip = month === 7 ? sv.trip : 0
    const savingsExpense = roundTo(sv.expense.base + wobble(i, 8) * sv.expense.swing + trip + (december ? sv.expense.december : 0), 10)
    const interest = Math.round(savingsAt(i - 1) * sv.interest / 12)
    balance(SAVINGS, 'bank', savingsAt(i), cur, memberB)
    flow(SAVINGS, memberB, cur, sv.salary[year], interest + (p.rent.account === 'savings' ? rent : 0), savingsExpense)
    incomeLine(SAVINGS, memberB, 'salary', sv.salary[year])
    incomeLine(SAVINGS, memberB, 'interest', interest)
    incomeLine(SAVINGS, memberB, 'rent', p.rent.account === 'savings' ? rent : 0)

    // Every closed month is in the loan-payment model: what the schedule asks of each loan.
    for (const [loan, schedule] of [[MORTGAGE, mortgageSchedule], [CAR_LOAN, carSchedule]] as const) {
      const amount = round2(paymentIn(schedule, ym))
      if (amount > 0) loanPayments.push({ date: flowDate, loan_name: loan, amount, currency: cur })
    }

    // The last six months have the statements by category: card A is the checking account's, card B the savings
    // account's, so their categories are lines of those accounts (about 90% of each account's expense, the foreign
    // account's upkeep is not on them). The loan debits stay on the cards as sources, on top. The trip lands in Travel.
    if (i >= HISTORY_MONTHS - SPENDING_MONTHS) {
      const covered = 0.86 + 0.06 * (wobble(i, 13) + 1) / 2
      const accounts = { a: { bank: CHECKING, member: memberA, expense: checkingExpense - repair, trip: 0 }, b: { bank: SAVINGS, member: memberB, expense: savingsExpense, trip } }
      SPENDING_PLAN.forEach((c, k) => {
        const account = accounts[c.card]
        const cardShare = SPENDING_PLAN.filter(x => x.card === c.card).reduce((sum, x) => sum + x.share, 0)
        const living = account.expense - account.trip
        const amount = roundTo(living * covered * (c.share / cardShare) * (1 + 0.06 * wobble(i, 20 + k)) + (c.key === 'travel' ? account.trip * 0.9 : 0), 10)
        flowLines.push({ date: flowDate, bank: account.bank, member: account.member, category_id: LOAN_CATEGORY_ID + 1 + k, amount })
      })
      if (repair) flowLines.push({ date: flowDate, bank: CHECKING, member: memberA, category_id: REPAIR_ID, amount: repair })
      const [mortgageRow, carRow] = [MORTGAGE, CAR_LOAN].map(name => loanPayments.find(l => l.date === flowDate && l.loan_name === name))
      if (mortgageRow) categorySpending.push({ date: flowDate, category_id: LOAN_CATEGORY_ID, source: s.cards.a, amount: mortgageRow.amount, currency: cur })
      if (carRow) categorySpending.push({ date: flowDate, category_id: LOAN_CATEGORY_ID, source: s.cards.b, amount: carRow.amount, currency: cur })
    }

    // Two pension accounts, filled from payroll before the salary arrives: their balances grow with no flows of their own.
    balance(PENSION_A, 'broker', growing(p.pensionA, i, 4), cur, memberA)
    flow(PENSION_A, memberA, cur, 0, 0, 0)
    balance(PENSION_B, 'broker', growing(p.pensionB, i, 6), cur, memberB)
    flow(PENSION_B, memberB, cur, 0, 0, 0)

    // The brokerage account pays dividends every quarter.
    balance(BROKER, 'broker', brokerAt(i), cur, memberA)
    // what the family puts in every month: the trend of the balance; the swing around it is the market
    accountTransfers.push({ date: flowDate, name: BROKER, member: memberA, amount: p.broker.monthly, currency: cur })
    const dividends = month % 3 === 0 ? roundTo(brokerAt(i) * 0.004, 10) : 0
    flow(BROKER, memberA, cur, 0, dividends, 0)
    incomeLine(BROKER, memberA, 'dividends', dividends)

    // The foreign-currency account: it receives the rental's rent (indexed after a year and a half) and pays its upkeep
    // when the profile books them there; otherwise it only holds a balance.
    const fb = p.foreignAccount.balance
    const upkeep = p.foreignAccount.upkeep
    balance(FOREIGN_BANK, 'bank', roundTo(fb.start + fb.slope * i + wobble(i, 2) * fb.swing, 10), p.foreign, memberB)
    flow(FOREIGN_BANK, memberB, p.foreign, 0, p.rent.account === 'foreign' ? rent : 0,
      upkeep ? roundTo(upkeep.base + wobble(i, 9) * upkeep.swing + (month === upkeep.extraMonth ? upkeep.extra : 0), 10) : 0)
    incomeLine(FOREIGN_BANK, memberB, 'rent', p.rent.account === 'foreign' ? rent : 0)
  })

  // ── Two properties, valued once a year from the purchase year to last year ──
  const valuations = (name: string, member: string, purchaseDate: string, price: number, currency: string, growth: number): RealEstateRow[] => {
    const bought = Number(purchaseDate.slice(0, 4))
    return Array.from({ length: lastYear - bought }, (_, k) => ({
      name, member, purchase_date: purchaseDate, purchase_price: price, purchase_currency: currency,
      valuation_year: bought + k, value: roundTo(price * Math.pow(growth, k), 500), currency,
      notes: k === 0 ? s.notes.agentEstimate : null,
    }))
  }
  const realEstate = [
    // The home the family lives in; member A holds it, as they hold its mortgage.
    ...valuations(s.properties.home, memberA, mortgage.issue_date, p.home.price, cur, p.home.growth),
    // Member B bought the apartment years ago and rents it out; it is priced in the currency its rent arrives in.
    ...valuations(s.properties.rental, memberB, at(-90, '01'), p.rental.price, p.rent.account === 'foreign' ? p.foreign : cur, p.rental.growth),
  ]

  const g = p.goals
  const goals: GoalRow[] = [
    { id: 'emergency', name: s.goals.emergency, target: g.emergency[0], current: g.emergency[1], target_date: `${lastYear + 1}-12-31`, emoji: null, currency: cur },
    { id: 'vacation', name: s.goals.vacation, target: g.vacation[0], current: g.vacation[1], target_date: `${lastYear + 1}-05-31`, emoji: null, currency: cur },
    { id: 'fire', name: s.goals.fire, target: g.fire[0], current: g.fire[1], target_date: `${lastYear + 14}-12-31`, emoji: null, currency: cur },
  ]

  const parameters: ParameterRow[] = [{ key: 'inflation_rate', value: p.inflationRate, description: s.parameters.inflation }]

  // A rate for every day the snapshot needs (balance month ends, cash-flow months, today), for last month's two days
  // (closing it in the wizard works offline), and for tomorrow (a sandbox opened late in the UTC day outlives it).
  const tomorrow = isoDate(new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000))
  const rateDates = new Set([...requiredRateDates({ assets, cashflow, loanPayments, categorySpending }, new Date(`${today}T00:00:00Z`)), `${open}-01`, monthEnd(open), tomorrow])
  const fxRates = [...rateDates].sort().map(date => ({ date, currency: p.rates.currency, per_usd: ratePerUsd(p, monthOf(date)), source_date: date }))

  return {
    members: [memberA, memberB].map(name => ({ name })),
    // Member A manages, member B enters data and votes; the demo itself runs with all rights (AUTH_MODE=demo)
    users: [
      { member: memberA, can_edit: 1, can_vote: 1, can_manage: 1, created_at: `${today}T00:00:00.000Z`, updated_at: `${today}T00:00:00.000Z` },
      { member: memberB, can_edit: 1, can_vote: 1, can_manage: 0, created_at: `${today}T00:00:00.000Z`, updated_at: `${today}T00:00:00.000Z` },
    ],
    // the family spends in its own currency: its inflation is that currency's
    currencies: [{ code: cur, inflation: 1 }, { code: p.foreign, inflation: 0 }],
    assets,
    cashflow,
    loans: [mortgage, carLoan],
    loanEarlyPayments,
    realEstate,
    goals,
    parameters,
    // Each month was closed on the first day of the next one.
    closedMonths: months.map(month => ({ month, closed_at: `${shiftMonth(month, 1)}-01T00:00:00.000Z`, closed_by: 'seed' })),
    // Reminders stay off: the demo never talks to Telegram.
    loanPayments,
    spendingCategories,
    categorySpending,
    flowLines,
    accountTransfers,
    fxRates,
  }
}
