import { buildFamily } from '../../../src/demo/family'
import { advisorContext, parseScenario } from '../../../src/domain/advisor'
import { evaluate, type Evaluation } from '../../../src/domain/advisorImpact'
import { isoDate } from '../../../src/domain/dates'
import { ANSWER_RULES } from '../../../src/modules/advisor/guide'
import { ADVISOR_TOOLS } from '../../../src/modules/advisor/tools/registry'
import { createApp } from '../../../src/server/app'
import { writeFamily } from '../../../src/server/demo/writeFamily'
import { ensureRates } from '../../../src/server/fx'
import { getSnapshot } from '../../../src/server/snapshot'
import { createTestDb, testConfig } from '../../helpers/db'
import { authFor } from '../../helpers/auth'
import { FAMILY_PASSWORD, familyCookie, withCookie } from '../../helpers/session'

const HEADERS = { 'Content-Type': 'application/json' }
type Answer = { baseCurrency: string; evaluation: Evaluation }

function setup() {
  const db = createTestDb()
  writeFamily(db.sqlite, buildFamily({ today: isoDate(new Date()) }))
  const config = testConfig({ password: FAMILY_PASSWORD }, 'secret')
  const auth = authFor(config)
  const app = withCookie(createApp({ db, config, auth, ratesOnline: false }), () => familyCookie(auth))
  const call = (tool: string, body: unknown) =>
    app.request(`/api/advisor/tools/${tool}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
  return { db, call }
}

const CREDIT = { kind: 'credit', amount: 30000, currency: 'USD', termMonths: 60, ratePct: 9, downPayment: 5000, loanType: 'consumer' }
const inDays = (n: number) => isoDate(new Date(Date.now() + n * 86_400_000))

describe('answerRules', () => {
  // their descriptions saying to follow them is a wording lock: guide.test.ts
  it('evaluate_purchase, evaluate_goal and get_family_overview carry the answer rules at the top of their result', async () => {
    const { call } = setup()
    const answers = await Promise.all([
      call('evaluate_purchase', CREDIT),
      call('evaluate_goal', { name: 'Piano', amount: 6000, currency: 'USD', targetDate: inDays(1000) }),
      call('get_family_overview', {}),
    ])
    for (const res of answers) {
      expect(res.status).toBe(200)
      const { result } = await res.json() as { result: { answerRules: unknown } }
      expect(result.answerRules).toEqual(ANSWER_RULES)
    }
    // the other tools do not repeat them
    const { result } = await (await call('list_spending_categories', {})).json() as { result: Record<string, unknown> }
    expect(result).not.toHaveProperty('answerRules')
  })
})

describe('evaluate_purchase', () => {
  it('is listed as a read-only tool whose schema names the kinds', () => {
    for (const name of ['evaluate_purchase', 'evaluate_goal']) {
      const tool = ADVISOR_TOOLS.find(t => t.name === name)!
      expect(tool.right).toBeNull()
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
    }
    const purchase = ADVISOR_TOOLS.find(t => t.name === 'evaluate_purchase')!
    expect(purchase.inputSchema).toMatchObject({ required: ['kind', 'amount', 'currency'], properties: { kind: { enum: ['buy_now', 'credit', 'save_up'] } } })
    // what the descriptions say is locked in guide.test.ts
  })

  it('credit answers the payment, the after numbers, the risk and up to three alternatives', async () => {
    const { call } = setup()
    const res = await call('evaluate_purchase', CREDIT)
    expect(res.status).toBe(200)
    const { result } = await res.json() as { result: Answer }
    expect(result.baseCurrency).toBe('USD')
    const { impact, alternatives } = result.evaluation
    expect(impact.credit?.payment).toBeGreaterThan(0)
    expect(impact.credit?.principal).toBe(25000)
    expect(impact.after.leftForLiving).not.toBeNull()
    expect(impact.after.debtPaymentPct).toBeGreaterThan(impact.now.debtPaymentPct!)
    expect(['ok', 'caution', 'risky']).toContain(impact.risk)
    expect(alternatives.length).toBeLessThanOrEqual(3)
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/)
  })

  it('a credit without termMonths answers 400 missing_param { param: "termMonths" }', async () => {
    const body: Record<string, unknown> = { ...CREDIT }
    delete body.termMonths
    const res = await setup().call('evaluate_purchase', body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'missing_param', params: { param: 'termMonths' } } })
  })

  it('a credit without ratePct answers 400 missing_param { param: "ratePct" }', async () => {
    const body: Record<string, unknown> = { ...CREDIT }
    delete body.ratePct
    const res = await setup().call('evaluate_purchase', body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'missing_param', params: { param: 'ratePct' } } })
  })

  it('a credit term over 35 years (420 months) answers 400 invalid_param { param: "termMonths" }; the schema says so', async () => {
    const t = setup()
    const res = await t.call('evaluate_purchase', { ...CREDIT, termMonths: 421 })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'invalid_param', params: { param: 'termMonths' } } })
    expect((await t.call('evaluate_purchase', { ...CREDIT, termMonths: 420 })).status).toBe(200)
    expect(ADVISOR_TOOLS.find(x => x.name === 'evaluate_purchase')!.inputSchema).toMatchObject({ properties: { termMonths: { maximum: 420 } } })
  })

  it('an amount above 1e9 answers 400 invalid_param { param: "amount" }', async () => {
    const res = await setup().call('evaluate_purchase', { kind: 'buy_now', amount: 2e9, currency: 'USD' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'invalid_param', params: { param: 'amount' } } })
  })

  it.each([[{ kind: 'goal', amount: 100, currency: 'USD' }], [{ kind: 'loan', amount: 100, currency: 'USD' }], [{ amount: 100, currency: 'USD', kind: 7 }]])(
    'evaluate_purchase refuses a kind it does not weigh as invalid_param kind, whatever else is missing (%j)',
    async body => {
      const res = await setup().call('evaluate_purchase', body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: { code: 'invalid_param', params: { param: 'kind' } } })
    },
  )

  it('evaluate_purchase refuses the goal kind', async () => {
    const res = await setup().call('evaluate_purchase', { kind: 'goal', amount: 100, currency: 'USD', name: 'x', targetDate: inDays(400) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'invalid_param', params: { param: 'kind' } } })
  })

  it('a purchase in a currency without any stored rate answers 200 with the no_rate gap and risk unknown', async () => {
    const res = await setup().call('evaluate_purchase', { kind: 'buy_now', amount: 1_000_000, currency: 'JPY' })
    expect(res.status).toBe(200)
    const { result } = await res.json() as { result: Answer }
    expect(result.evaluation.impact.risk).toBe('unknown')
    expect(result.evaluation.impact.amountBase).toBeNull()
    expect(result.evaluation.impact.gaps.map(g => g.code)).toContain('no_rate')
    expect(result.evaluation.alternatives).toEqual([])
  })

  it('a save_up needs a month after this one', async () => {
    const res = await setup().call('evaluate_purchase', { kind: 'save_up', amount: 5000, currency: 'USD', targetMonth: '2020-01' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'invalid_param', params: { param: 'targetMonth' } } })
  })
})

describe('evaluate_goal', () => {
  it('adds the goal and reports the goals that move', async () => {
    const { call } = setup()
    const res = await call('evaluate_goal', { name: 'Kitchen', amount: 40000, currency: 'USD', targetDate: inDays(400) })
    expect(res.status).toBe(200)
    const { result } = await res.json() as { result: Answer }
    expect(result.baseCurrency).toBe('USD')
    expect(result.evaluation.impact.scenario).toMatchObject({ kind: 'goal', name: 'Kitchen' })
    const proposed = result.evaluation.impact.goals.find(g => g.goalId === 'proposed')
    expect(proposed).toMatchObject({ name: 'Kitchen', statusBefore: null })
  })

  it('a missing name answers 400 missing_param', async () => {
    const res = await setup().call('evaluate_goal', { amount: 40000, currency: 'USD', targetDate: inDays(400) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'missing_param', params: { param: 'name' } } })
  })

  it('a date in the past answers 400 invalid_param { param: "targetDate" }', async () => {
    const res = await setup().call('evaluate_goal', { name: 'Kitchen', amount: 40000, currency: 'USD', targetDate: inDays(-30) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'invalid_param', params: { param: 'targetDate' } } })
  })

  it('cannot be turned into another kind by an extra "kind" field', async () => {
    const { call } = setup()
    const res = await call('evaluate_goal', { kind: 'buy_now', name: 'Kitchen', amount: 40000, currency: 'USD', targetDate: inDays(400) })
    const { result } = await res.json() as { result: Answer }
    expect(result.evaluation.impact.scenario.kind).toBe('goal')
  })
})

describe('the answer is the domain evaluation', () => {
  it('equals evaluate(advisorContext(snapshot), scenario, rates), nothing taken from elsewhere', async () => {
    const { db, call } = setup()
    const now = new Date()
    const snapshot = await getSnapshot(db, { now, download: false })
    const rates = (await ensureRates(db, [isoDate(now)], [snapshot.baseCurrency, 'USD'], isoDate(now), null)).lookup(isoDate(now))
    const expected = evaluate(advisorContext(snapshot, now), parseScenario(CREDIT, now), rates)

    const { result } = await (await call('evaluate_purchase', CREDIT)).json() as { result: Answer }
    expect(result.baseCurrency).toBe(snapshot.baseCurrency)
    expect(result.evaluation).toEqual(JSON.parse(JSON.stringify(expected)))
  })
})
