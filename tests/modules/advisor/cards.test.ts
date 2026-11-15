import type { Scenario } from '../../../src/domain/advisor'
import { describe, expect, it } from 'vitest'
import type { Alternative, Evaluation, GoalShift, Impact } from '../../../src/domain/advisorImpact'
import type { ProposalVersionView, ProposalView, ProposalVoteView } from '../../../src/domain/api'
import type { Language } from '../../../src/i18n/languages'
import {
  parseCallback, renderHash, renderMessage, voteData, withdrawData, type CardContext, type MessageRow,
} from '../../../src/modules/advisor/council/cards'
import type { InlineButton } from '../../../src/server/bot/telegram'
import { familyT } from '../../../src/server/bot/texts'
import { createTestDb } from '../../helpers/db'
import { ru } from '../../helpers/i18n'
import { CREDIT, numbers, impactOf as sharedImpact, R7_EVALUATION, R7_PROPOSED, R7_SCENARIO, R7_VERDICT } from './proposalViews'

// A credit proposal by Ryan with two other voters, Annika and Mila; the numbers are fixed by hand in the shape of the
// demo family's evaluation, so the expected texts can be written out.
const RYAN = 1
const ANNIKA = 2
const MILA = 3
const PROPOSAL = 3
const V1 = 7
const V2 = 8
const APP = 'https://fc.example'
const NOW = new Date('2026-11-02T09:00:00.000Z')

const impactOf = (overrides: Partial<Impact> = {}): Impact => sharedImpact({
  goals: [{ goalId: 'g1', name: 'Vacation', before: '2027-03', after: '2027-06', shiftMonths: 3, statusBefore: 'on_track', statusAfter: 'at_risk' }],
  ...overrides,
})

const SMALLER: Alternative = {
  kind: 'smaller', scenario: { ...CREDIT, amount: 24000 },
  impact: impactOf({ after: numbers({ debtPaymentPct: 18.2, emergencyMonths: 5.3 }) }),
}
const SAVE_UP: Alternative = {
  kind: 'save_up', scenario: { kind: 'save_up', amount: 30000, currency: 'USD', targetMonth: '2029-09' },
  impact: impactOf({ credit: null, after: numbers({ debtPaymentPct: 12.34, emergencyMonths: 6.2 }), goals: [
    { goalId: 'proposed', name: '', before: null, after: '2029-09', shiftMonths: null, statusBefore: null, statusAfter: 'on_track', requiredMonthly: 882.35,
      firstShare: { month: '2026-12', perMonth: 882.35 } },
  ] }),
}
const EVALUATION: Evaluation = { impact: impactOf(), alternatives: [SMALLER, SAVE_UP] }

type Vote = Pick<ProposalVoteView, 'vote' | 'settled'> & { comment?: string | null }
const votes = (annika: Vote | null, mila: Vote | null): ProposalVoteView[] => [
  { userId: RYAN, member: 'Ryan', vote: 'agree', settled: true, comment: null, votedAt: NOW.toISOString() },
  { userId: ANNIKA, member: 'Annika', vote: annika?.vote ?? null, settled: annika?.settled ?? false, comment: annika?.comment ?? null, votedAt: annika ? NOW.toISOString() : null },
  { userId: MILA, member: 'Mila', vote: mila?.vote ?? null, settled: mila?.settled ?? false, comment: mila?.comment ?? null, votedAt: mila ? NOW.toISOString() : null },
]

function versionOf(overrides: Partial<ProposalVersionView> = {}): ProposalVersionView {
  return {
    id: V1, number: 1, title: 'A car on credit', question: 'Shall we buy the car?', scenario: CREDIT, evaluation: EVALUATION, baseCurrency: 'USD',
    verdict: { risk: 'caution', recommended: 'smaller', reason: 'The payment fits, but the fund gets thin' },
    createdAt: NOW.toISOString(), votes: votes(null, null), changes: { scenario: [], numbers: [] },
    ...overrides,
  }
}

function viewOf(overrides: Partial<ProposalView> = {}): ProposalView {
  return {
    id: PROPOSAL, type: 'credit', status: 'open', author: { userId: RYAN, member: 'Ryan' },
    createdAt: NOW.toISOString(), deadlineAt: '2026-11-16T09:00:00.000Z', decidedAt: null, baseCurrency: 'USD', goal: null,
    current: versionOf(), previous: [],
    you: { voter: false, vote: null, settled: false, author: false },
    ...overrides,
  }
}

const card = (userId: number, versionId = V1): MessageRow => ({ kind: 'card', notice: '', version_id: versionId, user_id: userId })
const status = (versionId = V1): MessageRow => ({ kind: 'status', notice: '', version_id: versionId, user_id: RYAN })
const notice = (name: string, userId: number, versionId = V1): MessageRow => ({ kind: 'notice', notice: name, version_id: versionId, user_id: userId })

async function contextIn(lang: Language, appUrl: string | null = APP): Promise<CardContext> {
  const db = createTestDb()
  db.sqlite.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('language', ?)").run(lang)
  const { t } = await familyT(db)
  return { t, lang, appUrl, now: NOW }
}

