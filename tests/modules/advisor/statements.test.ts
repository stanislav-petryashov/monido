import { expect, it, describe } from 'vitest'
import { accountKey } from '../../../src/domain/accounts'
import { monthEnd } from '../../../src/domain/dates'
import { round2 } from '../../../src/domain/fx'
import { balanceFromSchedule, balanceTolerance, computeSchedule } from '../../../src/domain/loans'
import { loadEarlyPayments, loadLoans } from '../../../src/server/data'
import { type DraftRow } from '../../../src/domain/monthClose'
import { commitStatement } from '../../../src/modules/advisor/tools/statements'
import { stage } from '../../../src/modules/advisor/tools/staged'
import { ADVISOR_TOOLS, type ToolContext } from '../../../src/modules/advisor/tools/registry'
import { getMonthCloseState, saveDraft } from '../../../src/server/monthClose'
import { advisorHarness } from './harness'

type Harness = ReturnType<typeof advisorHarness>
type Warning = { code: string; params?: Record<string, unknown> }
type Line = { categoryId: number; name: string; flow: string; oneOff: boolean; amount: number; currency: string }
type Allocation = Record<'active' | 'passive' | 'expense', { total: number; allocated: number; unallocated: number }>
interface Preview {
  draftId: string
  expiresAt: string
  table: { row: DraftRow; loanLines: { name: string; amount: number; scheduled: number; balance: number | null; scheduledBalance: number | null }[]; categories: { income: Line[]; expense: Line[] } | null; allocation: Allocation | null }
  derived: string[]
  hint: string | null
  was: { row: DraftRow | null; loanLines: { name: string; amount: number | null }[]; categories: { income: Line[]; expense: Line[] } | null } | null
  alreadyFilled: boolean
  unchanged: boolean
  newAccount: boolean
  carried: boolean
  warnings: Warning[]
  nextStep: string
}
interface Commit { warnings: Warning[]; filled: string[]; missing: { name: string; member: string }[]; queue: string[]; stateHash: string; nextStep: string }
interface Draft { month: string; rows: DraftRow[]; loanPayments: { name: string; scheduled: number; amount: number | null }[]; stateHash: string }

const RYAN = { name: 'Harborline Checking', member: 'Ryan', currency: 'USD' }
const ANNIKA = { name: 'Rheinau Bank', member: 'Annika', currency: 'EUR' }
const FIGURES = { balance: 11000, active: 100, passive: 50, expense: 2000 }
const NOW = new Date()

const payloadOf = (h: Harness) => (h.db.sqlite.prepare('SELECT payload FROM month_drafts').all() as { payload: string }[]).map(r => r.payload)
const spendingOf = (h: Harness, month = '') => h.db.sqlite.prepare('SELECT date, category_id, source, amount, currency FROM category_spending WHERE date LIKE ? ORDER BY source, category_id, currency').all(`${month}%`)
const changeLogOf = (h: Harness) => h.db.sqlite.prepare('SELECT * FROM change_log ORDER BY id').all()
const linesOf = (h: Harness, month = '') => h.db.sqlite.prepare('SELECT date, bank, member, category_id, amount FROM flow_lines WHERE date LIKE ? ORDER BY bank, member, category_id').all(`${month}%`)
const snapshot = (h: Harness) => JSON.stringify([payloadOf(h), spendingOf(h), linesOf(h)])

/** A harness with the open month, two expense categories that are not the reserved one, and income categories (salary active, dividends passive, a one-off bonus) */
async function setup(opts: { telegram?: boolean } = {}) {
  const h = advisorHarness(opts)
  const draft = await h.result<Draft>('get_month_draft')
  const listing = await h.result<{ categories: { id: number; kind?: string }[] }>('list_spending_categories')
  const [food, rent] = listing.categories.filter(c => c.kind && c.kind !== 'loan_payment').map(c => c.id)
  const add = async (name: string, flow: string, oneOff = false) => (await h.result<{ category: { id: number } }>('add_spending_category', { name, flow, oneOff })).category.id
  const salary = await add('Wages', 'active')
  const dividends = await add('Payouts', 'passive')
  const bonus = await add('Windfall', 'active', true)
  const month = draft.month
  const body = (over: Record<string, unknown> = {}, account: Record<string, unknown> = {}) =>
    ({ month, account: { ...RYAN, ...account }, ...FIGURES, ...over })
  const preview = (over: Record<string, unknown> = {}, account: Record<string, unknown> = {}) => h.result<Preview>('preview_statement', body(over, account))
  const commit = (draftId: string) => h.result<Commit>('commit_statement', { draftId })
  const refused = async (tool: string, input: unknown, status: number, code: string, params?: Record<string, unknown>) => {
    const res = await h.call(tool, input)
    expect(await res.json()).toEqual({ error: params ? { code, params } : { code } })
    expect(res.status).toBe(status)
  }
  const refusedPreview = (over: Record<string, unknown>, status: number, code: string, params?: Record<string, unknown>, account: Record<string, unknown> = {}) =>
    refused('preview_statement', body(over, account), status, code, params)
  const rowOf = async (name: string, member: string) => (await h.result<Draft>('get_month_draft')).rows.find(r => accountKey(r.name, r.member) === accountKey(name, member))
  const spent = () => spendingOf(h, month)
  const lines = () => linesOf(h, month)
  const line = (account: { name: string; member: string }, category_id: number, amount: number) => ({ date: `${month}-01`, bank: account.name, member: account.member, category_id, amount })
  return { h, month, spent, lines, line, food, rent, salary, dividends, bonus, body, preview, commit, refused, refusedPreview, rowOf }
}

const statementContext = (t: Awaited<ReturnType<typeof setup>>): ToolContext => ({
  db: t.h.db, actor: { name: 'Test', source: 'mcp', userId: null, rights: { edit: true, vote: false, manage: false } },
  now: NOW, download: false, env: {}, authMode: 'password',
})

describe('the statement tools', () => {
  it('are listed after save_category_spending: the preview reads only, both need the enter-data right', () => {
    const names = ADVISOR_TOOLS.map(t => t.name)
    expect(names.slice(names.indexOf('save_category_spending') + 1, names.indexOf('save_category_spending') + 4)).toEqual(['get_month_draft', 'preview_statement', 'commit_statement'])
    const tools = Object.fromEntries(ADVISOR_TOOLS.map(t => [t.name, t]))
    expect(tools.preview_statement).toMatchObject({ right: 'edit', readOnly: true })
    expect(tools.commit_statement).toMatchObject({ right: 'edit' })
    expect(tools.commit_statement.readOnly).toBeUndefined()
    expect(tools.commit_statement.description).toMatch(/reload/)
    expect(tools.preview_statement.description).toMatch(/carried/)
    expect(tools.preview_statement.description).toMatch(/transfers/i)
  })

  it('a view-only user is refused by both', async () => {
    const h = advisorHarness({ viewOnly: true })
    expect((await h.call('preview_statement', {})).status).toBe(403)
    expect((await h.call('commit_statement', { draftId: 'x' })).status).toBe(403)
  })
})

