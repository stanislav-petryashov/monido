// Domain types shared by the server (snapshot) and the browser.
import type { AccountClass } from './accounts'
import type { LoanEarlyPayment, LoanRow } from './loans'
import type { AccountClosure, ClosedMonth, MonthProblem } from './monthClose'
import type { CategorisedMonth, MandatorySpending } from './spending'

/** Units of each currency per 1 USD on one day; USD is implicit (always 1) and never stored. A currency without a rate has no key. */
export type Rates = Readonly<Record<string, number>>
/** Rates for a calendar day 'YYYY-MM-DD'; an empty object when no rate is known at all. */
export type RateLookup = (date: string) => Rates

/** One account's problem in the month that cannot be closed (`name` is empty for a problem of the whole month). */
export interface ProblemParam { name: string; member: string; problem: MonthProblem }

/**
 * Parameters of a message the client translates: raw data only — names, 'YYYY-MM' months, numbers.
 * Never prose, never pre-formatted numbers. `context` picks a message variant (i18next: `<key>_<context>`).
 * The one structured value is a problem list, rendered by the `problems` formatter (`{{problems, problems}}`).
 */
export type MsgParams = Record<string, string | number | readonly string[] | readonly ProblemParam[]>

type WarningCode =
  | 'empty_data' | 'missing_balance' | 'missing_cashflow' | 'open_month_rows'
  | 'fx_fallback' | 'fx_unknown_currency' | 'short_history' | 'lines_exceed_total' | 'orphan_lines'
  // the advisor's loan tools: the bank's remaining balance of a loan beyond the schedule's tolerance
  | 'loan_balance_differs'
/** A data warning; the client renders `t(`warnings.${code}`, params)`. */
export interface Warning { code: WarningCode; ref?: string; params?: MsgParams }

export interface AssetInput { date: string; class: string; name: string; value: number; currency: string; member: string | null }
export interface CashflowInput {
  date: string; bank: string; member: string
  active_income: number; passive_income: number; expense: number; currency: string
}
/** What was put into (plus) or taken out of (minus) an investment account in a month; `date` is the month's first day. */
export interface AccountTransferInput { date: string; name: string; member: string; amount: number; currency: string }
/** What was actually paid on a loan in a month; `date` is the month's first day. */
export interface LoanPaymentInput { date: string; loan_name: string; amount: number; currency: string }
/** What a category is for: `mandatory` feeds the advisor's reserve, `loan_payment` is the one reserved category of loan payments. */
export type CategoryKind = 'mandatory' | 'optional' | 'loan_payment'
/** The monthly_cashflow column a category allocates: `expense`, or income — `active_income` / `passive_income`. */
export type CategoryFlow = 'expense' | 'active' | 'passive'
export type CategoryDirection = 'income' | 'expense'
export const directionOf = (flow: CategoryFlow): CategoryDirection => (flow === 'expense' ? 'expense' : 'income')
/**
 * A category of the family's list. `kind` applies to expense categories; an income one holds the stored default
 * `optional`, which means nothing for it. `oneOff` marks an income that does not repeat (a bonus); no metric reads it yet.
 */
