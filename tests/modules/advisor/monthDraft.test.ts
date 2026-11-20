import { getMonthCloseState, reopenMonth, saveDraft } from '../../../src/server/monthClose'
import { STATEMENT_SOURCE_PREFIX } from '../../../src/domain/statements'
import { closeMonthTool, getMonthDraft, monthView, type MonthView } from '../../../src/modules/advisor/tools/monthDraft'
import { toolInfo, type ToolContext } from '../../../src/modules/advisor/tools/registry'
import { advisorHarness } from './harness'

const NOW = new Date()

function contextOf(db: ReturnType<typeof advisorHarness>['db']): ToolContext {
  return {
    db, now: NOW, download: false, env: {}, authMode: 'password', signInLink: null,
    actor: { name: 'Test', source: 'mcp', rights: { edit: true, vote: true, manage: true }, userId: null },
  }
}
const view = async (db: ReturnType<typeof advisorHarness>['db']) => monthView(contextOf(db))
const insertSource = (db: ReturnType<typeof advisorHarness>['db'], month: string, source: string) =>
  db.sqlite.prepare(`INSERT INTO category_spending (date, category_id, source, amount, currency) VALUES (?, 1, ?, 10, 'EUR')`).run(`${month}-01`, source)

describe('get_month_draft', () => {
  it('is a read-only tool without a right', () => {
    expect(getMonthDraft.name).toBe('get_month_draft')
    expect(getMonthDraft.right).toBeNull()
    expect(getMonthDraft.writes).toBeUndefined()
  })

  it('shows the first open month with a stable 64-hex state hash', async () => {
    const { db } = advisorHarness()
    const state = await getMonthCloseState(db, NOW)
    const a = await view(db)
    const b = await view(db)
    expect(a.month).toBe(state.queue[0])
    expect(a.month).not.toBeNull()
    expect(a.stateHash).toMatch(/^[0-9a-f]{64}$/)
    expect(b.stateHash).toBe(a.stateHash)
    expect(a.flows).toBe(true)
    expect(a.accountClasses).toEqual(['bank', 'broker', 'crypto', 'other'])
  })

  it('the hash changes after a wizard draft save', async () => {
    const { db } = advisorHarness()
    const before = await view(db)
    const state = await getMonthCloseState(db, NOW)
    const rows = state.rows.map((r, i) => (i === 0 ? { ...r, balance: 12345.67 } : r))
    await saveDraft(db, before.month as string, { expectedRevision: (await getMonthCloseState(db, NOW)).draftRevision, rows, loans: [] }, NOW)
    expect((await view(db)).stateHash).not.toBe(before.stateHash)
  })

  it('the hash changes when a hand-typed spending source appears', async () => {
    const { db } = advisorHarness()
    const before = await view(db)
    insertSource(db, before.month as string, 'Hand card')
    const after = await view(db)
    expect(after.spendingSources.map(s => s.source)).toContain('Hand card')
    expect(after.stateHash).not.toBe(before.stateHash)
  })

  it('lists every free source as it is, a legacy statement one included, with no derived or orphaned flag', async () => {
    const { db } = advisorHarness()
    const { month } = await view(db)
    insertSource(db, month as string, `${STATEMENT_SOURCE_PREFIX}Gone — Nobody`)
    insertSource(db, month as string, 'Plain')
    const sources = (await view(db)).spendingSources
    expect(sources).toEqual([
      { source: 'Plain', categories: [{ categoryId: 1, amount: 10, currency: 'EUR' }] },
      { source: `${STATEMENT_SOURCE_PREFIX}Gone — Nobody`, categories: [{ categoryId: 1, amount: 10, currency: 'EUR' }] },
    ])
  })

  it('lists the accounts\' lines of the month, sorted, with what they allocate; lines without a draft row are orphaned; the hash follows them', async () => {
    const { db } = advisorHarness()
    const before = await view(db)
    expect(before.accountLines).toEqual([])
    const [a, b] = [...before.rows].sort((x, y) => (x.name < y.name ? -1 : 1))
    const food = (db.sqlite.prepare(`SELECT id FROM spending_categories WHERE flow = 'expense' AND kind != 'loan_payment' ORDER BY id LIMIT 1`).get() as { id: number }).id
    const line = (bank: string, member: string, amount: number) =>
      db.sqlite.prepare('INSERT INTO flow_lines (date, bank, member, category_id, amount) VALUES (?, ?, ?, ?, ?)').run(`${before.month}-01`, bank, member, food, amount)
    line(b.name, b.member, 7)
    line(a.name, a.member, 5)
    line('Gone Bank', '', 3)
    const after = await view(db)
    expect(after.accountLines).toEqual([
      { bank: a.name, member: a.member, items: [{ categoryId: food, amount: 5 }], allocated: { active: 0, passive: 0, expense: 5 }, orphaned: false },
      { bank: b.name, member: b.member, items: [{ categoryId: food, amount: 7 }], allocated: { active: 0, passive: 0, expense: 7 }, orphaned: false },
      { bank: 'Gone Bank', member: '', items: [{ categoryId: food, amount: 3 }], allocated: { active: 0, passive: 0, expense: 3 }, orphaned: true },
    ].sort((x, y) => (x.bank < y.bank ? -1 : x.bank > y.bank ? 1 : 0)))
    expect(after.stateHash).not.toBe(before.stateHash)
    db.sqlite.prepare('UPDATE flow_lines SET amount = 6 WHERE bank = ?').run(a.name)
    expect((await view(db)).stateHash).not.toBe(after.stateHash)
  })

  it('has month null and a nextStep when every month is closed', async () => {
    const { db } = advisorHarness()
    const { queue } = await getMonthCloseState(db, NOW)
    for (const m of queue) db.sqlite.prepare(`INSERT INTO closed_months (month, closed_at, closed_by) VALUES (?, 't', 'test')`).run(m)
    const v = await getMonthDraft.run(await contextOf(db), {}) as MonthView & { nextStep: string }
    expect(v.month).toBeNull()
    expect(v.spendingSources).toEqual([])
    expect(v.accountLines).toEqual([])
    expect(v.nextStep).toMatch(/nothing/i)
  })

  it('has no spending sources while income and expenses are not tracked', async () => {
    const { db } = advisorHarness()
    db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0')")
    const v = await view(db)
    expect(v.flows).toBe(false)
    expect(v.loanPayments).toEqual([])
    expect(v.spendingSources).toEqual([])
  })
})