describe('preview_statement', () => {
  it('writes nothing and answers the table, the allocation and the next step', async () => {
    const t = await setup()
    const everything = () => JSON.stringify([snapshot(t.h), changeLogOf(t.h)])
    const before = everything()
    const p = await t.preview({ categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }], note: 'March statement' })
    expect(everything()).toBe(before)
    expect(p.draftId).toEqual(expect.any(String))
    expect(new Date(p.expiresAt).getTime()).toBeGreaterThan(Date.now())
    expect(p.table.row).toMatchObject({ ...RYAN, class: 'bank', ...FIGURES })
    expect(p.table.categories?.income).toEqual([])
    expect(p.table.categories?.expense).toEqual([{ categoryId: t.food, name: expect.any(String), flow: 'expense', oneOff: false, amount: 300, currency: 'USD' }])
    expect(p.table.allocation).toEqual({
      active: { total: 100, allocated: 0, unallocated: 100 }, passive: { total: 50, allocated: 0, unallocated: 50 }, expense: { total: 2000, allocated: 300, unallocated: 1700 },
    })
    expect(p.table.loanLines).toEqual([])
    expect(p.was?.row).toMatchObject({ ...RYAN, balance: null, active: null })
    expect(p).toMatchObject({ alreadyFilled: false, unchanged: false, newAccount: false, carried: false, derived: [], hint: null })
    // what the lines leave is unallocated, and Claude says so
    expect(p.warnings).toEqual([
      { code: 'unallocated_remainder', params: { flow: 'active', amount: 100, currency: 'USD' } },
      { code: 'unallocated_remainder', params: { flow: 'passive', amount: 50, currency: 'USD' } },
      { code: 'unallocated_remainder', params: { flow: 'expense', amount: 1700, currency: 'USD' } },
    ])
    expect(p).not.toHaveProperty('source')
    expect(p.nextStep).toMatch(/explicit/i)
    expect(p.nextStep).toMatch(/one-off/)
    // without lines nothing is said about the rest
    expect((await t.preview()).warnings).toEqual([])
  })

  it('shows what the draft held when the account is already filled, and sees an identical re-upload as unchanged', async () => {
    const t = await setup()
    await t.commit((await t.preview()).draftId)
    const again = await t.preview()
    expect(again).toMatchObject({ alreadyFilled: true, unchanged: true })
    expect(again.was?.row).toMatchObject(FIGURES)
    const changed = await t.preview({ expense: 2100 })
    expect(changed).toMatchObject({ alreadyFilled: true, unchanged: false })
  })

  it('an added account is a new one and has nothing it was', async () => {
    const t = await setup()
    const p = await t.preview({}, { name: ' Quillmark Savings ', member: 'Annika', currency: 'USD', class: 'bank', added: true })
    expect(p).toMatchObject({ newAccount: true, was: null, alreadyFilled: false })
    expect(p.table.row).toMatchObject({ name: 'Quillmark Savings', member: 'Annika', class: 'bank', added: true, ...FIGURES })
  })

  it('carried takes last month\'s balance with zero movements', async () => {
    const t = await setup()
    const p = await t.h.result<Preview>('preview_statement', { month: t.month, account: { ...RYAN, carried: true } })
    expect(p.carried).toBe(true)
    expect(p.table.row).toMatchObject({ balance: 10520, active: 0, passive: 0, expense: 0 })
    await t.commit(p.draftId)
    expect(await t.rowOf(RYAN.name, RYAN.member)).toMatchObject({ balance: 10520, active: 0, passive: 0, expense: 0 })
  })

  it('a carried statement goes stale when last month\'s balance it copies is corrected before the commit', async () => {
    const t = await setup()
    const p = await t.h.result<Preview>('preview_statement', { month: t.month, account: { ...RYAN, carried: true } })
    expect(p.table.row).toMatchObject({ balance: 10520 })
    t.h.db.sqlite.prepare('UPDATE assets SET value = value + 5000 WHERE name = ? AND date = (SELECT max(date) FROM assets WHERE name = ? AND date < ?)').run(RYAN.name, RYAN.name, `${t.month}-01`)
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'advisor.draft_stale')
    expect(await t.rowOf(RYAN.name, RYAN.member)).not.toMatchObject({ balance: 10520 })
  })

  it('warns of a loan line that differs from its schedule, a period outside the month and a negative balance', async () => {
    const t = await setup()
    const p = await t.preview({ balance: -50, loanPayments: [{ name: 'Car loan', amount: 600 }], periodFrom: '2000-01-01', periodTo: '2000-01-31' })
    expect(p.warnings).toEqual(expect.arrayContaining([
      { code: 'loan_differs_from_schedule', params: { name: 'Car loan', amount: 600, scheduled: 495.03 } },
      { code: 'period_outside_month', params: { month: t.month, periodFrom: '2000-01-01', periodTo: '2000-01-31' } },
      { code: 'negative_balance_is_debt', params: { balance: -50 } },
    ]))
    expect(p.warnings).toHaveLength(3)
    expect(p.table.loanLines).toEqual([{ name: 'Car loan', amount: 600, scheduled: 495.03, balance: null, scheduledBalance: expect.any(Number) }])
    // a loan line that equals its schedule, and a period inside the month, warn of nothing
    const quiet = await t.preview({ loanPayments: [{ name: 'Car loan', amount: 495.03 }], periodFrom: `${t.month}-01`, periodTo: `${t.month}-28` })
    expect(quiet.warnings).toEqual([])
  })

  it('warns of a hand-typed source with the same category, and the commit still succeeds and keeps that source', async () => {
    const t = await setup()
    t.h.db.sqlite.prepare(`INSERT INTO category_spending (date, category_id, source, amount, currency) VALUES (?, ?, 'Hand card', 10, 'USD')`).run(`${t.month}-01`, t.food)
    const p = await t.preview({ categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }] })
    expect(p.warnings.filter(w => w.code !== 'unallocated_remainder')).toEqual([{ code: 'overlapping_sources', params: { sources: ['Hand card'], categoryIds: [t.food] } }])
    await t.commit(p.draftId)
    const sources = (t.spent() as { source: string }[]).map(r => r.source)
    expect(sources).toEqual(['Hand card'])
    expect(t.lines()).toEqual([t.line(RYAN, t.food, 300)])
  })

  it('does not warn of another account\'s lines: each account allocates its own totals', async () => {
    const t = await setup()
    await t.commit((await t.preview({ categories: [{ categoryId: t.food, amount: 5, currency: 'USD' }] })).draftId)
    const p = await t.h.result<Preview>('preview_statement', { month: t.month, account: ANNIKA, balance: 1, active: 0, passive: 0, expense: 9, categories: [{ categoryId: t.food, amount: 9, currency: 'EUR' }] })
    expect(p.warnings).toEqual([])
  })

  it('files both sides in one preview: income and expense lines grouped, a one-off named, a missing total derived from its lines', async () => {
    const t = await setup()
    const categories = [
      { categoryId: t.salary, amount: 3000, currency: 'USD' }, { categoryId: t.bonus, amount: 500, currency: 'USD' },
      { categoryId: t.dividends, amount: 20, currency: 'USD' }, { categoryId: t.food, amount: 400, currency: 'USD' },
    ]
    const p = await t.preview({ active: undefined, passive: 50, categories })
    expect(p.derived).toEqual(['active'])
    expect(p.table.row).toMatchObject({ active: 3500, passive: 50, expense: 2000 })
    expect(p.table.categories?.income.map(l => [l.categoryId, l.flow, l.oneOff, l.amount])).toEqual([[t.salary, 'active', false, 3000], [t.dividends, 'passive', false, 20], [t.bonus, 'active', true, 500]])
    expect(p.table.categories?.expense.map(l => l.categoryId)).toEqual([t.food])
    expect(p.table.allocation).toEqual({
      active: { total: 3500, allocated: 3500, unallocated: 0 }, passive: { total: 50, allocated: 20, unallocated: 30 }, expense: { total: 2000, allocated: 400, unallocated: 1600 },
    })
    expect(p.warnings).toEqual([
      { code: 'totals_derived', params: { fields: ['active'] } },
      { code: 'unallocated_remainder', params: { flow: 'passive', amount: 30, currency: 'USD' } },
      { code: 'unallocated_remainder', params: { flow: 'expense', amount: 1600, currency: 'USD' } },
    ])
    const c = await t.commit(p.draftId)
    expect(c.filled).toEqual(expect.arrayContaining(['active', 'categories']))
    expect(await t.rowOf(RYAN.name, RYAN.member)).toMatchObject({ active: 3500, passive: 50, expense: 2000 })
    expect(t.lines()).toEqual([t.line(RYAN, t.food, 400), t.line(RYAN, t.salary, 3000), t.line(RYAN, t.dividends, 20), t.line(RYAN, t.bonus, 500)].sort((a, b) => a.category_id - b.category_id))
    expect(t.spent()).toEqual([])
    // every total can come from the lines
    const all = await t.preview({ active: undefined, passive: undefined, expense: undefined, categories })
    expect(all.derived).toEqual(['active', 'passive', 'expense'])
    expect(all.table.row).toMatchObject({ active: 3500, passive: 20, expense: 400 })
  })

  it('a broker account answers the broker hint and warns of active income, which may be a deposit', async () => {
    const t = await setup()
    const broker = (await t.h.result<Draft>('get_month_draft')).rows.find(r => r.class === 'broker')!
    const account = { name: broker.name, member: broker.member, currency: broker.currency }
    const p = await t.preview({ active: 700 }, account)
    expect(p.hint).toBe('broker')
    expect(p.warnings).toContainEqual({ code: 'broker_active_income', params: { amount: 700 } })
    expect((await t.preview({ active: 0 }, account)).warnings).toEqual([])
    expect((await t.preview()).hint).toBeNull()
  })
})