const DETAILS = [{ text: 'Details on the site', url: `${APP}/advisor#proposal-${PROPOSAL}` }]
/** A row's message; every row of these tests has one */
const render = (row: MessageRow, view: ProposalView, ctx: CardContext) => {
  const rendered = renderMessage(row, view, ctx)
  if (!rendered) throw new Error('no message')
  return rendered
}
const datas = (buttons: InlineButton[][]) => buttons.flat().map(b => ('data' in b ? b.data : b.url))

describe('the proposal card', () => {
  it('an open card has the title, the question, five number lines in the family currency, the assessment, the votes line and three buttons', async () => {
    const ctx = await contextIn('en-US')
    const { text, buttons } = render(card(ANNIKA), viewOf(), ctx)
    expect(text).toBe([
      'Ryan proposes: A car on credit',
      '',
      'Shall we buy the car?',
      '',
      'Monthly payment: $519',
      'Loan payments of income: 12.3% → 21.5% (norm under 30%)',
      'Left for living after mandatory spending and loans: $2,401 → $1,882 a month',
      'Emergency fund: 6.2 → 5.0 months',
      'Goals that move: Vacation +3 mo',
      '',
      'Claude’s assessment: moderate risk. The payment fits, but the fund gets thin',
      'Suggests: borrow less, $24,000 (loan payments 18.2% of income, emergency fund 5.3 months)',
      '',
      'Ryan ✓ · Annika ⏳ · Mila ⏳ · decide by November 16',
    ].join('\n'))
    expect(buttons).toEqual([
      [{ text: 'Agree', data: `v:${V1}:a` }, { text: 'Against', data: `v:${V1}:n` }],
      DETAILS,
    ])
  })

  it('the assessment carries the risk in words and the reason, and the recommended alternative with its numbers', async () => {
    const ctx = await contextIn('en-US')
    const lines = (verdict: ProposalVersionView['verdict']) =>
      render(card(ANNIKA), viewOf({ current: versionOf({ verdict }) }), ctx).text.split('\n')
    const reason = 'Saving first keeps the fund whole'

    expect(lines({ risk: 'risky', recommended: 'save_up', reason })).toEqual(expect.arrayContaining([
      `Claude’s assessment: high risk. ${reason}`,
      // a saving: its month and what it needs a month, not the payment share and the fund it leaves as they are
      'Suggests: save up by September 2029 ($882 a month)',
    ]))
    // an earlier date for a goal, in words with its month and what it needs a month
    const earlier: Alternative = {
      kind: 'earlier_date', scenario: { kind: 'goal', name: 'Boat', amount: 60000, currency: 'USD', targetDate: '2040-11-30' },
      impact: impactOf({ credit: null, after: numbers({ debtPaymentPct: 12.34, emergencyMonths: 6.2 }), goals: [
        { goalId: 'proposed', name: 'Boat', before: null, after: '2040-10', shiftMonths: null, statusBefore: null, statusAfter: 'on_track', requiredMonthly: 356.12,
          firstShare: { month: '2026-12', perMonth: 356.12 } },
      ] }),
    }
    const dated = render(card(ANNIKA), viewOf({ current: versionOf({ evaluation: { ...EVALUATION, alternatives: [earlier] }, verdict: { risk: 'caution', recommended: 'earlier_date', reason } }) }), ctx)
    expect(dated.text).toContain('Suggests: an earlier date, November 2040 ($356 a month)')
    // a dated alternative the goals did not weigh (the module off): its numbers that change, none here
    const unweighed = { ...earlier, impact: { ...earlier.impact, goals: [] } }
    expect(render(card(ANNIKA), viewOf({ current: versionOf({ evaluation: { ...EVALUATION, alternatives: [unweighed] }, verdict: { risk: 'caution', recommended: 'earlier_date', reason } }) }), ctx).text)
      .toContain('Suggests: an earlier date, November 2040\n')
    const plain = lines({ risk: 'ok', recommended: null, reason })
    expect(plain).toContain(`Claude’s assessment: low risk. ${reason}`)
    expect(plain.some(l => l.startsWith('Suggests'))).toBe(false)
    // null numbers are a dash, never a zero; a goal that falls out of reach is named; no goals moving is said
    const unknown = render(card(ANNIKA), viewOf({ current: versionOf({ evaluation: { impact: impactOf({
      after: numbers({ debtPaymentPct: null, leftForLiving: null }),
      goals: [
        { goalId: 'g2', name: 'House', before: '2030-01', after: null, shiftMonths: null, statusBefore: 'at_risk', statusAfter: 'unreachable' },
        { goalId: 'g3', name: 'Piano', before: null, after: '2029-09', shiftMonths: null, statusBefore: 'unreachable', statusAfter: 'on_track' },
      ],
    }), alternatives: [] } }) }), ctx).text.split('\n')
    expect(unknown).toEqual(expect.arrayContaining([
      'Loan payments of income: 12.3% → — (norm under 30%)',
      'Left for living after mandatory spending and loans: $2,401 → — a month',
      'Goals that move: House out of reach, Piano by September 2029',
    ]))
    // the month a goal is reached keeps its year, in both languages
    const goals = (lang: CardContext) => render(card(ANNIKA), viewOf({ current: versionOf({ evaluation: { impact: impactOf({ goals: [
      { goalId: 'g3', name: 'Piano', before: null, after: '2029-09', shiftMonths: null, statusBefore: 'unreachable', statusAfter: 'on_track' },
    ] }), alternatives: [] } }) }), lang).text
    expect(goals(ctx)).toContain('Goals that move: Piano by September 2029')
    const russian = goals(await contextIn('ru-RU'))
    // the bot's `{{month, year}}` formatter is the server's own (familyT), so the line is checked by its parts
    const piano = russian.split('\n').find(l => l.includes('Piano'))
    expect(piano).toContain(`${ru('dates.inMonth.9')} 2029`)
    expect(piano).not.toContain('2029-09')
    const still = render(card(ANNIKA), viewOf({ current: versionOf({ evaluation: { impact: impactOf({ goals: [] }), alternatives: [] } }) }), ctx)
    expect(still.text).toContain('No goal moves')
  })

  it('a provisional voter sees the comment prompt with No comment and Cancel vote; a settled agree sees Change vote; a settled against sees no buttons', async () => {
    const ctx = await contextIn('en-US')
    const provisional = render(card(ANNIKA), viewOf({ current: versionOf({ votes: votes({ vote: 'against', settled: false }, null) }) }), ctx)
    expect(provisional.text.split('\n').slice(0, 2)).toEqual([
      'Ryan proposes: A car on credit',
      'You answered Against. Add a comment for Ryan: write one message.',
    ])
    // a provisional vote is not counted yet
    expect(provisional.text).toContain('Ryan ✓ · Annika ⏳ · Mila ⏳')
    expect(provisional.buttons).toEqual([[{ text: 'No comment', data: `v:${V1}:k` }, { text: 'Cancel vote', data: `v:${V1}:c` }]])

    const agreed = render(card(ANNIKA), viewOf({ current: versionOf({ votes: votes({ vote: 'agree', settled: true }, null) }) }), ctx)
    expect(agreed.text).not.toContain('You answered')
    expect(agreed.text).toContain('Ryan ✓ · Annika ✓ · Mila ⏳')
    expect(agreed.buttons).toEqual([[{ text: 'Change vote to Against', data: `v:${V1}:n` }], DETAILS])

    // the other voter's card shows the same votes line with their own buttons
    expect(render(card(MILA), viewOf({ current: versionOf({ votes: votes({ vote: 'agree', settled: true }, null) }) }), ctx).buttons[0])
      .toEqual([{ text: 'Agree', data: `v:${V1}:a` }, { text: 'Against', data: `v:${V1}:n` }])

    const against = render(card(ANNIKA), viewOf({ current: versionOf({ votes: votes({ vote: 'against', settled: true }, null) }) }), ctx)
    expect(against.buttons).toEqual([])
    expect(against.text).toContain('Ryan ✓ · Annika ✗ · Mila ⏳')
  })

  it('a replaced version, a revising proposal and a final status render without buttons', async () => {
    const ctx = await contextIn('en-US')
    const frozen = versionOf({ votes: votes({ vote: 'against', settled: true, comment: 'Let us wait for the bonus' }, null) })

    const revising = render(card(MILA), viewOf({ status: 'revising', current: frozen }), ctx)
    expect(revising.buttons).toEqual([])
    expect(revising.text.split('\n').slice(-2)).toEqual(['Ryan ✓ · Annika ✗ · Mila ⏳', 'Back with Ryan for revision'])

    const v2 = versionOf({ id: V2, number: 2, votes: votes(null, null) })
    const replaced = render(card(MILA, V1), viewOf({ current: v2, previous: [frozen] }), ctx)
    expect(replaced).toEqual({ text: 'Ryan proposes: A car on credit\n\nReplaced by version 2', buttons: [] })

    const finals = { accepted: 'Decided ✓', withdrawn: 'Withdrawn by the author', expired: 'Expired with no decision' } as const
    for (const [final, line] of Object.entries(finals)) {
      const done = render(card(MILA), viewOf({ status: final as keyof typeof finals, decidedAt: NOW.toISOString() }), ctx)
      expect(done.buttons).toEqual([])
      expect(done.text.split('\n').slice(-2)).toEqual(['Ryan ✓ · Annika ⏳ · Mila ⏳', line])
    }
  })

  it('version 2 renders the was → now lines for the changed parameters and the numbers the block does not show', async () => {
    const ctx = await contextIn('en-US')
    const v2 = versionOf({
      id: V2, number: 2, question: 'And with a longer term?', scenario: { ...CREDIT, termMonths: 72, downPayment: 8000 },
      changes: {
        scenario: [{ field: 'termMonths', before: 60, after: 72 }, { field: 'downPayment', before: 5000, after: 8000 }],
        numbers: [
          { key: 'payment', before: 518.96, after: 401.2 }, { key: 'debtPaymentPct', before: 21.5, after: 19.04 },
          { key: 'emergencyMonths', before: 5.04, after: null }, { key: 'savingsPerMonth', before: 381, after: 460.4 },
        ],
      },
    })
    // version 1 was computed in another base currency: its numbers keep it
    const v1 = versionOf({ baseCurrency: 'EUR' })
    const { text, buttons } = render(card(ANNIKA, V2), viewOf({ current: v2, previous: [v1] }), ctx)
    expect(text.split('\n').slice(0, 10)).toEqual([
      'Ryan updated the proposal (version 2): A car on credit',
      '',
      'And with a longer term?',
      '',
      'Compared with version 1:',
      'Term: 60 mo → 72 mo',
      'Down payment: $5,000 → $8,000',
      'Savings a month: €381 → $460',
      '',
      'Monthly payment: $519',
    ])
    expect(datas(buttons)).toEqual([`v:${V2}:a`, `v:${V2}:n`, DETAILS[0].url])
    // only numbers the block shows changed: no heading, no was-lines
    const quiet = versionOf({ id: V2, number: 2, changes: { scenario: [], numbers: [{ key: 'payment', before: 518.96, after: 401.2 }] } })
    expect(render(card(ANNIKA, V2), viewOf({ current: quiet, previous: [v1] }), ctx).text).not.toContain('Compared with')
  })

  it('an old version renders in its own base currency', async () => {
    const ctx = await contextIn('en-US')
    // the family switched to USD after version 1 in EUR was sent: version 1 still reads in EUR
    const v1 = versionOf({ baseCurrency: 'EUR' })
    const text = render(card(ANNIKA), viewOf({ baseCurrency: 'USD', current: v1 }), ctx).text
    expect(text).toContain('Monthly payment: €519')
    expect(text).not.toContain('$519')
  })

  it('the same state renders the same text and hash in both languages after a language switch', async () => {
    const en = await contextIn('en-US')
    const ruCtx = await contextIn('ru-RU')
    const view = viewOf()
    const first = render(card(ANNIKA), view, en)
    const russian = render(card(ANNIKA), view, ruCtx)
    const back = render(card(ANNIKA), view, en)

    expect(russian.text).not.toBe(first.text)
    expect(russian.text.split('\n')[0]).toBe(ru('modules.advisor.bot.card.title', { author: 'Ryan', title: 'A car on credit' }))
    expect(russian.text).toContain(ru('modules.advisor.bot.numbers.payment', { amount: new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(519) }))
    expect(russian.buttons[0].map(b => b.text)).toEqual([ru('modules.advisor.bot.button.agree'), ru('modules.advisor.bot.button.against')])
    expect(back).toEqual(first)
    expect(renderHash(back.text, back.buttons)).toBe(renderHash(first.text, first.buttons))
    expect(renderHash(russian.text, russian.buttons)).not.toBe(renderHash(first.text, first.buttons))
    expect(render(card(ANNIKA), view, ruCtx)).toEqual(russian)
    expect(renderHash(first.text, first.buttons)).toMatch(/^[0-9a-f]{64}$/)
    // the buttons are part of the hash
    expect(renderHash(first.text, [])).not.toBe(renderHash(first.text, first.buttons))
  })

  it('the fund months keep one decimal, whole ones too: "5,0 → 4,7" in Russian', async () => {
    const view = viewOf({ current: versionOf({ evaluation: { ...EVALUATION, impact: impactOf({ now: numbers({ emergencyMonths: 5 }), after: numbers({ emergencyMonths: 4.7 }) }) } }) })
    expect(render(card(ANNIKA), view, await contextIn('ru-RU')).text).toContain(ru('modules.advisor.bot.numbers.fund', { now: '5,0', after: '4,7' }))
    expect(render(card(ANNIKA), view, await contextIn('en-US')).text).toContain('Emergency fund: 5.0 → 4.7 months')
  })

  it('callback data is at most 64 bytes for an id of 2^53 and parses back; url buttons are left out without APP_URL', async () => {
    const big = 2 ** 53
    for (const [x, action] of [['a', 'agree'], ['n', 'against'], ['k', 'keep'], ['c', 'cancel']] as const) {
      const data = voteData(big, x)
      expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64)
      expect(parseCallback(data)).toEqual({ kind: 'vote', versionId: big, action })
    }
    expect(Buffer.byteLength(withdrawData(big), 'utf8')).toBeLessThanOrEqual(64)
    expect(parseCallback(withdrawData(big))).toEqual({ kind: 'withdraw', proposalId: big })
    expect(parseCallback(voteData(V1, 'a'))).toEqual({ kind: 'vote', versionId: V1, action: 'agree' })
    for (const bad of ['', 'v:1', 'v:1:x', 'v::a', 'v:01:a', 'v:-1:a', 'v:0:a', 'w:', 'w:1:a', 'w:1.5', 'login:abc', `v:${'9'.repeat(17)}:a`, 'v:99999999999999999:a']) {
      expect(parseCallback(bad)).toBeNull()
    }

    const ctx = await contextIn('en-US', null)
    expect(render(card(ANNIKA), viewOf(), ctx).buttons).toEqual([[{ text: 'Agree', data: `v:${V1}:a` }, { text: 'Against', data: `v:${V1}:n` }]])
    expect(render(status(), viewOf(), ctx).buttons).toEqual([[{ text: 'Withdraw', data: `w:${PROPOSAL}` }]])
    // a trailing slash in APP_URL is not doubled
    expect(datas(render(card(ANNIKA), viewOf(), await contextIn('en-US', `${APP}/`)).buttons)).toContain(DETAILS[0].url)
  })
})