export interface SpendingCategory { id: number; name: string; kind: CategoryKind; flow: CategoryFlow; oneOff: boolean }
/** One account's amount in one category for a month; `date` is the month's first day; the currency is the account row's. */
export interface FlowLineInput { date: string; bank: string; member: string; category_id: number; amount: number }
/** A month's spending in one category from one statement source; `date` is the month's first day. */
export interface CategorySpendingInput { date: string; category_id: number; source: string; amount: number; currency: string }
/** A mandatory monthly spending the family typed by hand, used when there is no category data. */
export interface ManualMandatory { amount: number; currency: string; updated_at: string }
export interface RealEstateInput {
  name: string; purchase_date: string; purchase_price: number; purchase_currency: string
  valuation_year: number; value: number; currency: string
  /** The owner; null — none set */
  member: string | null
}
export interface AccountTransferInput { date: string; name: string; member: string; amount: number; currency: string }
export interface GoalRow {
  id: string; name: string; target: number; current: number
  target_date: string; emoji: string | null; currency: string
}
export interface FinanceRows {
  assets: AssetInput[]
  cashflow: CashflowInput[]
  /** Month-by-month loan payments; a closed month without rows is a legacy month whose account expenses already hold them */
  loanPayments: LoanPaymentInput[]
  /** The family's spending categories (the reserved `loan_payments` one included) */
  spendingCategories: SpendingCategory[]
  /** Month totals by category and free statement source (a card, cash: not an account) */
  categorySpending: CategorySpendingInput[]
  /** Lines by category allocating an account's month totals (the monthly_cashflow row with the same date, bank and member) */
  flowLines: FlowLineInput[]
  /** The hand-typed mandatory spending; null — not set */
  manualMandatory: ManualMandatory | null
  realEstate: RealEstateInput[]
  loans: LoanRow[]
  earlyPayments: LoanEarlyPayment[]
  /** Deposits (+) and withdrawals (−) of investment accounts by month, in each account's currency (`account_transfers`); absent — none read */
  accountTransfers?: AccountTransferInput[]
  goals: GoalRow[]
  parameters: Record<string, number>
  /** The dashboard sees only these months; balance and flow rows of other months are ignored */
  closedMonths: ClosedMonth[]
  /** Accounts the wizard closed: one closed last month is not missing this month; none — no closures */
  closures?: AccountClosure[]
  /** The family tracks income and expenses (Settings → Parameters); false — the snapshot reads no flows, as if none were entered */
  trackFlows: boolean
  /** Codes of the project's currencies, sorted */
  currencies: string[]
  /** Family member names in the order they were added (rowid): the stable order that gives each person a tag colour */
  members: string[]
  /** The currency inflation (`inflation_rate`) is measured in; null — not set */
  inflationCurrency: string | null
}

export type GoalStatus = 'done' | 'on_track' | 'at_risk' | 'unreachable'
export interface GoalAllocation {
  goal: GoalRow
  progressPct: number
  monthsToDeadline: number
  requiredMonthlyBase: number
  allocBase: number
  /** The plan's share month by month, index 0 the month after today, up to the month the goal is reached or the horizon; empty — the savings are unknown */
  shares: number[]
  /** null — the savings are unknown (income and expenses are not tracked): only a reached goal is known */
  status: GoalStatus | null
  projectedDate: string | null   // 'YYYY-MM' or null when unreachable or unknown
  /**
   * Why an `unreachable` goal is never reached: no_savings — nothing is saved; taken_ahead — it never gets a share, nearer
   * goals take all the savings; over_horizon — it gets money but not enough within PROJECTION_HORIZON_MONTHS. Absent otherwise
   */
  unreachableReason?: 'no_savings' | 'taken_ahead' | 'over_horizon'
}
export interface GoalsPlan {
  allocations: GoalAllocation[]
  totalRequiredBase: number
  /** null — unknown: income and expenses are not tracked */
  monthlySavingsBase: number | null
  surplusBase: number | null      // savings − totalRequired (negative = deficit); null — the savings are unknown
}
export interface CoastFire { reached: boolean; gapBase: number }
export interface GoalItem extends GoalRow { targetBase: number | null; currentBase: number | null }
export interface FireSummary {
  goalId: string
  targetBase: number
  currentBase: number
  progressPct: number
  /** Already reached: what it holds is at least its target (then `forecastMonth` is this month) */
  reached: boolean
  /** The month the plan reaches it, the 8% return included ('YYYY-MM'; this month once reached); null — never within the horizon, or the savings are unknown */
  forecastMonth: string | null
  /** What it holds by its deadline month on the plan; null — the savings are unknown */
  atDeadlineBase: number | null
  /** The plan re-run at the low and high returns (fireReturnRange): the month each reaches it (null — never, or unknown) */
  strategies: { low: string | null; high: string | null }
  /** What it holds month by month (index 0 today) on the plan and at the low and high returns, to the month each reaches it or the horizon; null — the savings are unknown */
  series: { pace: number[]; low: number[]; high: number[] } | null
  coastFire: CoastFire
  actualCagr: number | null
  requiredCagr: number | null
}