/** The Car loan's schedule balance at the end of the open month, as the app computes it, and its tolerance */
async function carBalance(t: Awaited<ReturnType<typeof setup>>) {
  const loan = (await loadLoans(t.h.db)).find(l => l.name === 'Car loan')!
  const schedule = computeSchedule(loan, (await loadEarlyPayments(t.h.db)).filter(e => e.loan_name === loan.name))
  const raw = balanceFromSchedule(loan, schedule, monthEnd(t.month))!
  return { loan, raw, scheduled: round2(raw), tolerance: balanceTolerance(loan), date: monthEnd(t.month) }
}

describe('preview_statement: the bank\'s remaining balance of a loan', () => {
  it('a balance equal to the schedule\'s at the end of the month warns of nothing and shows both numbers', async () => {
    const t = await setup()
    const car = await carBalance(t)
    const p = await t.preview({ loanPayments: [{ name: 'Car loan', amount: 495.03, balance: car.scheduled }] })
    expect(p.warnings).toEqual([])
    expect(p.table.loanLines).toEqual([{ name: 'Car loan', amount: 495.03, scheduled: 495.03, balance: car.scheduled, scheduledBalance: car.scheduled }])
  })

  it('a balance beyond the tolerance adds loan_balance_differs, beside a payment that differs', async () => {
    const t = await setup()
    const car = await carBalance(t)
    const bank = round2(car.scheduled - car.tolerance - 1)
    const drift = { code: 'loan_balance_differs', params: { name: 'Car loan', bank, scheduled: car.scheduled, diff: round2(bank - car.scheduled), tolerance: car.tolerance, date: car.date, currency: car.loan.currency } }
    expect((await t.preview({ loanPayments: [{ name: 'Car loan', amount: 495.03, balance: bank }] })).warnings).toEqual([drift])
    const both = await t.preview({ loanPayments: [{ name: 'Car loan', amount: 600, balance: bank }] })
    expect(both.warnings).toEqual([{ code: 'loan_differs_from_schedule', params: { name: 'Car loan', amount: 600, scheduled: 495.03 } }, drift])
    // a debt the bank shows above the schedule warns too, with a positive difference
    const above = await t.preview({ loanPayments: [{ name: 'Car loan', amount: 495.03, balance: round2(car.scheduled + car.tolerance + 1) }] })
    expect(above.warnings).toHaveLength(1)
    expect((above.warnings[0].params as { diff: number }).diff).toBeGreaterThan(car.tolerance)
  })

  it('the balance is never stored: the draft keeps the name and the amount, and a re-upload differing only in it is unchanged', async () => {
    const t = await setup()
    const car = await carBalance(t)
    const c = await t.commit((await t.preview({ loanPayments: [{ name: 'Car loan', amount: 495.03, balance: car.scheduled }] })).draftId)
    const stored = JSON.parse(payloadOf(t.h)[0]) as { loans: Record<string, unknown>[] }
    expect(stored.loans).toEqual([{ name: 'Car loan', amount: 495.03 }])
    expect(c.filled).not.toContain('balance:Car loan')
    const again = await t.preview({ loanPayments: [{ name: 'Car loan', amount: 495.03, balance: 1 }] })
    expect(again.unchanged).toBe(true)
    const second = await t.commit(again.draftId)
    expect(second.stateHash).not.toBe(c.stateHash)
  })

  it('a loan closed in the month has no schedule balance at its end: no warning', async () => {
    const t = await setup()
    t.h.db.sqlite.prepare(`UPDATE loans SET status = 'closed', closed_date = ? WHERE name = 'Car loan'`).run(`${t.month}-15`)
    const p = await t.preview({ loanPayments: [{ name: 'Car loan', amount: 495.03, balance: 123 }] })
    expect(p.warnings).toEqual([])
    expect(p.table.loanLines[0]).toMatchObject({ balance: 123, scheduledBalance: null })
    // closed before the month, it has no line at all, as before
    t.h.db.sqlite.prepare(`UPDATE loans SET closed_date = '2000-01-01' WHERE name = 'Car loan'`).run()
    await t.refusedPreview({ loanPayments: [{ name: 'Car loan', amount: 1, balance: 1 }] }, 400, 'advisor.unknown_loan', { name: 'Car loan' })
  })

  it('refuses a negative or non-number balance', async () => {
    const t = await setup()
    await t.refusedPreview({ loanPayments: [{ name: 'Car loan', amount: 1, balance: -1 }] }, 400, 'invalid_amount')
    await t.refusedPreview({ loanPayments: [{ name: 'Car loan', amount: 1, balance: 'x' }] }, 400, 'invalid_param', { param: 'loanPayments' })
  })
})

