import { buildFamily } from '../../src/demo/family'
import { advisorContext, type Scenario } from '../../src/domain/advisor'
import { evaluate, type Evaluation } from '../../src/domain/advisorImpact'
import { isoDate } from '../../src/domain/dates'
import type { SendInput } from '../../src/modules/advisor/council/store'
import { writeFamily } from '../../src/server/demo/writeFamily'
import { ensureRates } from '../../src/server/fx'
import type { Actor } from '../../src/server/http'
import { getSnapshot } from '../../src/server/snapshot'
import { createTestDb, type TestDb } from './db'
import { addUser } from './users'

/** The council's three voters and their Telegram ids (each one's private chat id is their Telegram id). */
export const COUNCIL_CHATS = { Ryan: '101', Annika: '102', Mila: '103' } as const
export type CouncilMember = keyof typeof COUNCIL_CHATS

/** A car on credit: the scenario the council's tests propose. */
export const CREDIT: Extract<Scenario, { kind: 'credit' }> = { kind: 'credit', amount: 30000, currency: 'USD', termMonths: 60, ratePct: 9, downPayment: 5000, loanType: 'consumer' }

/** A users row with its members row, as the Users page adds a new member: see addUser for the rights. */
export function addMember(db: TestDb, member: string, rights: Parameters<typeof addUser>[2] = {}): number {
  db.sqlite.prepare('INSERT INTO members (name) VALUES (?)').run(member)
  return addUser(db, member, rights)
}

/**
 * The demo family with the advisor on and a third member, Mila, who votes but does not edit; Ryan, Annika and Mila have
 * linked Telegram accounts (COUNCIL_CHATS). `ids` — their user ids; `actor(member, source)` — one of them signed in,
 * with every right but manage, which is Ryan's alone.
 */
export function councilFamily() {
  const db = createTestDb()
  writeFamily(db.sqlite, buildFamily({ today: isoDate(new Date()) }))
  addMember(db, 'Mila', { edit: false })
  for (const [member, chat] of Object.entries(COUNCIL_CHATS)) db.sqlite.prepare('UPDATE users SET telegram_id = ? WHERE member = ?').run(chat, member)
  const id = (member: CouncilMember) => (db.sqlite.prepare('SELECT id FROM users WHERE member = ?').get(member) as { id: number }).id
  const ids = { ryan: id('Ryan'), annika: id('Annika'), mila: id('Mila') }
  const actor = (member: CouncilMember, source: Actor['source'] = 'mcp'): Actor =>
    ({ name: member, source, rights: { edit: true, vote: true, manage: member === 'Ryan' }, userId: ids[member.toLowerCase() as keyof typeof ids] })
  return { db, ids, actor }
}

let credit: Evaluation | undefined

/** The demo family's evaluation of CREDIT today, computed once per test file: the council's store takes it as given. */
export async function creditEvaluation(db: TestDb): Promise<Evaluation> {
  if (!credit) {
    const today = new Date()
    const snapshot = await getSnapshot(db, { now: today, download: false })
    const fx = await ensureRates(db, [isoDate(today)], ['USD'], isoDate(today), null)
    credit = evaluate(advisorContext(snapshot, today), CREDIT, fx.lookup(isoDate(today)))
  }
  return credit
}

/** Ryan's proposal of CREDIT as the store takes it, with `evaluation` and a verdict of its risk; `overrides` replace fields. */
export const creditInput = (evaluation: Evaluation, overrides: Partial<SendInput> = {}): SendInput => ({
  scenario: CREDIT, baseCurrency: 'USD', evaluation, title: 'A car on credit', question: 'Shall we buy the car?',
  verdict: { risk: evaluation.impact.risk === 'unknown' ? 'risky' : evaluation.impact.risk, recommended: null, reason: 'A fair plan' },
  ...overrides,
})
