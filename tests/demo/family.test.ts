import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFamily, DEMO_FAMILIES, demoFamilyLanguage, familyCurrency, type DemoFamily, type DemoFamilyKey } from '../../src/demo/family'
import { EUR_PER_USD_BY_MONTH } from '../../src/demo/eurRates'
import { RUB_PER_USD_BY_MONTH } from '../../src/demo/rubRates'
import type { DemoStrings } from '../../src/demo/strings'
import en from '../../src/demo/en-US.json'
import ru from '../../src/demo/ru-RU.json'
import { monthEnd } from '../../src/domain/dates'
import { buildSnapshot } from '../../src/domain/snapshot'
import { loadAll } from '../../src/server/data'
import { writeFamily } from '../../src/server/demo/writeFamily'
import { openDatabase, type SqliteDatabase } from '../../src/server/db'
import { initializeSchema } from '../../src/server/schema'
import { getSnapshot } from '../../src/server/snapshot'
import { SCHEMA_FILE } from '../helpers/db'

const TODAY = '2026-10-21'

/** The table each DemoFamily field is written to. */
const TABLES: Record<keyof DemoFamily, string> = {
  members: 'members', users: 'users', currencies: 'currencies', assets: 'assets', cashflow: 'monthly_cashflow',
  loans: 'loans', loanEarlyPayments: 'loan_early_payments', realEstate: 'real_estate', goals: 'goals',
  parameters: 'parameters', closedMonths: 'closed_months', fxRates: 'fx_rates',
  loanPayments: 'loan_payments', spendingCategories: 'spending_categories', categorySpending: 'category_spending',
  flowLines: 'flow_lines',
}

/** The demo snapshot is expected to carry no warning at all. */
const INTENDED_WARNINGS: string[] = []