describe('commit_statement: the bank\'s remaining balance of a loan', () => {
  it('echoes the drift, recomputed against the schedule as it is at the commit, and is not stale for it', async () => {
    const t = await setup()
    const car = await carBalance(t)
    const drifting = await t.preview({ loanPayments: [{ name: 'Car loan', amount: 495.03, balance: round2(car.scheduled - car.tolerance - 1) }] })
    expect((await t.commit(drifting.draftId)).warnings.map(w => w.code)).toEqual(['loan_balance_differs'])
    // quiet at the preview; an early payment entered before the commit makes the bank's figure the right one
    const quiet = await t.preview({ loanPayments: [{ name: 'Car loan', amount: 495.03, balance: car.scheduled }] })
    expect(quiet.warnings).toEqual([])
    t.h.db.sqlite.prepare(`INSERT INTO loan_early_payments (loan_name, payment_date, amount, strategy) VALUES ('Car loan', ?, ?, 'reduce_term')`).run(`${t.month}-28`, round2(car.tolerance * 3))
    const c = await t.commit(quiet.draftId)
    expect(c.warnings).toEqual([expect.objectContaining({ code: 'loan_balance_differs', params: expect.objectContaining({ bank: car.scheduled, date: car.date }) })])
    // without a balance nothing is said
    expect((await t.commit((await t.preview({ loanPayments: [{ name: 'Car loan', amount: 495.03 }] })).draftId)).warnings).toEqual([])
  })
})

describe('preview_statement refusals', () => {
  it('month_out_of_order 409 for a month that is not the first open one', async () => {
    const t = await setup()
    await t.refusedPreview({ month: '2020-01' }, 409, 'month_out_of_order')
  })

  it('advisor.unknown_account for an account that is not there and not added', async () => {
    const t = await setup()
    await t.refusedPreview({}, 409, 'advisor.unknown_account', undefined, { name: 'Nowhere Bank' })
    await t.refusedPreview({}, 409, 'advisor.unknown_account', undefined, { name: 'Nowhere Bank', added: true })
  })

  it('advisor.similar_account until the user confirms a new account that looks like the member\'s account in that currency', async () => {
    const t = await setup()
    const added = { class: 'bank', added: true }
    await t.refusedPreview({}, 409, 'advisor.similar_account', { similar: ['Harborline Checking'] }, { name: 'Harborline Checkng', ...added })
    expect((await t.preview({}, { name: 'Harborline Checkng', ...added, confirmed_new: true })).newAccount).toBe(true)
    // another member or another currency is a different account
    expect((await t.preview({}, { name: 'Harborline Checkng', member: 'Annika', ...added })).newAccount).toBe(true)
    expect((await t.preview({}, { name: 'Harborline Checkng', currency: 'EUR', ...added })).newAccount).toBe(true)
    await t.refusedPreview({}, 400, 'invalid_param', { param: 'account.confirmed_new' }, { name: 'X Bank', ...added, confirmed_new: 'yes' })
    // the exact name is the existing account and needs no flag
    expect((await t.preview({}, added)).newAccount).toBe(false)
  })

  it('advisor.currency_mismatch names the expected and the given currency', async () => {
    const t = await setup()
    await t.refusedPreview({}, 409, 'advisor.currency_mismatch', { expected: 'USD', got: 'EUR' }, { currency: 'EUR' })
  })

  it('invalid_amount for a negative flow, loan line or category amount; a negative balance is allowed', async () => {
    const t = await setup()
    for (const field of ['active', 'passive', 'expense']) await t.refusedPreview({ [field]: -1 }, 400, 'invalid_amount')
    await t.refusedPreview({ loanPayments: [{ name: 'Car loan', amount: -5 }] }, 400, 'invalid_amount')
    await t.refusedPreview({ categories: [{ categoryId: t.food, amount: -5, currency: 'USD' }] }, 400, 'invalid_amount')
    await t.preview({ balance: -1 })
  })

  it('missing_param names the flow that is absent while Cash flow is on and nothing is carried', async () => {
    const t = await setup()
    for (const field of ['active', 'passive', 'expense']) {
      await t.refusedPreview({ [field]: undefined }, 400, 'missing_param', { param: field })
    }
    await t.refusedPreview({ balance: undefined }, 400, 'missing_param', { param: 'balance' })
    expect(payloadOf(t.h)).toEqual([])
    expect(t.spent()).toEqual([])
  })

  it('invalid_param for a wrong shape and for a class that is not an account class', async () => {
    const t = await setup()
    await t.refusedPreview({}, 400, 'invalid_param', { param: 'account.class' }, { name: 'New Bank', member: 'Ryan', class: 'savings', added: true })
    await t.refusedPreview({ balance: 'a lot' }, 400, 'invalid_param', { param: 'balance' })
    await t.refusedPreview({ note: 'x'.repeat(201) }, 400, 'invalid_param', { param: 'note' })
    await t.refusedPreview({ periodFrom: 'yesterday' }, 400, 'invalid_param', { param: 'periodFrom' })
    // a well-shaped date that is no day (month 13, 30 February) is invalid_param, not a server error
    await t.refusedPreview({ periodFrom: '2031-13-01' }, 400, 'invalid_param', { param: 'periodFrom' })
    await t.refusedPreview({ periodTo: '2031-02-30' }, 400, 'invalid_param', { param: 'periodTo' })
    // past any family's figure a statement was misread
    await t.refusedPreview({ balance: 1e13 }, 400, 'invalid_param', { param: 'balance' })
    await t.refusedPreview({ expense: 2e12 }, 400, 'invalid_param', { param: 'expense' })
    await t.refusedPreview({ categories: [{ categoryId: t.food, amount: 1, currency: 'USD' }, { categoryId: t.food, amount: 2, currency: 'USD' }] }, 400, 'invalid_param', { param: 'categories' })
    await t.refusedPreview({ loanPayments: [{ name: 'Car loan', amount: 1 }, { name: 'Car loan', amount: 2 }] }, 400, 'invalid_param', { param: 'loanPayments' })
  })

  it('advisor.invalid_name for an added account\'s name or member with a bidi character, empty or 61 characters long', async () => {
    const t = await setup()
    const added = { class: 'bank', added: true, currency: 'USD' }
    await t.refusedPreview({}, 400, 'advisor.invalid_name', { field: 'name' }, { ...added, name: 'Evil‮Bank', member: 'Ryan' })
    await t.refusedPreview({}, 400, 'advisor.invalid_name', { field: 'name' }, { ...added, name: 'x'.repeat(61), member: 'Ryan' })
    await t.refusedPreview({}, 400, 'advisor.invalid_name', { field: 'member' }, { ...added, name: 'Fine Bank', member: 'Ry​an' })
    await t.refusedPreview({}, 400, 'advisor.invalid_name', { field: 'name' }, { ...added, name: '   ', member: 'Ryan' })
  })

  it('unknown_member and unknown_currency for an added account carry the lists', async () => {
    const t = await setup()
    const added = { name: 'New Bank', class: 'bank', added: true }
    await t.refusedPreview({}, 400, 'unknown_member', { members: ['Annika', 'Ryan'] }, { ...added, member: 'Stranger', currency: 'USD' })
    await t.refusedPreview({}, 400, 'unknown_currency', { currencies: ['EUR', 'USD'] }, { ...added, member: 'Ryan', currency: 'XXX' })
    // a line is in the account's currency: one account, one currency
    await t.refusedPreview({ categories: [{ categoryId: t.food, amount: 1, currency: 'XXX' }] }, 409, 'advisor.currency_mismatch', { expected: 'USD', got: 'XXX' })
    await t.refusedPreview({ categories: [{ categoryId: t.food, amount: 1, currency: 'EUR' }] }, 409, 'advisor.currency_mismatch', { expected: 'USD', got: 'EUR' })
  })

  it('flows_not_tracked 409 for flows, categories or loan lines while income and expenses are not tracked', async () => {
    const t = await setup()
    t.h.db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0')")
    await t.refusedPreview({}, 409, 'flows_not_tracked')
    await t.refusedPreview({ active: undefined, passive: undefined, expense: undefined, categories: [{ categoryId: t.food, amount: 1, currency: 'USD' }] }, 409, 'flows_not_tracked')
    await t.refusedPreview({ active: undefined, passive: undefined, expense: undefined, loanPayments: [{ name: 'Car loan', amount: 1 }] }, 409, 'flows_not_tracked')
    // the balance alone is a statement while income and expenses are not tracked
    expect((await t.preview({ active: undefined, passive: undefined, expense: undefined })).table.row).toMatchObject({ balance: 11000, active: null })
  })

  it('advisor.unknown_loan and advisor.unknown_category', async () => {
    const t = await setup()
    await t.refusedPreview({ loanPayments: [{ name: 'Boat loan', amount: 1 }] }, 400, 'advisor.unknown_loan', { name: 'Boat loan' })
    await t.refusedPreview({ categories: [{ categoryId: 9999, amount: 1, currency: 'USD' }] }, 400, 'advisor.unknown_category', { categoryId: 9999 })
  })

  it('the reserved loan category is refused as a line: loan repayments go to loanPayments', async () => {
    const t = await setup()
    await t.refusedPreview({ categories: [{ categoryId: 1, amount: 5, currency: 'USD' }] }, 400, 'invalid_category_flow', { param: 'loanPayments' })
  })

  it('lines above a given total are refused before anything is staged, with the flow, the lines and the total', async () => {
    const t = await setup()
    await t.refusedPreview({ categories: [{ categoryId: t.salary, amount: 60 }, { categoryId: t.bonus, amount: 41 }].map(c => ({ ...c, currency: 'USD' })) }, 400, 'lines_exceed_total', { flow: 'active', lines: 101, total: 100 })
    await t.refusedPreview({ categories: [{ categoryId: t.food, amount: 2000.01, currency: 'USD' }] }, 400, 'lines_exceed_total', { flow: 'expense', lines: 2000.01, total: 2000 })
    // within rounding is not over
    expect((await t.preview({ categories: [{ categoryId: t.food, amount: 2000.004, currency: 'USD' }] })).draftId).toEqual(expect.any(String))
  })

  it('without categories, the account\'s lines stay and must fit under the new totals', async () => {
    const t = await setup()
    await t.commit((await t.preview({ categories: [{ categoryId: t.food, amount: 1500, currency: 'USD' }] })).draftId)
    await t.refusedPreview({ expense: 1000 }, 400, 'lines_exceed_total', { flow: 'expense', lines: 1500, total: 1000 })
    const p = await t.preview({ expense: 1800 })
    expect(p.table.categories?.expense.map(l => l.amount)).toEqual([1500])
    expect(p.table.allocation?.expense).toEqual({ total: 1800, allocated: 1500, unallocated: 300 })
    expect(p.was?.categories?.expense.map(l => l.amount)).toEqual([1500])
  })

  it('advisor.no_previous_balance for carried with no balance behind it or on a filled row', async () => {
    const t = await setup()
    const carried = { month: t.month }
    await t.refused('preview_statement', { ...carried, account: { name: 'Fresh', member: 'Ryan', currency: 'USD', class: 'bank', added: true, carried: true } }, 409, 'advisor.no_previous_balance')
    await t.commit((await t.preview()).draftId)
    await t.refused('preview_statement', { ...carried, account: { ...RYAN, carried: true } }, 409, 'advisor.no_previous_balance')
  })

  it('a carried account is refused the figures that contradict it', async () => {
    const t = await setup()
    await t.refused('preview_statement', { month: t.month, account: { ...RYAN, carried: true }, balance: 5 }, 400, 'invalid_param', { param: 'balance' })
    await t.refused('preview_statement', { month: t.month, account: { ...RYAN, carried: true }, expense: 5 }, 400, 'invalid_param', { param: 'expense' })
  })
})

