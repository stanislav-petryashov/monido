// Reads tables into domain rows. The loaders of balances, flows and closed months serve both the snapshot and the wizard.
import type { Database } from './db'
import type { LoanEarlyPayment, LoanRow } from '../domain/loans'
import type { AccountClosure, ClosedMonth } from '../domain/monthClose'
import type { AssetInput, CashflowInput, CategoryFlow, CategoryKind, CategorySpendingInput, FinanceRows, FlowLineInput, LoanPaymentInput, SpendingCategory } from '../domain/types'

export const str = (v: unknown) => String(v ?? '')
const num = (v: unknown) => Number(v ?? 0)
const day = (v: unknown) => String(v ?? '').slice(0, 10)
const rows = (db: Database, sql: string) => db.prepare(sql).all().then(r => r.results)
/** The snapshot does not need the row address. */
export function withoutRowid<T extends { rowid: number }>(stored: T): Omit<T, 'rowid'> {
  const row: Partial<T> = { ...stored }
  delete row.rowid
  return row as Omit<T, 'rowid'>
}

/** Balances with rowid: the wizard replaces and deletes rows by it. */
export async function loadAssets(db: Database): Promise<(AssetInput & { rowid: number })[]> {
  return (await rows(db, 'SELECT *, rowid FROM assets')).map(r => ({
    rowid: num(r.rowid), date: day(r.date), class: str(r.class), name: str(r.name), value: num(r.value),
    currency: str(r.currency), member: r.member == null ? null : str(r.member),
  }))
}

export async function loadCashflow(db: Database): Promise<(CashflowInput & { rowid: number })[]> {
  return (await rows(db, 'SELECT *, rowid FROM monthly_cashflow')).map(r => ({
    rowid: num(r.rowid), date: day(r.date), bank: str(r.bank), member: str(r.member), active_income: num(r.active_income),
    passive_income: num(r.passive_income), expense: num(r.expense), currency: str(r.currency),
  }))
}

/** Loan payments with rowid: the wizard replaces and deletes rows by it. */
export async function loadLoanPayments(db: Database): Promise<(LoanPaymentInput & { rowid: number })[]> {
  return (await rows(db, 'SELECT *, rowid FROM loan_payments')).map(r => ({
    rowid: num(r.rowid), date: day(r.date), loan_name: str(r.loan_name), amount: num(r.amount), currency: str(r.currency),
  }))
}

/** A spending_categories row as the domain sees it. */
export const categoryRow = (r: Record<string, unknown>): SpendingCategory => ({
  id: num(r.id), name: str(r.name), kind: str(r.kind) as CategoryKind, flow: (str(r.flow) || 'expense') as CategoryFlow, oneOff: num(r.one_off) === 1,
})

/** closed_by of the months a history import closed: removed together, never reopened one by one */
export const IMPORT_CLOSER = 'import'

/** Closed months; closed_by = migration is history entered before the wizard, import a history import (neither is reopened). */
export async function loadClosedMonths(db: Database): Promise<ClosedMonth[]> {
  return (await rows(db, 'SELECT month, closed_by FROM closed_months'))
    // shortcut: closed_by holds the closer's name, so a user named exactly "import" would read as an import; a source column if that happens
    .map(r => ({ month: str(r.month), source: r.closed_by === 'migration' ? 'migration' as const : r.closed_by === IMPORT_CLOSER ? 'import' as const : 'wizard' as const }))
}

/** Accounts the wizard closed, each with the last month it is required in. */
export async function loadClosures(db: Database): Promise<AccountClosure[]> {
  return (await rows(db, 'SELECT name, member, closed_month FROM account_closures'))
    .map(r => ({ name: str(r.name), member: str(r.member), closedMonth: str(r.closed_month) }))
}

/** A numeric column as stored: SQLite may hold it as a number or as text; computeSchedule coerces both. */
const amount = (v: unknown): number | string => (typeof v === 'number' || typeof v === 'string' ? v : num(v))

const loanRow = (r: Record<string, unknown>): LoanRow => ({
  rowid: num(r.rowid), name: str(r.name), principal: amount(r.principal), rate: amount(r.rate), term_months: amount(r.term_months),
  monthly_payment: amount(r.monthly_payment), issue_date: str(r.issue_date), payment_day: r.payment_day == null ? null : amount(r.payment_day),
  currency: str(r.currency), member: str(r.member), type: str(r.type), status: str(r.status), closed_date: r.closed_date == null ? null : str(r.closed_date),
  secured_by: r.secured_by == null ? null : str(r.secured_by),
})