export interface AccountValue { name: string; member: string; class: AccountClass; currency: string; value: number; valueBase: number | null }
/** member: the owner; '' — none set */
export interface RealEstateValue { name: string; member: string; currency: string; value: number; valueBase: number | null }
export interface LoanBalance {
  name: string; member: string; type: string; currency: string; rate: number
  balance: number; balanceBase: number | null
  /** The scheduled payment of the snapshot month (the schedule's, early payments included; 0 when none falls in it); `paymentBase` is converted at the month-end rate, null — no rate */
  payment: number; paymentBase: number | null
  /** Share of the original loan amount already repaid, % (0–100); null — the amount is unknown */
  repaidPct: number | null
  /** Scheduled interest for the 12 months after the snapshot date */
  interestNext12m: number; interestNext12mBase: number | null
}
/**
 * A loan secured by a property of the snapshot (`loans.secured_by`), issued by the snapshot date: its balance there from
 * the schedule (early payments included), 0 once closed; `balanceBase` at the month-end rate, null — no rate (0 owed is 0 in any currency). A link to a
 * property the snapshot does not hold is left out.
 */
export interface SecuredLoan {
  name: string; property: string; currency: string
  principal: number; issueDate: string
  /** The loan's type ('mortgage', 'consumer', 'car'): the page names a mortgage so */
  type: string
  balance: number; balanceBase: number | null
}
export interface CapitalSnapshot {
  date: string                   // last day of the snapshot month
  assets: number; liabilities: number; netWorth: number; liquid: number
  byClass: { class: AccountClass | 'real_estate'; valueBase: number }[]
  /** Assets by the currency they are held in (value in the base currency); like byClass, largest first and without rate-less rows */
  byCurrency: { currency: string; valueBase: number }[]
  /** Assets by owner; '' — no member (accounts and properties without one) */
  byMember: { member: string; valueBase: number }[]
  accounts: AccountValue[]
  realEstate: RealEstateValue[]
  loans: LoanBalance[]
  securedLoans: SecuredLoan[]
}
export interface HistoryPoint { date: string; assets: number; liabilities: number; netWorth: number }

/** A rare, earned event of a closed month (src/domain/milestones.ts); amounts in `currency`, the family's */
export type MilestoneKind = 'loanPaidOff' | 'emergencyFund' | 'addedThisYear' | 'netWorthMark'
export interface Milestone {
  month: string; kind: MilestoneKind; level?: number; params: Record<string, string | number>; currency?: string
  /** The month's most important milestone; the others are listed after it */
  headline: boolean
  /** False for a month closed by a history import or a migration: never announced */
  celebrated: boolean
}
/** A net-worth mark passed for the first time without the family carrying it: a recap fact, not a milestone */
export interface MarkCrossing { month: string; level: number; currency: string }
/** A cause of a month's net-worth change (src/domain/capitalChange.ts) */
export type ChangeRowKey = 'saved' | 'accounts' | 'debtPaid' | 'earlyInterest' | 'investments' | 'fx' | 'property' | 'moves' | 'unexplained'
/** One holding's part of a row, in the base currency; `native` — the own-currency amount the part is computed from */
export interface ChangeItem { kind: 'account' | 'realEstate' | 'loan'; name: string; member: string; currency: string; amount: number; native?: number }
/** A move inside net worth (the `moves` row): a purchase, a sale, a new loan, an early repayment, and the accounts' side that balances them */
export interface ChangePair { kind: 'purchase' | 'sale' | 'newLoan' | 'early' | 'accounts'; name: string; amount: number }
/** An account that may explain the unexplained row: it moved with no income or expense recorded, or it is an investment account without its deposits */
export interface ChangeCandidate { name: string; member: string; reason: 'no_record' | 'no_transfer'; change: number }
/**
 * A closed month's net-worth change by cause, in the base currency. The rows always add up to `end − start`.
 * `tracked` rows: saved, debtPaid, investments, fx, property, unexplained (+ earlyInterest and moves when the month has them);
 * `balances` (no flows that month) rows: accounts, debtPaid, fx, property (+ earlyInterest, moves).
 */