describe('commit_statement', () => {
  it.each([
    { table: 'flow_lines', added: false }, { table: 'change_log', added: false },
    { table: 'flow_lines', added: true }, { table: 'change_log', added: true },
  ])('rolls back draft, revision, lines and journal when $table insertion aborts (added: $added)', async ({ table, added }) => {
    const t = await setup()
    await t.commit((await t.preview({ categories: [{ categoryId: t.food, amount: 100, currency: 'USD' }] })).draftId)
    const p = await t.preview({ balance: 12000, categories: [{ categoryId: t.food, amount: 200, currency: 'USD' }] }, added ? { name: 'New savings', added: true, class: 'bank' } : {})
    const stored = () => JSON.stringify([
      t.h.db.sqlite.prepare('SELECT * FROM month_drafts').all(),
      t.h.db.sqlite.prepare('SELECT * FROM month_draft_revisions').all(),
      t.h.db.sqlite.prepare('SELECT rowid, * FROM flow_lines ORDER BY rowid').all(), changeLogOf(t.h),
    ])
    const before = stored()
    t.h.db.sqlite.exec(`CREATE TRIGGER reject_statement BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected statement failure'); END`)
    await expect(commitStatement.run(await statementContext(t), { draftId: p.draftId })).rejects.toThrow('injected statement failure')
    expect(stored()).toBe(before)
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'advisor.draft_not_found')
  })

  it('validates current category caps before writing any part of the statement', async () => {
    const t = await setup()
    const p = await t.preview({ categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }] })
    // A category's changed definition now allocates active income, whose approved total is only 100.
    t.h.db.sqlite.prepare("UPDATE spending_categories SET flow = 'active' WHERE id = ?").run(t.food)
    const before = snapshot(t.h)
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'lines_exceed_total', { flow: 'active', lines: 300, total: 100 })
    expect(snapshot(t.h)).toBe(before)
    expect(t.h.db.sqlite.prepare('SELECT * FROM month_draft_revisions').all()).toEqual([])
  })

  it('merges interleaving approvals for different accounts with their own category lines', async () => {
    const t = await setup()
    const first = await t.preview({ categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }] })
    const second = await t.preview({ balance: 700, categories: [{ categoryId: t.food, amount: 600, currency: 'EUR' }] }, ANNIKA)
    const ctx = await statementContext(t)
    const batch = t.h.db.guardedBatch.bind(t.h.db)
    const guard = vi.spyOn(t.h.db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
      await commitStatement.run(ctx, { draftId: second.draftId })
      return batch(token, statements)
    })
    const result = await t.commit(first.draftId)
    expect(await t.rowOf(RYAN.name, RYAN.member)).toMatchObject(FIGURES)
    expect(await t.rowOf(ANNIKA.name, ANNIKA.member)).toMatchObject({ balance: 700 })
    expect(t.lines()).toEqual([t.line(RYAN, t.food, 300), t.line(ANNIKA, t.food, 600)].sort((a, b) => a.bank < b.bank ? -1 : 1))
    expect((await t.h.result<Draft>('get_month_draft')).stateHash).toBe(result.stateHash)
    await t.refused('commit_statement', { draftId: first.draftId }, 409, 'advisor.draft_not_found')
    await t.refused('commit_statement', { draftId: second.draftId }, 409, 'advisor.draft_not_found')
    guard.mockRestore()
  })

  it('keeps the winning statement when the touched account changes before the guard', async () => {
    const t = await setup()
    const first = await t.preview({ categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }] })
    const second = await t.preview({ balance: 700, categories: [{ categoryId: t.food, amount: 600, currency: 'USD' }] })
    const ctx = await statementContext(t)
    const batch = t.h.db.guardedBatch.bind(t.h.db)
    let winner = ''
    const guard = vi.spyOn(t.h.db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
      await commitStatement.run(ctx, { draftId: second.draftId })
      winner = snapshot(t.h)
      return batch(token, statements)
    })
    await t.refused('commit_statement', { draftId: first.draftId }, 409, 'advisor.draft_stale')
    expect(snapshot(t.h)).toBe(winner)
    expect(await t.rowOf(RYAN.name, RYAN.member)).toMatchObject({ balance: 700 })
    expect(t.lines()).toEqual([t.line(RYAN, t.food, 600)])
    await t.refused('commit_statement', { draftId: first.draftId }, 409, 'advisor.draft_not_found')
    guard.mockRestore()
  })

  it('recomputes schedule warnings on a guarded rebuild without consuming the preview again', async () => {
    const t = await setup()
    const car = await carBalance(t)
    const p = await t.preview({ loanPayments: [{ name: 'Car loan', amount: 495.03, balance: car.scheduled }] })
    expect(p.warnings).toEqual([])
    const batch = t.h.db.guardedBatch.bind(t.h.db)
    const guard = vi.spyOn(t.h.db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
      t.h.db.sqlite.prepare("INSERT INTO loan_early_payments (loan_name, payment_date, amount, strategy) VALUES ('Car loan', ?, ?, 'reduce_term')").run(`${t.month}-28`, round2(car.tolerance * 3))
      return batch(token, statements)
    })
    const result = await t.commit(p.draftId)
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'loan_balance_differs', params: expect.objectContaining({ bank: car.scheduled, date: car.date }) })])
    expect((await t.h.result<Draft>('get_month_draft')).stateHash).toBe(result.stateHash)
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'advisor.draft_not_found')
    guard.mockRestore()
  })

  it('reads the tracking again on a guarded rebuild and refuses an approval whose flows stopped being tracked', async () => {
    const t = await setup()
    const p = await t.preview({ categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }] })
    const before = snapshot(t.h)
    const batch = t.h.db.guardedBatch.bind(t.h.db)
    const guard = vi.spyOn(t.h.db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
      t.h.db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0')")
      return batch(token, statements)
    })
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'advisor.draft_stale')
    expect(snapshot(t.h)).toBe(before)
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'advisor.draft_not_found')
    guard.mockRestore()
  })

  it('rejects a preview from another database without consuming the owner preview', async () => {
    const t = await setup()
    const other = await setup()
    const p = await t.preview()
    await other.refused('commit_statement', { draftId: p.draftId }, 409, 'advisor.draft_not_found')
    await t.commit(p.draftId)
  })

  it('returns its own acknowledged state without any post-commit database reads', async () => {
    const t = await setup()
    const p = await t.preview({ categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }] })
    const ctx = await statementContext(t)
    const batch = t.h.db.guardedBatch.bind(t.h.db)
    let reads: ReturnType<typeof vi.spyOn> | undefined
    const guard = vi.spyOn(t.h.db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
      const result = await batch(token, statements)
      reads = vi.spyOn(t.h.db, 'prepare').mockImplementation(() => { throw new Error('post-commit read') })
      return result
    })
    let result: Commit
    try {
      result = await commitStatement.run(ctx, { draftId: p.draftId }) as Commit
    } finally {
      reads?.mockRestore()
      guard.mockRestore()
    }
    expect((await t.h.result<Draft>('get_month_draft')).stateHash).toBe(result.stateHash)
  })

  it('writes the account\'s row, the loan lines and the account\'s lines, and answers what is still missing', async () => {
    const t = await setup()
    const p = await t.preview({ loanPayments: [{ name: 'Car loan', amount: 500 }], categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }, { categoryId: t.rent, amount: 700, currency: 'USD' }] })
    const c = await t.commit(p.draftId)
    expect(c.queue).toEqual([t.month])
    expect(c.stateHash).toMatch(/^[0-9a-f]{64}$/)
    expect(c.filled).toEqual(expect.arrayContaining(['balance', 'active', 'passive', 'expense', 'categories', 'loan:Car loan']))
    expect(c.missing).toHaveLength(5)
    expect(c.missing).toContainEqual({ name: ANNIKA.name, member: 'Annika' })
    expect(c.missing).not.toContainEqual({ name: RYAN.name, member: 'Ryan' })
    expect(c.nextStep).toMatch(/missing/)
    expect(c.nextStep).toMatch(/reload/i)
    expect(await t.rowOf(RYAN.name, RYAN.member)).toMatchObject(FIGURES)
    const d = await t.h.result<Draft>('get_month_draft')
    expect(d.stateHash).toBe(c.stateHash)
    expect(d.loanPayments.find(l => l.name === 'Car loan')?.amount).toBe(500)
    expect(t.lines()).toEqual([t.line(RYAN, t.food, 300), t.line(RYAN, t.rent, 700)].sort((a, b) => a.category_id - b.category_id))
    expect(t.spent()).toEqual([])
    // journaled as the lines' own write path does
    expect(changeLogOf(t.h).filter(e => (e as { table_name: string }).table_name === 'flow_lines')).toHaveLength(2)
  })

  it('says the month is ready once every account is in', async () => {
    const t = await setup()
    const state = await getMonthCloseState(t.h.db, NOW)
    let last: Commit | null = null
    for (const r of state.rows) {
      const p = await t.h.result<Preview>('preview_statement', { month: t.month, account: { name: r.name, member: r.member, currency: r.currency }, balance: 1, active: 0, passive: 0, expense: 0 })
      last = await t.commit(p.draftId)
    }
    expect(last?.missing).toEqual([])
    expect(last?.nextStep).toMatch(/close/i)
    expect(last?.nextStep).toMatch(/reload/i)
    expect(last?.nextStep).toMatch(/orphaned account lines/)
  })

  it('without categories leaves the lines as they are; with an empty list replaces them', async () => {
    const t = await setup()
    await t.commit((await t.preview({ categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }] })).draftId)
    expect(t.lines()).toHaveLength(1)
    const omitted = await t.commit((await t.preview({ expense: 301 })).draftId)
    expect((await t.h.result<Draft>('get_month_draft')).stateHash).toBe(omitted.stateHash)
    expect(t.lines()).toHaveLength(1)
    const empty = await t.commit((await t.preview({ categories: [] })).draftId)
    expect((await t.h.result<Draft>('get_month_draft')).stateHash).toBe(empty.stateHash)
    expect(t.lines()).toEqual([])
  })

  it('a statement for an added account commits its row and lines together', async () => {
    const t = await setup()
    const account = { name: 'Quillmark Savings', member: 'Annika', currency: 'USD', class: 'bank', added: true }
    const p = await t.preview({ categories: [{ categoryId: t.salary, amount: 100, currency: 'USD' }, { categoryId: t.food, amount: 2000, currency: 'USD' }] }, account)
    expect(p.newAccount).toBe(true)
    await t.commit(p.draftId)
    expect(await t.rowOf(account.name, account.member)).toMatchObject({ added: true, ...FIGURES })
    expect(t.lines()).toEqual([t.line(account, t.food, 2000), t.line(account, t.salary, 100)].sort((a, b) => a.category_id - b.category_id))
  })

  it('a line changed after the preview changes the state hash and makes the commit stale, writing nothing', async () => {
    const t = await setup()
    await t.commit((await t.preview({ categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }] })).draftId)
    const seen = (await t.h.result<Draft>('get_month_draft')).stateHash
    const p = await t.preview({ categories: [{ categoryId: t.food, amount: 350, currency: 'USD' }] })
    t.h.db.sqlite.prepare('UPDATE flow_lines SET amount = 299 WHERE bank = ?').run(RYAN.name)
    expect((await t.h.result<Draft>('get_month_draft')).stateHash).not.toBe(seen)
    const before = snapshot(t.h)
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'advisor.draft_stale')
    expect(snapshot(t.h)).toBe(before)
    await t.refused('close_month', { month: t.month, stateHash: seen }, 409, 'advisor.draft_stale')
  })

  it('the same statement committed from two previews leaves an identical draft and identical spending rows', async () => {
    const t = await setup()
    const input = { loanPayments: [{ name: 'Car loan', amount: 500 }], categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }] }
    await t.commit((await t.preview(input)).draftId)
    const once = snapshot(t.h)
    await t.commit((await t.preview(input)).draftId)
    expect(snapshot(t.h)).toBe(once)
  })

  it('a draft id is needed: missing_param without one, invalid_param for a non-string', async () => {
    const t = await setup()
    await t.refused('commit_statement', {}, 400, 'missing_param', { param: 'draftId' })
    await t.refused('commit_statement', { draftId: 5 }, 400, 'invalid_param', { param: 'draftId' })
  })

  it('advisor.draft_not_found 409 for an unknown, a used and an expired draft, writing nothing', async () => {
    const t = await setup()
    const p = await t.preview({ categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }] })
    await t.refused('commit_statement', { draftId: 'nope' }, 409, 'advisor.draft_not_found')
    await t.commit(p.draftId)
    const after = snapshot(t.h)
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'advisor.draft_not_found')
    const old = stage(t.h.db, 'statement', 0, {}, new Date(0))
    await t.refused('commit_statement', { draftId: old.id }, 409, 'advisor.draft_not_found')
    expect(snapshot(t.h)).toBe(after)
  })

  it('works in password mode, where the user id is null', async () => {
    const t = await setup()
    expect((await t.commit((await t.preview()).draftId)).missing).toHaveLength(5)
  })

  it('another user\'s draft id is not found, and its owner can still commit it', async () => {
    const t = await setup({ telegram: true })
    const ids = (t.h.db.sqlite.prepare('SELECT id FROM users ORDER BY id').all() as { id: number }[]).map(r => r.id)
    expect(ids.length).toBeGreaterThanOrEqual(2)
    const [first, second] = ids
    expect(first).not.toBe(second)
    const asFirst = async (tool: string, input: unknown) => {
      const res = await t.h.callAs(first, tool, input)
      expect(res.status).toBe(200)
      return (await res.json() as { result: never }).result
    }
    const p = await asFirst('preview_statement', t.body()) as Preview
    const before = snapshot(t.h)
    const res = await t.h.callAs(second, 'commit_statement', { draftId: p.draftId })
    expect([res.status, await res.json()]).toEqual([409, { error: { code: 'advisor.draft_not_found' } }])
    expect(snapshot(t.h)).toBe(before)
    const c = await asFirst('commit_statement', { draftId: p.draftId }) as Commit
    expect(c.missing).toHaveLength(5)
    expect(await t.rowOf(RYAN.name, RYAN.member)).toMatchObject(FIGURES)
  })

  it('aborts without statement writes when a revision changes between the view and draft validation', async () => {
    const t = await setup()
    await t.commit((await t.preview()).draftId)
    const p = await t.preview({ balance: 12000, categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }] })
    const prepare = t.h.db.prepare.bind(t.h.db)
    let reads = 0
    let afterOtherSave = ''
    const read = vi.spyOn(t.h.db, 'prepare').mockImplementation(sql => {
      if (sql.startsWith('SELECT payload, updated_at FROM month_drafts') && ++reads === 3) {
        // Initial monthView and its spending read are complete; buildSaveDraft now reads a newer revision.
        const stored = JSON.parse(payloadOf(t.h)[0]) as { rows: DraftRow[] }
        stored.rows = stored.rows.map(row => row.name === ANNIKA.name ? { ...row, balance: 777 } : row)
        t.h.db.sqlite.prepare('UPDATE month_drafts SET payload = ? WHERE month = ?').run(JSON.stringify(stored), t.month)
        t.h.db.sqlite.prepare('UPDATE month_draft_revisions SET revision = revision + 1 WHERE month = ?').run(t.month)
        afterOtherSave = snapshot(t.h)
      }
      return prepare(sql)
    })
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'draft_conflict')
    expect(snapshot(t.h)).toBe(afterOtherSave)
    expect(await t.rowOf(RYAN.name, RYAN.member)).toMatchObject({ balance: 11000 })
    expect(await t.rowOf(ANNIKA.name, ANNIKA.member)).toMatchObject({ balance: 777 })
    expect(t.lines()).toEqual([])
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'advisor.draft_not_found')
    read.mockRestore()
  })

  it('rebuilds once after an unrelated wizard save and preserves both approved changes', async () => {
    const t = await setup()
    const p = await t.preview()
    const batch = t.h.db.guardedBatch.bind(t.h.db)
    const guard = vi.spyOn(t.h.db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
      const state = await getMonthCloseState(t.h.db, NOW)
      await saveDraft(t.h.db, t.month, { expectedRevision: state.draftRevision, rows: state.rows.map(r => (r.name === ANNIKA.name ? { ...r, balance: 777 } : r)) }, NOW)
      return batch(token, statements)
    })
    const result = await t.commit(p.draftId)
    expect((await t.h.result<Draft>('get_month_draft')).stateHash).toBe(result.stateHash)
    expect(await t.rowOf(RYAN.name, RYAN.member)).toMatchObject(FIGURES)
    expect(await t.rowOf(ANNIKA.name, 'Annika')).toMatchObject({ balance: 777 })
    expect(t.h.db.sqlite.prepare('SELECT revision FROM month_draft_revisions WHERE month = ?').get(t.month)).toEqual({ revision: 2 })
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'advisor.draft_not_found')
    guard.mockRestore()
  })

  it('a wizard save that changes this account\'s row makes the commit stale, writing nothing', async () => {
    const t = await setup()
    const p = await t.preview({ categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }] })
    const state = await getMonthCloseState(t.h.db, NOW)
    await saveDraft(t.h.db, t.month, { expectedRevision: (await getMonthCloseState(t.h.db, NOW)).draftRevision, rows: state.rows.map(r => (r.name === RYAN.name ? { ...r, balance: 1 } : r)), loans: [] }, NOW)
    const before = snapshot(t.h)
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'advisor.draft_stale')
    expect(snapshot(t.h)).toBe(before)
    expect(t.spent()).toEqual([])
  })

  it('a wizard save that changes only another account\'s row does not make it stale', async () => {
    const t = await setup()
    const p = await t.preview()
    const state = await getMonthCloseState(t.h.db, NOW)
    await saveDraft(t.h.db, t.month, { expectedRevision: (await getMonthCloseState(t.h.db, NOW)).draftRevision, rows: state.rows.map(r => (r.name === ANNIKA.name ? { ...r, balance: 7 } : r)), loans: [] }, NOW)
    await t.commit(p.draftId)
    expect(await t.rowOf(RYAN.name, RYAN.member)).toMatchObject(FIGURES)
    expect(await t.rowOf(ANNIKA.name, 'Annika')).toMatchObject({ balance: 7 })
  })

  it('a change to a loan line it names, or to its own lines, makes it stale; another loan does not', async () => {
    const t = await setup()
    const named = await t.preview({ loanPayments: [{ name: 'Car loan', amount: 500 }] })
    const state = await getMonthCloseState(t.h.db, NOW)
    await saveDraft(t.h.db, t.month, { expectedRevision: (await getMonthCloseState(t.h.db, NOW)).draftRevision, rows: state.rows, loans: [{ name: 'Maple Street mortgage', amount: 1 }] }, NOW)
    await t.commit(named.draftId)
    const second = await t.preview({ loanPayments: [{ name: 'Car loan', amount: 400 }] })
    const again = await getMonthCloseState(t.h.db, NOW)
    await saveDraft(t.h.db, t.month, { expectedRevision: (await getMonthCloseState(t.h.db, NOW)).draftRevision, rows: again.rows, loans: [{ name: 'Car loan', amount: 3 }] }, NOW)
    await t.refused('commit_statement', { draftId: second.draftId }, 409, 'advisor.draft_stale')
    const source = await t.preview({ categories: [{ categoryId: t.food, amount: 1, currency: 'USD' }] })
    t.h.db.sqlite.prepare(`INSERT INTO flow_lines (date, bank, member, category_id, amount) VALUES (?, ?, ?, ?, 9)`).run(`${t.month}-01`, RYAN.name, RYAN.member, t.rent)
    await t.refused('commit_statement', { draftId: source.draftId }, 409, 'advisor.draft_stale')
  })

  it('tracking switched off between preview and commit makes it stale', async () => {
    const t = await setup()
    const p = await t.preview()
    t.h.db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0')")
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'advisor.draft_stale')
    expect(payloadOf(t.h)).toEqual([])
  })

  it('a month closed between preview and commit makes it stale and leaves the lines untouched', async () => {
    const t = await setup()
    const p = await t.preview({ categories: [{ categoryId: t.food, amount: 300, currency: 'USD' }] })
    t.h.db.sqlite.prepare(`INSERT INTO closed_months (month, closed_at, closed_by) VALUES (?, 't', 'test')`).run(t.month)
    await t.refused('commit_statement', { draftId: p.draftId }, 409, 'advisor.draft_stale')
    expect(t.lines()).toEqual([])
  })

  it('a commit naming no loan leaves the loans of the draft without an entry for it, still at its schedule', async () => {
    const t = await setup()
    await t.commit((await t.preview()).draftId)
    const stored = JSON.parse(payloadOf(t.h)[0]) as { loans?: { name: string }[] }
    expect((stored.loans ?? []).find(l => l.name === 'Car loan')).toBeUndefined()
    const loan = (await t.h.result<Draft>('get_month_draft')).loanPayments.find(l => l.name === 'Car loan')
    expect(loan?.amount).toBe(loan?.scheduled)
  })

  it('amounts are kept to the cent', async () => {
    const t = await setup()
    const p = await t.preview({ balance: 100.004, expense: 0.1 + 0.2 })
    expect(p.table.row).toMatchObject({ balance: 100, expense: 0.3 })
  })

  it('all-zero figures fill the row', async () => {
    const t = await setup()
    await t.commit((await t.preview({ balance: 0, active: 0, passive: 0, expense: 0 })).draftId)
    expect(await t.rowOf(RYAN.name, RYAN.member)).toMatchObject({ balance: 0, active: 0, passive: 0, expense: 0 })
  })

  it('two added accounts with one name and different members stay separate, each with its own lines', async () => {
    const t = await setup()
    const joint = (member: string) => ({ name: 'Joint Pot', member, currency: 'USD', class: 'bank', added: true })
    const a = await t.preview({ balance: 1, categories: [{ categoryId: t.food, amount: 1, currency: 'USD' }] }, joint('Annika'))
    const r = await t.preview({ balance: 2, categories: [{ categoryId: t.food, amount: 2, currency: 'USD' }] }, joint('Ryan'))
    await t.commit(a.draftId)
    await t.commit(r.draftId)
    expect(await t.rowOf('Joint Pot', 'Annika')).toMatchObject({ balance: 1, added: true })
    expect(await t.rowOf('Joint Pot', 'Ryan')).toMatchObject({ balance: 2, added: true })
    expect(t.lines()).toEqual([t.line(joint('Annika'), t.food, 1), t.line(joint('Ryan'), t.food, 2)])
  })

  it('a loan line committed from two accounts stays one line, the last write', async () => {
    const t = await setup()
    await t.commit((await t.preview({ loanPayments: [{ name: 'Car loan', amount: 111 }] })).draftId)
    const second = await t.h.result<Preview>('preview_statement', { month: t.month, account: ANNIKA, balance: 1, active: 0, passive: 0, expense: 0, loanPayments: [{ name: 'Car loan', amount: 222 }] })
    expect(second.was?.loanLines).toEqual([{ name: 'Car loan', amount: 111 }])
    await t.commit(second.draftId)
    const stored = JSON.parse(payloadOf(t.h)[0]) as { loans: { name: string; amount: number }[] }
    expect(stored.loans.filter(l => l.name === 'Car loan')).toEqual([{ name: 'Car loan', amount: 222 }])
  })

  it('a carried account is filled from last month on commit and keeps no lines', async () => {
    const t = await setup()
    t.h.db.sqlite.prepare(`INSERT INTO flow_lines (date, bank, member, category_id, amount) VALUES (?, ?, 'Annika', ?, 9)`).run(`${t.month}-01`, ANNIKA.name, t.food)
    const p = await t.h.result<Preview>('preview_statement', { month: t.month, account: { ...ANNIKA, carried: true } })
    await t.commit(p.draftId)
    expect(await t.rowOf(ANNIKA.name, 'Annika')).toMatchObject({ balance: 13880, active: 0, passive: 0, expense: 0 })
    expect(t.lines()).toEqual([])
  })

  it('with income and expenses not tracked the balance alone fills the row', async () => {
    const t = await setup()
    t.h.db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0')")
    const p = await t.preview({ active: undefined, passive: undefined, expense: undefined })
    const c = await t.commit(p.draftId)
    expect(c.filled).toEqual(['balance'])
    expect(await t.rowOf(RYAN.name, RYAN.member)).toMatchObject({ balance: 11000, active: null })
  })
})