describe('close_month', () => {
  const ACTOR_NAME = 'family' // the password-mode actor of the harness
  type Harness = ReturnType<typeof advisorHarness>
  interface Closed { closed: string; queue: string[]; nextStep: string }
  const hashOf = async (h: Harness) => (await h.result<MonthView>('get_month_draft')).stateHash
  const closedCount = (h: Harness) => (h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM closed_months').get() as { n: number }).n
  /** Fills every account of the open month through the wizard's draft */
  async function fill(h: Harness, loans: { name: string; amount: number | null }[] = []) {
    const state = await getMonthCloseState(h.db, NOW)
    const rows = state.rows.map(r => ({ ...r, balance: 1000, active: 10, passive: 0, expense: 5 }))
    await saveDraft(h.db, state.queue[0], { expectedRevision: (await getMonthCloseState(h.db, NOW)).draftRevision, rows, loans }, NOW)
    return state.queue[0]
  }

  it('is a write tool that needs the edit right', () => {
    expect(closeMonthTool.name).toBe('close_month')
    expect(closeMonthTool.right).toBe('edit')
    expect(toolInfo(closeMonthTool).readOnly).toBe(false)
  })

  it.each(['source', 'category'])('revalidates approval if a %s changes after the hash check, before commit', async kind => {
    const h = advisorHarness()
    const month = await fill(h)
    const seen = await hashOf(h)
    const before = closedCount(h)
    const snapshot = () => Object.fromEntries(['month_drafts', 'month_draft_revisions', 'assets', 'monthly_cashflow', 'loan_payments', 'change_log'].map(table => [table, h.db.sqlite.prepare(`SELECT * FROM ${table}`).all()]))
    const initial = snapshot()
    const batch = h.db.guardedBatch.bind(h.db)
    const guard = vi.spyOn(h.db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
      if (kind === 'source') insertSource(h.db, month, 'Concurrent card')
      else {
        const state = await getMonthCloseState(h.db, NOW)
        const category = h.db.sqlite.prepare("SELECT id FROM spending_categories WHERE flow = 'expense' AND kind != 'loan_payment' LIMIT 1").get()!.id
        h.db.sqlite.prepare('INSERT INTO flow_lines VALUES (?, ?, ?, ?, 1)').run(`${month}-01`, state.rows[0].name, state.rows[0].member, category)
      }
      return batch(token, statements)
    })
    expect(await h.failure('close_month', { month, stateHash: seen })).toEqual([409, { error: { code: 'advisor.draft_stale' } }])
    expect(closedCount(h)).toBe(before)
    expect(snapshot()).toEqual(initial)
    guard.mockRestore()
  })

  it('close and reopen cannot revive the previous approval', async () => {
    const h = advisorHarness()
    const month = await fill(h)
    const stateHash = await hashOf(h)
    await h.result('close_month', { month, stateHash })
    await reopenMonth(h.db, month, (await contextOf(h.db)).actor, NOW)
    expect(await hashOf(h)).not.toBe(stateHash)
    const before = closedCount(h)
    expect(await h.failure('close_month', { month, stateHash })).toEqual([409, { error: { code: 'advisor.draft_stale' } }])
    expect(closedCount(h)).toBe(before)
  })

  it('a stale hash closes nothing', async () => {
    const h = advisorHarness()
    const month = await fill(h)
    const before = closedCount(h)
    const [status, body] = await h.failure('close_month', { month, stateHash: 'f'.repeat(64) })
    expect(status).toBe(409)
    expect(body).toEqual({ error: { code: 'advisor.draft_stale' } })
    expect(closedCount(h)).toBe(before)
  })

  it('the real hash of a complete month goes stale after one balance changes, and nothing is closed', async () => {
    const h = advisorHarness()
    const month = await fill(h)
    const seen = await hashOf(h)
    const before = closedCount(h)
    const state = await getMonthCloseState(h.db, NOW)
    const rows = state.rows.map((r, i) => (i === 0 ? { ...r, balance: r.balance! + 1 } : r))
    await saveDraft(h.db, month, { expectedRevision: (await getMonthCloseState(h.db, NOW)).draftRevision, rows, loans: [] }, NOW)
    const [status, body] = await h.failure('close_month', { month, stateHash: seen })
    expect([status, body]).toEqual([409, { error: { code: 'advisor.draft_stale' } }])
    expect(closedCount(h)).toBe(before)
    // the fresh hash closes it
    await h.result('close_month', { month, stateHash: await hashOf(h) })
  })

  it('the real hash goes stale after a hand-typed spending source appears, and nothing is closed', async () => {
    const h = advisorHarness()
    const month = await fill(h)
    const seen = await hashOf(h)
    const before = closedCount(h)
    insertSource(h.db, month, 'Hand card')
    const [status, body] = await h.failure('close_month', { month, stateHash: seen })
    expect([status, body]).toEqual([409, { error: { code: 'advisor.draft_stale' } }])
    expect(closedCount(h)).toBe(before)
  })

  it('the right hash closes a complete month under the actor\'s name, and the wizard can reopen it', async () => {
    const h = advisorHarness()
    const month = await fill(h)
    const queue = (await getMonthCloseState(h.db, NOW)).queue
    const res = await h.result<Closed>('close_month', { month, stateHash: await hashOf(h) })
    expect(res.closed).toBe(month)
    expect(res.queue).toEqual(queue.slice(1))
    expect(res.nextStep).toEqual(expect.any(String))
    const row = h.db.sqlite.prepare('SELECT closed_by FROM closed_months WHERE month = ?').get(month) as { closed_by: string }
    expect(row.closed_by).toBe(ACTOR_NAME)
    const actor = { name: row.closed_by, source: 'mcp', rights: { edit: true, vote: true, manage: true }, userId: null } as const
    const state = await reopenMonth(h.db, month, actor, NOW)
    expect(state.queue[0]).toBe(month)
  })

  it('an incomplete month is 422 month_has_problems with the right hash', async () => {
    const h = advisorHarness()
    const v = await h.result<MonthView>('get_month_draft')
    expect(v.problems.length).toBeGreaterThan(0)
    const before = closedCount(h)
    const [status, body] = await h.failure('close_month', { month: v.month, stateHash: v.stateHash })
    expect(status).toBe(422)
    expect((body as { error: { code: string } }).error.code).toBe('month_has_problems')
    expect(closedCount(h)).toBe(before)
  })

  it('closing again with the same hash is refused as out of order or a conflict, never save_failed', async () => {
    const h = advisorHarness()
    const month = await fill(h)
    const input = { month, stateHash: await hashOf(h) }
    await h.result('close_month', input)
    const [status, body] = await h.failure('close_month', input)
    expect([status, body]).toEqual([409, { error: { code: 'month_out_of_order' } }])
  })

  it('a month that is not the first open one is month_out_of_order', async () => {
    const h = advisorHarness()
    await fill(h)
    const [status, body] = await h.failure('close_month', { month: '2099-12', stateHash: await hashOf(h) })
    expect(status).toBe(409)
    expect((body as { error: { code: string } }).error.code).toBe('month_out_of_order')
  })

  it('needs month and stateHash', async () => {
    const h = advisorHarness()
    expect((await h.failure('close_month', { stateHash: 'x' }))[0]).toBe(400)
    expect((await h.failure('close_month', { month: '2020-01' }))[0]).toBe(400)
  })
})

describe('monthView and loans', () => {
  it('the hash changes when only a loan line changes', async () => {
    const { db } = advisorHarness()
    const state = await getMonthCloseState(db, NOW)
    expect(state.loanPayments.length).toBeGreaterThan(0)
    const month = state.queue[0]
    const save = async (amount: number) => {
      await saveDraft(db, month, { expectedRevision: (await getMonthCloseState(db, NOW)).draftRevision, rows: state.rows, loans: [{ name: state.loanPayments[0].name, amount }] }, NOW)
      return (await view(db)).stateHash
    }
    const a = await save(100)
    const b = await save(200)
    expect(b).not.toBe(a)
    expect(await save(100)).not.toBe(a) // a new save must not revive an old approval
  })
})