export interface MonthChange {
  month: string
  form: 'tracked' | 'balances'
  start: number; end: number
  rows: Partial<Record<ChangeRowKey, number>>
  items: Partial<Record<'debtPaid' | 'fx' | 'property' | 'investments', ChangeItem[]>>
  pairs: ChangePair[]
  candidates: ChangeCandidate[]
  /** Base units per unit of each foreign currency held at both ends */
  rates: { currency: string; start: number; end: number }[]
}
/** A closed month that cannot be broken down, and why: never a row of zeros */
export interface MonthChangeGap {
  month: string; reason: 'no_balance' | 'no_rate' | 'no_previous'
  /** The month whose balance or rate is missing when it is the month before, not `month` itself */
  at?: string
}

export interface CashflowRowBase {
  month: string; bank: string; member: string; currency: string
  /** The row is a loan payment (`bank` is the loan's name), not an account */
  loan?: true
  active: number; passive: number; expense: number
  activeBase: number | null; passiveBase: number | null; expenseBase: number | null
}
export interface MonthTotals { month: string; income: number; active: number; passive: number; expense: number; net: number }
/** A month of a trend: its totals, or all null — a row of the month has no rate, so its totals are unknown */
export type MonthFlow = MonthTotals | { month: string; income: null; active: null; passive: null; expense: null; net: null }
export interface SavingsSummary {
  months: number                 // months with data in the window
  incomePerMonth: number
  expensePerMonth: number
  passivePerMonth: number
  netPerMonth: number
  ratePct: number | null         // null when there is no income
}

/** Why a month is left out of growth beyond savings; one reason per month, checked in this order */
export type ReturnSkipReason = 'no_balance' | 'no_rate' | 'no_cashflow' | 'nonpositive_start'
/** One month of growth beyond savings: net worth at the end of the month before and of this month, the month's net saving, its Dietz rate */
export interface ReturnMonth { month: string; startNetWorth: number; endNetWorth: number; saving: number; monthlyRate: number }
/** Growth of net worth beyond the family's own savings and the inputs it used, so a text can quote them without recomputing */
export interface GrowthBeyondSavings {
  /** A year's growth, a fraction (0.054 = 5.4 %); null — fewer than `minMonths` used months, or the chain lost everything */
  annualRate: number | null
  /** The chained growth over the used months, before it is brought to a year; null — no used month */
  growthTotal: number | null
  /** The used months, ascending */
  months: ReturnMonth[]
  monthsSkipped: { month: string; reason: ReturnSkipReason }[]
  /** Months from the first balance to the latest one: used + skipped */
  monthsConsidered: number
  minMonths: number
  /**
   * Net worth at the start of the first used month and at the end of the last one; the savings of the used months.
   * With a month left out inside the span, end − start − saved also holds that month's move: `growthAmount` does not
   */
  startNetWorth: number | null
  endNetWorth: number | null
  savingsTotal: number | null
  /** Σ (NW_end − NW_start − saving) over the used months: the money the rate is made of */
  growthAmount: number | null
}

export type Zone = 'red' | 'amber' | 'green' | 'excellent'
export type HealthKey =
  | 'savings_rate' | 'emergency_months' | 'fi_rate' | 'debt_to_asset'
  | 'real_growth_yoy' | 'avg_debt_rate' | 'consumer_debt_months' | 'debt_payment_ratio' | 'income_diversification'
export interface HealthReport {
  composite: number | null
  metrics: Partial<Record<HealthKey, { value: number | null; zone: Zone | null }>>
}

/** Yearly inflation, %, of the currency the family spends in */
export interface Inflation {
  ratePct: number
  currency: string
  /** Net worth now and a year ago in `currency` — what real growth is computed from; null — not computed */
  netWorthNow: number | null
  netWorthYearAgo: number | null
}