const earlyPaymentRow = (r: Record<string, unknown>): LoanEarlyPayment => ({
  rowid: num(r.rowid), id: num(r.id), loan_name: str(r.loan_name), payment_date: str(r.payment_date), amount: amount(r.amount),
  strategy: str(r.strategy), new_payment: r.new_payment == null ? null : amount(r.new_payment),
  principal_credit: r.principal_credit == null ? null : amount(r.principal_credit), notes: r.notes == null ? null : str(r.notes),
})

/** The loans, as the schedule needs them. */
export async function loadLoans(db: Database): Promise<LoanRow[]> {
  return (await rows(db, 'SELECT *, rowid FROM loans')).map(loanRow)
}

/** The early payments of all loans, as the schedule needs them. */
export async function loadEarlyPayments(db: Database): Promise<LoanEarlyPayment[]> {
  return (await rows(db, 'SELECT *, rowid FROM loan_early_payments')).map(earlyPaymentRow)
}

/** The family parameter "Track income and expenses" (`app_settings.track_flows`): on unless it holds '0'. */
export async function readTrackFlows(db: Database): Promise<boolean> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'track_flows'").first<{ value: string }>()
  return row?.value !== '0'
}

/** Every table the snapshot needs, normalized to domain input rows. */
export async function loadAll(db: Database): Promise<FinanceRows> {
  const [assets, cashflow, loanPayments, categories, categorySpending, flowLines, manual, realEstate, loans, earlyPayments, goals, parameters, closedMonths, closures, trackFlows, currencies, members] = await Promise.all([
    loadAssets(db),
    loadCashflow(db),
    loadLoanPayments(db),
    rows(db, 'SELECT id, name, kind, flow, one_off FROM spending_categories ORDER BY id'),
    rows(db, 'SELECT date, category_id, source, amount, currency FROM category_spending'),
    rows(db, 'SELECT date, bank, member, category_id, amount FROM flow_lines'),
    rows(db, 'SELECT amount, currency, updated_at FROM manual_mandatory_spending WHERE id = 1'),
    rows(db, 'SELECT * FROM real_estate'),
    loadLoans(db),
    loadEarlyPayments(db),
    rows(db, 'SELECT * FROM goals'),
    rows(db, 'SELECT key, value FROM parameters'),
    loadClosedMonths(db),
    loadClosures(db),
    readTrackFlows(db),
    rows(db, 'SELECT * FROM currencies ORDER BY code'),
    rows(db, 'SELECT name FROM members ORDER BY rowid'),
  ])
  // one currency carries the inflation flag; if several do, the first code
  const inflationCode = currencies.find(r => num(r.inflation) === 1)?.code
  return {
    assets: assets.map(withoutRowid),
    cashflow: cashflow.map(withoutRowid),
    loanPayments: loanPayments.map(withoutRowid),
    spendingCategories: categories.map(categoryRow),
    categorySpending: categorySpending.map((r): CategorySpendingInput => ({
      date: day(r.date), category_id: num(r.category_id), source: str(r.source), amount: num(r.amount), currency: str(r.currency),
    })),
    flowLines: flowLines.map((r): FlowLineInput => ({
      date: day(r.date), bank: str(r.bank), member: str(r.member), category_id: num(r.category_id), amount: num(r.amount),
    })),
    manualMandatory: manual[0] ? { amount: num(manual[0].amount), currency: str(manual[0].currency), updated_at: str(manual[0].updated_at) } : null,
    realEstate: realEstate.map(r => ({
      name: str(r.name), purchase_date: day(r.purchase_date), purchase_price: num(r.purchase_price),
      purchase_currency: str(r.purchase_currency), valuation_year: num(r.valuation_year),
      value: num(r.value), currency: str(r.currency), member: r.member == null ? null : str(r.member),
    })),
    loans,
    earlyPayments,
    goals: goals.map(r => ({
      id: str(r.id), name: str(r.name), target: num(r.target), current: num(r.current),
      target_date: day(r.target_date), emoji: r.emoji == null ? null : str(r.emoji), currency: str(r.currency) || 'USD',
    })),
    parameters: Object.fromEntries(parameters.map(r => [str(r.key), num(r.value)])),
    closedMonths,
    closures,
    trackFlows,
    currencies: currencies.map(r => str(r.code)),
    members: members.map(r => str(r.name)),
    inflationCurrency: inflationCode === undefined ? null : str(inflationCode),
  }
}