const dirs: string[] = []
const dbs: SqliteDatabase[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A migrated database file, as the server leaves it on first start. */
function migratedFile(): { file: string; db: SqliteDatabase } {
  const dir = mkdtempSync(join(tmpdir(), 'demo-family-'))
  dirs.push(dir)
  const file = join(dir, 'finance.sqlite')
  const db = openDatabase(file)
  dbs.push(db)
  initializeSchema(db, SCHEMA_FILE)
  return { file, db }
}

describe('buildFamily(en-US) numbers', () => {
  const family = buildFamily({ today: TODAY })
  const mortgage = family.loans.find(l => l.type === 'mortgage')!

  it('currencies are USD and EUR, USD carries inflation', () => {
    expect([...family.currencies].sort((a, b) => a.code.localeCompare(b.code))).toEqual([{ code: 'EUR', inflation: 0 }, { code: 'USD', inflation: 1 }])
    expect(family.parameters.find(p => p.key === 'inflation_rate')?.value).toBe(3)
    expect(new Set([...family.assets, ...family.cashflow].map(r => r.currency))).toEqual(new Set(['EUR', 'USD']))
  })

  it('two members, a house and an apartment', () => {
    expect(family.members).toHaveLength(2)
    expect(family.members.map(m => m.name)).toEqual([...DEMO_FAMILIES['en-US'].members])
    const properties = [...new Map(family.realEstate.map(r => [r.name, r])).values()]
    expect(properties).toHaveLength(2)
    const house = properties.find(r => r.currency === 'USD')!
    const apartment = properties.find(r => r.currency === 'EUR')!
    expect(house.purchase_price).toBeGreaterThan(500000)
    expect(house.purchase_price).toBeLessThan(540000)
    const apartmentNow = family.realEstate.filter(r => r.name === apartment.name).sort((a, b) => b.valuation_year - a.valuation_year)[0]
    expect(apartmentNow.value).toBeGreaterThan(280000)
    expect(apartmentNow.value).toBeLessThan(320000)
    expect(DEMO_FAMILIES['en-US'].members).toContain(apartment.member)
  })

  it('loans: a 30-year mortgage at 6.5% and a car loan at 7%', () => {
    expect(family.loans).toHaveLength(2)
    expect(mortgage.term_months).toBe(360)
    expect(mortgage.rate).toBe(6.5)
    const car = family.loans.find(l => l.type === 'consumer')!
    expect(car.rate).toBe(7)
    expect(car.principal).toBeGreaterThan(22000)
    expect(car.principal).toBeLessThan(28000)
    expect(family.loans.every(l => l.status === 'active')).toBe(true)
  })

  it('earns about $150k a year in two dollar salaries', () => {
    const lastYear = family.cashflow.filter(c => c.date >= '2025-09-01' && c.date <= '2026-08-31')
    const salaries = lastYear.filter(c => c.active_income > 0)
    expect(salaries.every(c => c.currency === 'USD')).toBe(true)
    expect(new Set(salaries.map(c => c.member)).size).toBe(2)
    const total = salaries.reduce((s, c) => s + c.active_income, 0)
    expect(total).toBeGreaterThan(140000)
    expect(total).toBeLessThan(165000)
  })

  it('rent arrives in euros', () => {
    const rent = family.cashflow.filter(c => c.currency === 'EUR' && c.passive_income > 0)
    expect(rent).toHaveLength(36)
    expect(rent.every(c => c.passive_income >= 1000 && c.passive_income <= 1200)).toBe(true)
  })

  it('net worth ≈ $750k, with every rate in the family', async () => {
    const { db } = migratedFile()
    writeFamily(db.sqlite, family)
    const rows = await loadAll(db)
    const byDate = new Map<string, Record<string, number>>()
    for (const r of family.fxRates) byDate.set(r.date, { ...byDate.get(r.date), [r.currency]: r.per_usd })
    const now = new Date(`${TODAY}T12:00:00Z`)
    const snapshot = buildSnapshot({ rows, rateAt: date => byDate.get(date) ?? {}, baseCurrency: 'USD', familyCurrency: 'USD', today: now })
    expect(snapshot.capital?.date).toBe('2026-08-31')
    expect(snapshot.capital!.netWorth).toBeGreaterThan(675000)
    expect(snapshot.capital!.netWorth).toBeLessThan(825000)
    expect(snapshot.warnings.map(w => w.code).filter(c => c.startsWith('fx_'))).toEqual([])
  })

  it('growth beyond savings is known for the demo and in a plausible band', async () => {
    const { db } = migratedFile()
    writeFamily(db.sqlite, family)
    const rows = await loadAll(db)
    const byDate = new Map<string, Record<string, number>>()
    for (const r of family.fxRates) byDate.set(r.date, { ...byDate.get(r.date), [r.currency]: r.per_usd })
    const snapshot = buildSnapshot({ rows, rateAt: date => byDate.get(date) ?? {}, baseCurrency: 'USD', familyCurrency: 'USD', today: new Date(`${TODAY}T12:00:00Z`) })
    const g = snapshot.growthBeyondSavings!
    // the demo has balances and flows for every closed month: nothing is left out
    expect(g.monthsSkipped).toEqual([])
    expect(g.months.length).toBe(g.monthsConsidered)
    expect(g.months.length).toBeGreaterThanOrEqual(30)
    expect(g.annualRate).not.toBeNull()
    expect(g.annualRate!).toBeGreaterThan(-0.5)
    expect(g.annualRate!).toBeLessThan(1)
  })

  // the rate dates, tomorrow included, and EUR as the only rated currency: "has a rate for every date…" below
  it('every EUR rate is a plausible one (0.7–1.1 per USD)', () => {
    expect(family.fxRates.every(r => r.per_usd > 0.7 && r.per_usd < 1.1)).toBe(true)
  })

  it('takes the real monthly EUR rate, and wobbles past the table', () => {
    const rate = (f: DemoFamily, date: string) => f.fxRates.find(r => r.date === date)!.per_usd
    expect(rate(family, '2024-06-30')).toBe(EUR_PER_USD_BY_MONTH['2024-06'])
    const later = buildFamily({ today: '2031-03-02' })
    const last = Object.keys(EUR_PER_USD_BY_MONTH).sort().at(-1)!
    const values = later.fxRates.filter(r => r.date > `${last}-31`).map(r => r.per_usd / EUR_PER_USD_BY_MONTH[last])
    expect(values.length).toBeGreaterThan(0)
    expect(values.every(v => v >= 0.99 && v <= 1.01)).toBe(true)
    expect(new Set(values).size).toBeGreaterThan(1)
  })

  it("the checking account's expenses no longer include the mortgage and car payments; loan_payments carry them per month", () => {
    const car = family.loans.find(l => l.type === 'consumer')!
    for (const { month } of family.closedMonths) {
      const rows = family.loanPayments.filter(p => p.date === `${month}-01`)
      const mortgagePayment = rows.find(p => p.loan_name === mortgage.name)
      expect(mortgagePayment?.amount, month).toBeGreaterThan(2000)
      expect(mortgagePayment?.currency).toBe('USD')
      expect(rows.every(p => p.loan_name === mortgage.name || p.loan_name === car.name)).toBe(true)
      const checking = family.cashflow.find(c => c.date === `${month}-01` && c.bank === 'Harborline Checking')!
      // a living cost of about $3.7k; with the $2.6k payment inside it would be over $6k
      expect(checking.expense, month).toBeLessThan(5000)
    }
    expect(family.loanPayments.some(p => p.loan_name === car.name)).toBe(true)
    expect(new Set(family.loanPayments.map(p => p.date)).size).toBe(36)
  })

  it("the demo's mandatory average and coverage are computed (snapshot spending.mandatory is not null)", async () => {
    const { db } = migratedFile()
    writeFamily(db.sqlite, family)
    const snapshot = await getSnapshot(db, { now: new Date(`${TODAY}T12:00:00Z`), fetchImpl: (() => { throw new Error('no rate request expected') }) as unknown as typeof fetch })
    expect(snapshot.spending.mandatory).toMatchObject({ source: 'categories', months: 3 })
    expect(snapshot.spending.mandatory!.perMonthBase).toBeGreaterThan(3000)
    expect(snapshot.spending.mandatory!.perMonthBase).toBeLessThan(6500)
    // the reserved category keeps its id: the loan debits of the statements point to it
    const reserved = db.sqlite.prepare("SELECT id FROM spending_categories WHERE kind = 'loan_payment'").get() as { id: number }
    expect(family.categorySpending.some(s => s.category_id === reserved.id)).toBe(true)
  })

  // A deliberate lock, not a duplicate of the range checks above: the README screenshot and the social preview
  // (`npm run screenshots`) show exactly this family. A generator change that moves these numbers changes those
  // images: update the literals on purpose and regenerate the screenshots with them.
  it('the English family is the one the snapshots were taken with (row counts and a few literals)', () => {
    const f = buildFamily({ today: TODAY })
    expect({ assets: f.assets.length, cashflow: f.cashflow.length, fx: f.fxRates.length, spending: f.categorySpending.length, lines: f.flowLines.length })
      .toEqual({ assets: 216, cashflow: 216, fx: 76, spending: 12, lines: 119 })
    expect(f.assets.find(a => a.name === 'Harborline Checking' && a.date === '2023-09-30')?.value).toBe(9480)
    expect(f.loanEarlyPayments[0]).toMatchObject({ amount: 5000, new_payment: 2597.36, principal_credit: 4991.35 })
  })
})

/** Each family's names by role and the one currency its rate table holds (beside USD). */
const STRINGS: Record<DemoFamilyKey, DemoStrings> = { 'en-US': en, 'ru-RU': ru }
const RATED: Record<DemoFamilyKey, string> = { 'en-US': 'EUR', 'ru-RU': 'RUB' }
const noFetch = (() => { throw new Error('no rate request expected') }) as unknown as typeof fetch

describe.each(['en-US', 'ru-RU'] as const)('flow lines of the %s family', key => {
  const family = buildFamily({ today: TODAY, family: key })
  const byId = new Map(family.spendingCategories.map(c => [c.id, c]))
  const rowOf = (l: { date: string; bank: string; member: string }) => family.cashflow.find(c => c.date === l.date && c.bank === l.bank && c.member === l.member)!
  const column = { active: 'active_income', passive: 'passive_income', expense: 'expense' } as const

  it('every line points to an account row and a category, and the lines of a flow never exceed its total', () => {
    const sums = new Map<string, number>()
    for (const l of family.flowLines) {
      expect(rowOf(l), `${l.date} ${l.bank}`).toBeDefined()
      const flow = byId.get(l.category_id)!.flow
      const k = `${l.date}|${l.bank}|${l.member}|${flow}`
      sums.set(k, (sums.get(k) ?? 0) + l.amount)
    }
    for (const [k, sum] of sums) {
      const [date, bank, member, flow] = k.split('|')
      const row = rowOf({ date, bank, member })
      expect(sum, k).toBeLessThanOrEqual(row[column[flow as keyof typeof column]] + 0.005)
    }
  })

  it('income is broken down for the last twelve months, with a one-off month and a month with a remainder', () => {
    const income = family.flowLines.filter(l => byId.get(l.category_id)!.flow !== 'expense')
    expect([...new Set(income.map(l => l.date.slice(0, 7)))].sort()).toEqual(family.closedMonths.map(m => m.month).slice(-12))
    expect(income.some(l => byId.get(l.category_id)!.one_off === 1)).toBe(true)
    const salaryId = family.spendingCategories.find(c => c.flow === 'active' && c.one_off === 0)!.id
    const short = family.flowLines.filter(l => l.category_id === salaryId).filter(l => l.amount < rowOf(l).active_income && !family.flowLines.some(o => o !== l && o.date === l.date && o.bank === l.bank && o.category_id !== salaryId && byId.get(o.category_id)!.one_off === 1))
    expect(short).toHaveLength(1)
  })

  it('the snapshot shows the income breakdown and the account expense lines without a warning', async () => {
    const { db } = migratedFile()
    writeFamily(db.sqlite, family)
    const snapshot = await getSnapshot(db, { now: new Date(`${TODAY}T12:00:00Z`), fetchImpl: noFetch, currency: familyCurrency(family) })
    expect(snapshot.warnings).toEqual([])
    const months = snapshot.income.months
    expect(months).toHaveLength(12)
    expect(months.some(m => m.oneOffBase! > 0)).toBe(true)
    expect(months.at(-1)!.unallocatedBase).toBeGreaterThan(0)
    expect(months.slice(0, -1).every(m => m.unallocatedBase === 0 || m.unallocatedBase === null)).toBe(true)
    expect(snapshot.spending.months).toHaveLength(6)
  })
})

describe.each(['en-US', 'ru-RU'] as const)('buildFamily(%s) shape', key => {
  const family = buildFamily({ today: TODAY, family: key })
  const members = DEMO_FAMILIES[key].members
  const strings = STRINGS[key]
  const rated = RATED[key]

  it('two members and two properties', () => {
    expect(family.members.map(m => m.name)).toEqual([...members])
    expect(new Set(family.realEstate.map(r => r.name))).toEqual(new Set([strings.properties.home, strings.properties.rental]))
  })

  it('the demo has a manager and an editor', () => {
    const rights = (member: string) => family.users.find(u => u.member === member)
    expect(rights(members[0])).toMatchObject({ can_edit: 1, can_vote: 1, can_manage: 1 })
    expect(rights(members[1])).toMatchObject({ can_edit: 1, can_vote: 1, can_manage: 0 })
    for (const user of family.users) expect(user).not.toHaveProperty('telegram_id')
  })

  it('two active loans: a mortgage and a consumer one', () => {
    expect(family.loans.map(l => l.type).sort()).toEqual(['consumer', 'mortgage'])
    expect(family.loans.every(l => l.status === 'active')).toBe(true)
  })

  it('last month is open and empty', () => {
    const months = family.closedMonths.map(m => m.month)
    expect(months).toHaveLength(36)
    expect(months.at(0)).toBe('2023-09')
    expect(months.reduce((a, b) => (a > b ? a : b))).toBe('2026-08')
    expect([...family.assets, ...family.cashflow].filter(r => r.date > '2026-08-31')).toEqual([])
  })

  it('has balances and flows of every account in every closed month', () => {
    const accounts = new Set(family.assets.map(a => `${a.name}|${a.member}`))
    expect(accounts.size).toBe(6)
    for (const { month } of family.closedMonths) {
      expect(family.assets.filter(a => a.date.startsWith(month)).map(a => `${a.name}|${a.member}`).sort(), month).toEqual([...accounts].sort())
      expect(family.cashflow.filter(c => c.date.startsWith(month)).map(c => `${c.bank}|${c.member}`).sort(), month).toEqual([...accounts].sort())
    }
  })

  it('books every balance, flow, loan and property to a member of the family', () => {
    const names = new Set(members)
    const owners = [...family.assets, ...family.cashflow, ...family.loans, ...family.realEstate].map(r => r.member)
    expect(owners.filter(m => !names.has(m))).toEqual([])
  })

  it('pays the mortgage early at least four times with both strategies, one with exact bank values', () => {
    const mortgage = family.loans.find(l => l.type === 'mortgage')!
    const early = family.loanEarlyPayments.filter(p => p.loan_name === mortgage.name)
    expect(early.length).toBeGreaterThanOrEqual(4)
    expect(new Set(early.map(p => p.strategy))).toEqual(new Set(['reduce_term', 'reduce_payment']))
    expect(early.some(p => p.new_payment !== null && p.principal_credit !== null)).toBe(true)
  })

  it('has an emergency fund, a vacation and a FIRE goal', () => {
    expect(family.goals.map(g => g.id).sort()).toEqual(['emergency', 'fire', 'vacation'])
    expect(family.goals.every(g => g.emoji === null)).toBe(true)
  })

  it('pays the loans as loan_payments rows in every closed month', () => {
    const names = new Set(family.loans.map(l => l.name))
    const mortgage = family.loans.find(l => l.type === 'mortgage')!
    for (const { month } of family.closedMonths) {
      expect(family.loanPayments.some(p => p.date === `${month}-01` && p.loan_name === mortgage.name), month).toBe(true)
    }
    expect(family.loanPayments.every(p => names.has(p.loan_name))).toBe(true)
    expect(new Set(family.loanPayments.map(p => p.date)).size).toBe(36)
  })

  it('breaks the last six closed months of expenses down as the accounts’ flow_lines, covering 80–95%; the two cards keep only the loan debits', async () => {
    const { db } = migratedFile()
    writeFamily(db.sqlite, family)
    const snapshot = await getSnapshot(db, { now: new Date(`${TODAY}T12:00:00Z`), fetchImpl: noFetch })
    const lastSix = family.closedMonths.map(m => m.month).slice(-6)
    expect([...new Set(family.categorySpending.map(s => s.date.slice(0, 7)))].sort()).toEqual(lastSix)
    expect(new Set(family.categorySpending.map(s => s.source))).toEqual(new Set([strings.cards.a, strings.cards.b]))
    // the cards hold only the loan debits (the reserved category); every other category amount is an account's line
    // (id 1 is the reserved loan_payments row migration 0018 seeds; the demo's own categories start after it)
    expect(family.categorySpending.every(s => s.category_id === 1)).toBe(true)
    const expenseIds = new Set(family.spendingCategories.filter(x => x.flow === 'expense').map(x => x.id))
    const expenseLines = family.flowLines.filter(l => expenseIds.has(l.category_id))
    expect([...new Set(expenseLines.map(l => l.date.slice(0, 7)))].sort()).toEqual(lastSix)
    const c = strings.categories
    expect(family.spendingCategories.map(x => `${x.kind}:${x.name}`))
      .toEqual(expect.arrayContaining([`mandatory:${c.housing}`, `mandatory:${c.groceries}`, `optional:${c.cafes}`, `optional:${c.travel}`]))
    const months = snapshot.spending.months
    expect(months.map(m => m.month)).toEqual(lastSix)
    for (const m of months) {
      expect(m.coveragePct, m.month).toBeGreaterThanOrEqual(80)
      expect(m.coveragePct, m.month).toBeLessThanOrEqual(95)
    }
    expect(snapshot.spending.mandatory).toMatchObject({ source: 'categories', months: 3 })
  })

  it('has a rate for every date the snapshot and the wizard need, tomorrow included', () => {
    const dates = new Set(family.fxRates.filter(r => r.currency === rated).map(r => r.date))
    expect(family.fxRates.every(r => r.currency === rated)).toBe(true)
    for (const { month } of family.closedMonths) {
      expect(dates.has(`${month}-01`), month).toBe(true)
      expect(dates.has(monthEnd(month)), month).toBe(true)
    }
    for (const date of ['2026-09-01', '2026-09-30', '2026-10-21', '2026-10-22']) expect(dates.has(date), date).toBe(true)
  })

  it('a day on the 1st of January still gives 36 closed months and every rate date', () => {
    const f = buildFamily({ today: '2027-01-01', family: key })
    const months = f.closedMonths.map(m => m.month)
    expect(months).toHaveLength(36)
    expect(months.at(-1)).toBe('2026-11')
    const dates = new Set(f.fxRates.filter(r => r.currency === rated).map(r => r.date))
    for (const { month } of f.closedMonths) expect(dates.has(monthEnd(month)), month).toBe(true)
    for (const date of ['2026-12-01', '2026-12-31', '2027-01-01', '2027-01-02']) expect(dates.has(date), date).toBe(true)
  })

  it('is deterministic for a given day', () => {
    expect(buildFamily({ today: TODAY, family: key })).toEqual(family)
  })

  it('gives a full snapshot with no unintended warning', async () => {
    const { db } = migratedFile()
    writeFamily(db.sqlite, family)
    // Every rate the snapshot needs is in the family, so no rate request goes out.
    const snapshot = await getSnapshot(db, { now: new Date(`${TODAY}T12:00:00Z`), fetchImpl: noFetch })
    expect(snapshot.capital?.netWorth).toBeGreaterThan(0)
    expect(snapshot.cashflow.closedMonth?.month).toBe('2026-08')
    expect(snapshot.asOf.openMonths).toEqual(['2026-09'])
    expect(snapshot.goals.fire).not.toBeNull()
    expect(snapshot.health).not.toBeNull()
    expect(snapshot.history).toHaveLength(36)
    expect(snapshot.capital?.realEstate).toHaveLength(2)
    expect(snapshot.capital?.loans.map(l => l.type).sort()).toEqual(['consumer', 'mortgage'])
    expect(snapshot.warnings.map(w => w.code)).toEqual(INTENDED_WARNINGS)
  })
})

describe('buildFamily(ru-RU) numbers', () => {
  const family = buildFamily({ today: TODAY, family: 'ru-RU' })
  const strings: DemoStrings = ru

  it('currencies are RUB (inflation) and USD, inflation 8%', () => {
    expect([...family.currencies].sort((a, b) => a.code.localeCompare(b.code))).toEqual([{ code: 'RUB', inflation: 1 }, { code: 'USD', inflation: 0 }])
    expect(family.parameters.find(p => p.key === 'inflation_rate')?.value).toBe(8)
  })

  it('earns 4.6–5.8 M RUB a year in two ruble salaries', () => {
    const lastYear = family.cashflow.filter(c => c.date >= '2025-09-01' && c.date <= '2026-08-31')
    const salaries = lastYear.filter(c => c.active_income > 0)
    expect(salaries.every(c => c.currency === 'RUB')).toBe(true)
    expect(new Set(salaries.map(c => c.member)).size).toBe(2)
    const total = salaries.reduce((s, c) => s + c.active_income, 0)
    expect(total).toBeGreaterThan(4_600_000)
    expect(total).toBeLessThan(5_800_000)
  })

  it('rent arrives on the savings account every month, passive income 35 000–60 000', () => {
    const savings = family.cashflow.filter(c => c.bank === strings.accounts.savings)
    expect(savings).toHaveLength(36)
    expect(savings.every(c => c.passive_income >= 35000 && c.passive_income <= 60000)).toBe(true)
    expect(family.cashflow.filter(c => c.currency === 'USD').every(c => c.active_income === 0 && c.passive_income === 0 && c.expense === 0)).toBe(true)
  })

  it('the home cost 13–14 M, the Kazan apartment is worth 8.5–10 M', () => {
    const home = family.realEstate.find(r => r.name === strings.properties.home)!
    expect(home.purchase_price).toBeGreaterThan(13e6)
    expect(home.purchase_price).toBeLessThan(14e6)
    const rentalNow = family.realEstate.filter(r => r.name === strings.properties.rental).sort((a, b) => b.valuation_year - a.valuation_year)[0]
    expect(rentalNow.currency).toBe('RUB')
    expect(rentalNow.value).toBeGreaterThan(8.5e6)
    expect(rentalNow.value).toBeLessThan(10e6)
  })

  it('loans: a 240-month mortgage at 10.4%, a car loan of 1.3–1.7 M at 16.9%', () => {
    const mortgage = family.loans.find(l => l.type === 'mortgage')!
    expect(mortgage.term_months).toBe(240)
    expect(mortgage.rate).toBe(10.4)
    expect(mortgage.currency).toBe('RUB')
    const car = family.loans.find(l => l.type === 'consumer')!
    expect(car.rate).toBe(16.9)
    expect(car.principal).toBeGreaterThan(1_300_000)
    expect(car.principal).toBeLessThan(1_700_000)
  })

  it('net worth 20–32 M RUB with every rate in the family', async () => {
    const { db } = migratedFile()
    writeFamily(db.sqlite, family)
    const rows = await loadAll(db)
    const byDate = new Map<string, Record<string, number>>()
    for (const r of family.fxRates) byDate.set(r.date, { ...byDate.get(r.date), [r.currency]: r.per_usd })
    const now = new Date(`${TODAY}T12:00:00Z`)
    const snapshot = buildSnapshot({ rows, rateAt: date => byDate.get(date) ?? {}, baseCurrency: 'RUB', familyCurrency: 'RUB', today: now })
    expect(snapshot.capital?.date).toBe('2026-08-31')
    expect(snapshot.capital!.netWorth).toBeGreaterThan(20e6)
    expect(snapshot.capital!.netWorth).toBeLessThan(32e6)
    expect(snapshot.warnings.map(w => w.code).filter(c => c.startsWith('fx_'))).toEqual([])
  })

  it('takes the real monthly RUB rate and wobbles ±1% past the table', () => {
    const rate = (f: DemoFamily, date: string) => f.fxRates.find(r => r.date === date)!.per_usd
    expect(rate(family, '2024-06-30')).toBe(RUB_PER_USD_BY_MONTH['2024-06'])
    const later = buildFamily({ today: '2031-03-02', family: 'ru-RU' })
    const last = Object.keys(RUB_PER_USD_BY_MONTH).sort().at(-1)!
    const values = later.fxRates.filter(r => r.date > `${last}-31`).map(r => r.per_usd / RUB_PER_USD_BY_MONTH[last])
    expect(values.length).toBeGreaterThan(0)
    expect(values.every(v => v >= 0.99 && v <= 1.01)).toBe(true)
    expect(new Set(values).size).toBeGreaterThan(1)
  })

  it('mandatory average 90 000–160 000 RUB', async () => {
    const { db } = migratedFile()
    writeFamily(db.sqlite, family)
    // writeFamily leaves app_settings alone (the family currency is the load's to set), so the base is asked for
    const snapshot = await getSnapshot(db, { now: new Date(`${TODAY}T12:00:00Z`), fetchImpl: noFetch, currency: 'RUB' })
    expect(snapshot.spending.mandatory).toMatchObject({ source: 'categories', months: 3 })
    expect(snapshot.spending.mandatory!.perMonthBase).toBeGreaterThan(90000)
    expect(snapshot.spending.mandatory!.perMonthBase).toBeLessThan(160000)
  })

  it('demoFamilyLanguage maps ru-RU and defaults everything else to en-US', () => {
    expect(demoFamilyLanguage('ru-RU')).toBe('ru-RU')
    for (const l of ['en-US', 'de-DE', '', 'ru']) expect(demoFamilyLanguage(l)).toBe('en-US')
  })
})

describe('writeFamily', () => {
  it('writes every field to the column names of its table and replaces what was there', async () => {
    const { db } = migratedFile()
    db.sqlite.exec(`INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2021-03-31', 'bank', 'Stale', 4, 'USD', 'Stale')`)
    db.sqlite.exec(`UPDATE reminder_settings SET chat_id = '73', chat_title = 'Stale chat', pairing_hash = 'stale', pairing_expires_at = '2026-10-21T00:00:00Z'`)
    const family = buildFamily({ today: TODAY })
    writeFamily(db.sqlite, family)
    for (const [field, table] of Object.entries(TABLES) as [keyof DemoFamily, string][]) {
      const columns = new Set(db.sqlite.prepare(`PRAGMA table_info(${table})`).all().map(c => String(c.name)))
      const keys = new Set(family[field].flatMap(row => Object.keys(row)))
      expect([...keys].filter(k => !columns.has(k)), table).toEqual([])
      const { n } = db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      // the reserved loan_payments category stays beside the family's own
      expect(n, table).toBe(family[field].length + (table === 'spending_categories' ? 1 : 0))
    }
    // the settings tables are the template's to reset, not the writer's
    expect(db.sqlite.prepare('SELECT chat_id FROM reminder_settings').get()).toEqual({ chat_id: '73' })
  })

  it('marks the setup done', () => {
    const { db } = migratedFile()
    writeFamily(db.sqlite, buildFamily({ today: TODAY }))
    expect(db.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'setup_state'").get()).toEqual({ value: 'done' })
  })

  it('clears the advisor council and keeps its settings', () => {
    const { db } = migratedFile()
    db.sqlite.exec(`UPDATE advisor_settings SET decide_days = 7, remind_days = NULL;
      INSERT INTO proposals (type, author_id, status, created_at, deadline_at) VALUES ('credit', 1, 'open', 't', 't');
      INSERT INTO proposal_versions (proposal_id, number, title, question, scenario_json, evaluation_json, base_currency, verdict_json, voters_json, created_at)
        VALUES (1, 1, 'Car', 'Buy it?', '{}', '{}', 'USD', '{}', '[1]', 't');
      INSERT INTO proposal_votes (version_id, user_id, vote, voted_at) VALUES (1, 1, 'agree', 't');
      INSERT INTO proposal_messages (version_id, user_id, chat_id, kind, updated_at) VALUES (1, 1, '42', 'card', 't')`)
    writeFamily(db.sqlite, buildFamily({ today: TODAY }))
    for (const table of ['proposals', 'proposal_versions', 'proposal_votes', 'proposal_messages']) {
      expect(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 })
    }
    expect(db.sqlite.prepare('SELECT id, decide_days, remind_days FROM advisor_settings').all()).toEqual([{ id: 1, decide_days: 7, remind_days: null }])
  })

  it('refuses a database that is not initialized', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-family-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'finance.sqlite'))
    dbs.push(db)
    expect(() => writeFamily(db.sqlite, buildFamily({ today: TODAY }))).toThrow(/not initialized/)
  })
})

it('familyCurrency is the inflation currency of each family', () => {
  expect(familyCurrency(buildFamily({ family: 'en-US' }))).toBe('USD')
  expect(familyCurrency(buildFamily({ family: 'ru-RU' }))).toBe('RUB')
})