/** The window an asset change is measured over: a month, a quarter, a year, the whole history */
export const ASSET_PERIODS = ['month', 'quarter', 'year', 'all'] as const
export type AssetPeriod = typeof ASSET_PERIODS[number]

export interface AccountLifecycleEvidence {
  name: string
  member: string
  firstObservedMonth: string
  lastObservedMonth: string
  /** The latest closing through the endpoint; a name reused after a closing may have earlier ones */
  closedMonth: string | null
}

export interface FinanceSnapshot {
  generatedAt: string
  /** The currency of every amount in the snapshot (`…Base` fields, totals, history) */
  baseCurrency: string
  /** The family's expected yearly return as a fraction (expectedReturn: the `expected_return` parameter, else 8%): the independence goal grows at it */
  expectedReturn: number
  /** The family's default currency (Settings); the dashboard opens in it, a quick view may show another `baseCurrency` */
  familyCurrency: string
  /** Codes of the project's currencies, sorted */
  currencies: string[]
  /** Family member names in the order they were added: the stable order that gives each person a tag colour */
  members: string[]
  /** openMonths — finished months waiting to be closed in the wizard, oldest first */
  asOf: { capitalDate: string | null; closedMonth: string | null; openMonths: string[]; /** The snapshot's day ('YYYY-MM-DD', UTC): the goals plan's today */ today: string }
  /** The base currency's rate (units per 1 USD) on the snapshot's day; null when the base is USD or has no rate */
  rates: { date: string; perUsd: number } | null
  capital: (CapitalSnapshot & { monthDelta: number | null; yoyDelta: number | null }) | null
  /** Previous adjacent capital observation, for record-by-record changes. No inferred causes. */
  previousCapital: CapitalSnapshot | null
  /** The capital at the end of the month 3 and 12 months before `capital.date` and at the first history month; null — that month has no observation. A month back is `previousCapital` */
  capitalBack?: Partial<Record<Exclude<AssetPeriod, 'month'>, CapitalSnapshot | null>>
  history: HistoryPoint[]
  /** Closed observations and canonical closures through the capital endpoint. */
  accountLifecycle: AccountLifecycleEvidence[]
  /** Completeness of each closed month's capital without carrying balances forward. */
  capitalCoverage?: { month: string; assetsKnown: boolean; /** Every bank account (the liquid money) observed and converted */ liquidKnown: boolean; capitalKnown: boolean; missingAccounts: { name: string; member: string; class: AccountClass; currency: string; lastObservedMonth: string }[] }[]
  /** Evidence for question-led analytics, computed before historical amounts are flattened. */
  analysisMonths?: { month: string; capital: boolean; cashflow: boolean }[]
  /** Every closed month's net-worth change by cause, oldest first (src/domain/capitalChange.ts) */
  capitalChange?: (MonthChange | MonthChangeGap)[]
  /** Growth of net worth beyond the family's own savings: monthly Modified Dietz chained and annualised; null — income and expenses are not tracked */
  growthBeyondSavings: GrowthBeyondSavings | null
  cashflow: {
    closedMonth: MonthTotals | null
    rows: CashflowRowBase[]
    avg3m: SavingsSummary
    avg12m: SavingsSummary
    /** Closed month: savings rate, % and emergency fund, months — cash-flow numbers, present without a health report too */
    savingsRatePct: number | null
    emergencyMonths: number | null
  }
  health: HealthReport | null
  /** Spending by category of the closed months and the mandatory-spending average; empty while income and expenses are not tracked */
  spending: { months: CategorisedMonth[]; mandatory: MandatorySpending | null }
  /** Income by category of the closed months; empty while income and expenses are not tracked */
  income: { months: CategorisedMonth[] }
  goals: { items: GoalItem[]; plan: GoalsPlan; fire: FireSummary | null }
  parameters: Record<string, number>
  /** The inflation real growth is measured against, in its own currency; null — the rate or its currency is not set */
  inflation: Inflation | null
  /** The family's "Track income and expenses" parameter, echoed: the pages say tracking is off instead of showing empty flows */
  trackFlows: boolean
  warnings: Warning[]
}