describe('a goal proposal on the card', () => {
  const GOAL_VIEW = (evaluation: Evaluation, verdict: ProposalVersionView['verdict'] = R7_VERDICT, scenario: Scenario = R7_SCENARIO) => viewOf({
    type: 'goal',
    current: versionOf({ title: 'New goal: save for a renovation', question: 'Shall we start a renovation goal?', scenario, evaluation, verdict }),
  })
  const withProposed = (shift: Partial<GoalShift>, scenario: Scenario = R7_SCENARIO): Evaluation => ({
    impact: { ...R7_EVALUATION.impact, scenario, goals: [{ ...R7_PROPOSED, ...shift }] }, alternatives: [],
  })
  const plain = { risk: 'ok', recommended: null, reason: 'It fits' } as const

  it('R7: the late goal with its month, when the money starts and how much a month then; no unchanged lines; the later date likewise', async () => {
    const { text } = render(card(ANNIKA), GOAL_VIEW(R7_EVALUATION), await contextIn('en-US'))
    expect(text).toBe([
      'Ryan proposes: New goal: save for a renovation',
      '',
      'Shall we start a renovation goal?',
      '',
      'Renovation: by January 2029 instead of December 2027; the money goes to it from April 2028, $2,138 a month',
      'Goals that move: Financial independence (FIRE) by 55 +10 mo',
      '',
      'Claude’s assessment: moderate risk. The renovation comes later than asked',
      'Suggests: a later date, January 2029 (the money goes to it from April 2028, $2,013 a month)',
      '',
      'Ryan ✓ · Annika ⏳ · Mila ⏳ · decide by November 16',
    ].join('\n'))
  })

  it('R7 in Russian: the same lines in the family language', async () => {
    const { text } = render(card(ANNIKA), GOAL_VIEW(R7_EVALUATION), await contextIn('ru-RU'))
    const money = (v: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
    const goal = ru('modules.advisor.bot.goal.late', {
      name: 'Renovation', by: `${ru('modules.advisor.bot.value.byMonth.1')} 2029`, asked: `${ru('dates.monthOf.12')} 2027`,
    })
    const lines = text.split('\n')
    expect(lines).toContain(ru('modules.advisor.bot.goal.from', { text: goal, from: `${ru('dates.monthOf.4')} 2028`, amount: money(2138) }))
    expect(lines).toContain(ru('modules.advisor.bot.card.recommends', {
      alternative: ru('modules.advisor.bot.alternative.withNumbers', {
        alternative: ru('modules.advisor.bot.alternative.later_date', { month: `${ru('dates.month.1')} 2029` }),
        numbers: ru('modules.advisor.bot.alternative.from', { from: `${ru('dates.monthOf.4')} 2028`, amount: money(2013) }),
      }),
    }))
    // one dash between the alternative and its figures, not a second colon
    const recommends = ru('modules.advisor.bot.card.recommends', { alternative: '' })
    expect(lines.find(l => l.startsWith(recommends))?.split(':')).toHaveLength(2)
    for (const key of ['debtShare', 'left', 'fund']) {
      const head = ru(`modules.advisor.bot.numbers.${key}`, { now: '', after: '', norm: '' }).split(':')[0]
      expect(lines.some(l => l.startsWith(head)), key).toBe(false)
    }
  })

  it('every alternative with its figures reads with one colon: one dash in Russian, its figures in brackets in English (no spaced dash)', async () => {
    const goalAt = (after: string) => ({ goalId: 'proposed', name: '', before: null, after, shiftMonths: null, statusBefore: null, statusAfter: 'on_track' as const,
      requiredMonthly: 900, takenAhead: { perMonth: 800, untilMonth: '2027-05' }, firstShare: { month: '2027-05', perMonth: 1337.74 } })
    const dated = (scenario: Scenario, after: string) => impactOf({ scenario, credit: null, after: numbers({}), goals: [goalAt(after)] })
    const alternatives: Alternative[] = [
      SMALLER,
      { kind: 'longer_term', scenario: { ...CREDIT, termMonths: 72 }, impact: impactOf({ after: numbers({ debtPaymentPct: 19.04, emergencyMonths: 5.04 }) }) },
      { kind: 'bigger_down_payment', scenario: { ...CREDIT, downPayment: 8000 }, impact: impactOf({ after: numbers({ debtPaymentPct: 17.1, emergencyMonths: 4.6 }) }) },
      { kind: 'save_up', scenario: { kind: 'save_up', amount: 30000, currency: 'USD', targetMonth: '2029-08' }, impact: dated({ kind: 'save_up', amount: 30000, currency: 'USD', targetMonth: '2029-08' }, '2029-08') },
      { kind: 'later_date', scenario: { ...R7_SCENARIO, targetDate: '2029-01-31' }, impact: dated({ ...R7_SCENARIO, targetDate: '2029-01-31' }, '2029-01') },
      { kind: 'earlier_date', scenario: { ...R7_SCENARIO, targetDate: '2027-06-30' }, impact: dated({ ...R7_SCENARIO, targetDate: '2027-06-30' }, '2027-06') },
    ]
    for (const lang of ['en-US', 'ru-RU'] as const) {
      const ctx = await contextIn(lang)
      const head = (lang === 'ru-RU' ? ru : (k: string, p?: Record<string, unknown>) => ctx.t(k, p))('modules.advisor.bot.card.recommends', { alternative: '' })
      for (const a of alternatives) {
        const view = viewOf({ current: versionOf({ evaluation: { ...EVALUATION, alternatives: [a] }, verdict: { risk: 'caution', recommended: a.kind, reason: 'Why' } }) })
        const line = render(card(ANNIKA), view, ctx).text.split('\n').find(l => l.startsWith(head))
        expect(line?.split(':'), `${lang} ${a.kind}: ${line}`).toHaveLength(2)
        expect(line?.split('—'), `${lang} ${a.kind}: ${line}`).toHaveLength(lang === 'ru-RU' ? 2 : 1)
        if (lang === 'en-US') expect(line, a.kind).toMatch(/ \([^()]+\)$/)
      }
    }
    // a saving by its month, as a date is: "save up by August 2029"
    const ruCtx = await contextIn('ru-RU')
    const saving = viewOf({ current: versionOf({ evaluation: { ...EVALUATION, alternatives: [alternatives[3]] }, verdict: { risk: 'caution', recommended: 'save_up', reason: 'Why' } }) })
    expect(render(card(ANNIKA), saving, ruCtx).text).toContain(ru('modules.advisor.bot.alternative.save_up', { by: `${ru('modules.advisor.bot.value.byMonth.8')} 2029` }))
  })

  it('an on-track goal: its date and what the plan pays into it a month, from the month it starts when nearer goals come first', async () => {
    const ctx = await contextIn('en-US')
    const line = (shift: Partial<GoalShift>) => render(card(ANNIKA), GOAL_VIEW(withProposed(shift), plain), ctx).text.split('\n')[4]
    // nothing ahead of it: the money goes to it at once
    expect(line({ after: '2027-10', statusAfter: 'on_track', takenAhead: undefined, firstShare: { month: '2026-12', perMonth: 1428.57 } }))
      .toBe('Renovation: by December 2027, $1,429 a month')
    expect(line({ after: '2027-12', statusAfter: 'on_track', takenAhead: { perMonth: 300, untilMonth: '2027-02' }, firstShare: { month: '2027-02', perMonth: 1650.2 } }))
      .toBe('Renovation: by December 2027; the money goes to it from February 2027, $1,650 a month')
    // requiredMonthly, the even spread from now, is never printed
    expect(line({ statusAfter: 'on_track', takenAhead: undefined, firstShare: { month: '2026-12', perMonth: 1500 } })).not.toContain('1,429')
  })

  it('an evaluation stored before firstShare: the goal and its months only, no amount and no dash', async () => {
    const ctx = await contextIn('en-US')
    const old = (shift: Partial<GoalShift>) => {
      const stored: GoalShift = { ...R7_PROPOSED, ...shift }
      delete stored.firstShare
      const evaluation: Evaluation = { impact: { ...R7_EVALUATION.impact, goals: [stored] }, alternatives: [] }
      return render(card(ANNIKA), GOAL_VIEW(evaluation, plain), ctx).text.split('\n')[4]
    }
    expect(old({})).toBe('Renovation: by January 2029 instead of December 2027')
    expect(old({ statusAfter: 'on_track', takenAhead: undefined, requiredMonthly: undefined })).toBe('Renovation: by December 2027')
    // the alternative likewise: its month only
    const later = { ...R7_EVALUATION.alternatives[0], impact: { ...R7_EVALUATION.alternatives[0].impact, goals: [{ ...R7_PROPOSED, firstShare: undefined }] } }
    const { text } = render(card(ANNIKA), GOAL_VIEW({ ...R7_EVALUATION, alternatives: [later] }), ctx)
    expect(text).toContain('Suggests: a later date, January 2029\n')
  })

  it('an unreachable goal says so, without a month or an amount', async () => {
    const ctx = await contextIn('en-US')
    const { text } = render(card(ANNIKA), GOAL_VIEW(withProposed({ after: null, statusAfter: 'unreachable' }), plain), ctx)
    expect(text.split('\n')[4]).toBe('Renovation: not reachable with today’s savings')
  })

  it('a saving names the purchase, by its month', async () => {
    const ctx = await contextIn('en-US')
    const saving: Scenario = { kind: 'save_up', amount: 6000, currency: 'USD', targetMonth: '2027-09' }
    const evaluation = withProposed({ name: '', after: '2027-08', statusAfter: 'on_track', requiredMonthly: 545.45, takenAhead: undefined, firstShare: { month: '2026-12', perMonth: 545.45 } }, saving)
    const { text } = render(card(ANNIKA), GOAL_VIEW(evaluation, plain, saving), ctx)
    expect(text.split('\n')[4]).toBe('The purchase: by September 2027, $545 a month')
  })

  it('a number line equal before and after as the card writes it is left out; the others stay', async () => {
    const ctx = await contextIn('en-US')
    const impact = impactOf({ after: numbers({ leftForLiving: 2400.9, debtPaymentPct: 12.31, emergencyMonths: 5.04 }) })
    const lines = render(card(ANNIKA), viewOf({ current: versionOf({ evaluation: { impact, alternatives: [] } }) }), ctx).text.split('\n')
    expect(lines.filter(l => /Loan payments|Left for living|Emergency fund/.test(l))).toEqual(['Emergency fund: 6.2 → 5.0 months'])
    // a was-line too: a payment that reads the same is not a change
    const v2 = versionOf({ id: V2, number: 2, changes: { scenario: [{ field: 'termMonths', before: 60, after: 72 }], numbers: [{ key: 'savingsPerMonth', before: 381.2, after: 380.9 }] } })
    const was = render(card(ANNIKA, V2), viewOf({ current: v2, previous: [versionOf()] }), ctx).text
    expect(was).toContain('Term: 60 mo → 72 mo')
    expect(was).not.toContain('Savings a month')
    // the same amount in another currency is a change; null equals only null
    const moved = versionOf({ id: V2, number: 2, changes: { scenario: [], numbers: [{ key: 'savingsPerMonth', before: 381, after: 381 }] } })
    expect(render(card(ANNIKA, V2), viewOf({ current: moved, previous: [versionOf({ baseCurrency: 'EUR' })] }), ctx).text).toContain('Savings a month: €381 → $381')
    const unknown = render(card(ANNIKA), viewOf({ current: versionOf({ evaluation: { impact: impactOf({
      now: numbers({ leftForLiving: null }), after: numbers({ leftForLiving: null, debtPaymentPct: null }),
    }), alternatives: [] } }) }), ctx).text
    expect(unknown).not.toContain('Left for living')
    // a goal switched to another one prints "yes" on both sides: no change; set or cleared is one
    const goalChange = (before: string | null, after: string | null) => render(card(ANNIKA, V2), viewOf({
      current: versionOf({ id: V2, number: 2, changes: { scenario: [{ field: 'goalId', before, after }], numbers: [] } }), previous: [versionOf()],
    }), ctx).text
    expect(goalChange('car', 'trip')).not.toContain('Compared with')
    expect(goalChange(null, 'trip')).toContain('Money from a goal: — → yes')
    expect(unknown).toContain('Loan payments of income: 12.3% → — (norm under 30%)')
  })
})

describe('the author’s status message and the notices', () => {
  it('the status message lists the voters, the votes line and Withdraw; revising quotes the against; final has no buttons', async () => {
    const ctx = await contextIn('en-US')
    const open = render(status(), viewOf({ current: versionOf({ votes: votes({ vote: 'agree', settled: true }, null) }) }), ctx)
    expect(open).toEqual({
      text: 'Your proposal: A car on credit, sent to Annika, Mila, decide by November 16\n\nRyan ✓ · Annika ✓ · Mila ⏳',
      buttons: [[{ text: 'Withdraw', data: `w:${PROPOSAL}` }], DETAILS],
    })

    const frozen = versionOf({ votes: votes({ vote: 'against', settled: true, comment: 'Let us wait for the bonus' }, null) })
    const revising = render(status(), viewOf({ status: 'revising', current: frozen }), ctx)
    expect(revising).toEqual({
      text: [
        'Your proposal: A car on credit',
        '',
        'Ryan ✓ · Annika ✗ · Mila ⏳',
        '',
        'Annika is against: “Let us wait for the bonus”',
        'The proposal is back with you. To recalculate, tell Claude: “revise the proposal about A car on credit”; it will see the comment.',
      ].join('\n'),
      buttons: [[{ text: 'Withdraw', data: `w:${PROPOSAL}` }]],
    })

    const accepted = render(status(), viewOf({ status: 'accepted', decidedAt: NOW.toISOString() }), ctx)
    expect(accepted.buttons).toEqual([])
    expect(accepted.text.split('\n')[0]).toBe('Your proposal “A car on credit” is accepted')

    const v2 = versionOf({ id: V2, number: 2 })
    expect(render(status(V1), viewOf({ current: v2, previous: [frozen] }), ctx))
      .toEqual({ text: 'Your proposal: A car on credit\n\nReplaced by version 2', buttons: [] })
  })

  it('the notices: against with Withdraw, accepted with the comments, withdrawn, expired and the reminders', async () => {
    const ctx = await contextIn('en-US')
    const frozen = versionOf({ votes: votes({ vote: 'against', settled: true, comment: 'Let us wait for the bonus' }, null) })
    const against = render(notice('against', RYAN), viewOf({ status: 'revising', current: frozen }), ctx)
    expect(against.text).toBe('Annika is against: “Let us wait for the bonus”\n'
      + 'The proposal is back with you. To recalculate, tell Claude: “revise the proposal about A car on credit”; it will see the comment.')
    expect(against.buttons).toEqual([[{ text: 'Withdraw', data: `w:${PROPOSAL}` }]])
    const silent = versionOf({ votes: votes({ vote: 'against', settled: true }, null) })
    expect(render(notice('against', RYAN), viewOf({ status: 'revising', current: silent }), ctx).text.split('\n')[0])
      .toBe('Annika is against, without a comment.')
    // sent late, after the author withdrew: no button to press
    expect(render(notice('against', RYAN), viewOf({ status: 'withdrawn', current: frozen }), ctx).buttons).toEqual([])

    const agreed = versionOf({ votes: votes({ vote: 'agree', settled: true, comment: 'Finally!' }, { vote: 'agree', settled: true }) })
    expect(render(notice('accepted', MILA), viewOf({ status: 'accepted', current: agreed }), ctx))
      .toEqual({ text: 'Decided ✓ A car on credit, agreed: Ryan, Annika, Mila\nAnnika: “Finally!”', buttons: [] })

    expect(render(notice('withdrawn', MILA), viewOf({ status: 'withdrawn' }), ctx))
      .toEqual({ text: 'Ryan withdrew the proposal “A car on credit”', buttons: [] })
    expect(render(notice('expired', RYAN), viewOf({ status: 'expired' }), ctx))
      .toEqual({ text: 'The proposal “A car on credit” expired with no decision', buttons: [] })

    expect(render(notice('reminder', MILA), viewOf(), ctx)).toEqual({
      text: 'Ryan’s proposal “A car on credit” waits for your vote until November 16',
      buttons: [[{ text: 'Agree', data: `v:${V1}:a` }, { text: 'Against', data: `v:${V1}:n` }], DETAILS],
    })
    const author = render(notice('reminder', RYAN), viewOf({ status: 'revising', current: frozen }), ctx)
    expect(author.text).toBe('Your proposal “A car on credit” waits for your revision until November 16; after that it expires.')
    expect(author.buttons).toEqual([[{ text: 'Withdraw', data: `w:${PROPOSAL}` }]])
  })

  it('a reminder retried after the proposal moved on is not sent: a voter’s once it is no longer open or replaced, the author’s once it is no longer revising', async () => {
    const ctx = await contextIn('en-US')
    for (const status of ['accepted', 'withdrawn', 'expired', 'revising'] as const) {
      expect(renderMessage(notice('reminder', MILA), viewOf({ status }), ctx)).toBeNull()
    }
    const v2 = versionOf({ id: V2, number: 2 })
    expect(renderMessage(notice('reminder', MILA, V1), viewOf({ current: v2, previous: [versionOf()] }), ctx)).toBeNull()
    for (const status of ['open', 'accepted', 'withdrawn', 'expired'] as const) {
      expect(renderMessage(notice('reminder', RYAN), viewOf({ status }), ctx)).toBeNull()
    }
    // the author's reminder of a replaced version, retried while the new one is back with them: the old title is not sent
    expect(renderMessage(notice('reminder', RYAN, V1), viewOf({ status: 'revising', current: v2, previous: [versionOf()] }), ctx)).toBeNull()
  })

  it.each([
    ['agree, settled', { vote: 'agree', settled: true }],
    ['agree, in its comment window', { vote: 'agree', settled: false }],
    ['against, in its comment window', { vote: 'against', settled: false }],
  ] as const)('a voter’s reminder is not sent once they voted on the open version (%s)', async (_, vote) => {
    const ctx = await contextIn('en-US')
    expect(renderMessage(notice('reminder', MILA), viewOf({ current: versionOf({ votes: votes(null, vote) }) }), ctx)).toBeNull()
    // the other voter, who has not voted, still gets theirs
    expect(renderMessage(notice('reminder', ANNIKA), viewOf({ current: versionOf({ votes: votes(null, vote) }) }), ctx)).not.toBeNull()
  })

  it('a deleted member is left out of the votes line; a deleted author is “Someone”', async () => {
    const ctx = await contextIn('en-US')
    const gone = versionOf({ votes: votes(null, null).map(v => (v.userId === MILA ? { ...v, member: '' } : v)) })
    expect(render(card(ANNIKA), viewOf({ current: gone }), ctx).text).toContain('Ryan ✓ · Annika ⏳ · decide by November 16')
    expect(render(card(ANNIKA), viewOf({ author: { userId: RYAN, member: '' } }), ctx).text.split('\n')[0])
      .toBe('Someone proposes: A car on credit')
  })
  it('a text longer than Telegram allows is cut: each comment to fit, then the whole text', async () => {
    const ctx = await contextIn('en-US')
    const voters = Array.from({ length: 12 }, (_, i) => i + 1)
    const comment = 'x'.repeat(499) + 'y'
    const all = versionOf({ votes: voters.map(userId => ({ userId, member: `Member ${userId}`, vote: 'agree', settled: true, comment, votedAt: NOW.toISOString() })) })
    const { text } = render(notice('accepted', 2), viewOf({ status: 'accepted', current: all }), ctx)
    expect(text.length).toBeLessThanOrEqual(4096)
    const lines = text.split('\n')
    expect(lines).toHaveLength(13)
    expect(lines[0]).toBe(`Decided ✓ A car on credit, agreed: ${voters.map(v => `Member ${v}`).join(', ')}`)
    // every voter's comment is there, each cut alike
    for (const [i, line] of lines.slice(1).entries()) expect(line).toMatch(new RegExp(`^Member ${i + 1}: “x+…”$`))

    const long = versionOf({ title: 'T'.repeat(5000) })
    const cut = render(notice('expired', MILA), viewOf({ status: 'expired', current: long }), ctx).text
    expect(cut).toHaveLength(4096)
    expect(cut.endsWith('…')).toBe(true)
  })

  it('a notice the renderer does not know is no message', async () => {
    const ctx = await contextIn('en-US')
    expect(renderMessage(notice('surprise', MILA), viewOf(), ctx)).toBeNull()
  })
  it('a long comment is cut before the way back to Claude is: the against notice and the revising status keep it', async () => {
    const ctx = await contextIn('en-US')
    const way = 'The proposal is back with you. To recalculate, tell Claude: “revise the proposal about A car on credit”; it will see the comment.'
    const frozen = versionOf({ votes: votes({ vote: 'against', settled: true, comment: 'c'.repeat(5000) }, null) })
    for (const row of [notice('against', RYAN), status()]) {
      const { text } = render(row, viewOf({ status: 'revising', current: frozen }), ctx)
      expect(text.length).toBeLessThanOrEqual(4096)
      expect(text.split('\n').at(-1)).toBe(way)
      expect(text).toMatch(/Annika is against: “c+…”/)
    }
  })
})
