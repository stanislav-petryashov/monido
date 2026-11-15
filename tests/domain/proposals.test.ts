import { describe, expect, it } from 'vitest'
import type { Scenario } from '../../src/domain/advisor'
import type { Alternative, Evaluation, Impact, KeyNumbers, RiskLevel } from '../../src/domain/advisorImpact'
import {
  cleanText, COMMENT_MAX, deadlineAfter, TITLE_MAX, numberChanges, parseSettings, parseVerdict, REASON_MAX, remindAt,
  scenarioChanges, validateCardText, voteSummary,
} from '../../src/domain/proposals'

const CREDIT: Scenario = { kind: 'credit', amount: 20000, currency: 'USD', termMonths: 36, ratePct: 12, downPayment: 2000, loanType: 'consumer' }
const NUMBERS: KeyNumbers = { savingsPerMonth: 900, leftForLiving: 1500, debtPaymentPct: 24.4, emergencyMonths: 3.2, liquid: 10000 }

function impactOf(over: Partial<Impact> = {}): Impact {
  return {
    scenario: CREDIT, amountBase: 20000, now: NUMBERS, after: NUMBERS, credit: { principal: 18000, payment: 597.86, overpayment: 3523 },
    monthsToSave: 12, goals: [], incomeShares: [], stress: null, currencyRisk: null, zones: {}, risk: 'caution', gaps: [], ...over,
  }
}
const alt = (kind: Alternative['kind']): Alternative => ({ kind, scenario: CREDIT, impact: impactOf() })
const evaluationOf = (risk: RiskLevel, kinds: Alternative['kind'][] = ['smaller', 'longer_term']): Evaluation =>
  ({ impact: impactOf({ risk }), alternatives: kinds.map(alt) })

const thrown = (fn: () => unknown) => {
  try { fn() } catch (e) { return { code: (e as { code?: string }).code, param: (e as { param?: string }).param } }
  return null
}

describe('cleanText', () => {
  it('cleanText trims, strips control and format characters, keeps newlines in a comment and cuts at the cap', () => {
    expect(cleanText('  Buy a car\u0007 ', 80)).toBe('Buy a car')
    // a zero-width space and a right-to-left override are format characters
    expect(cleanText('ca\u200Br\u202E', 80)).toBe('car')
    expect(cleanText('first line\r\nsecond line\u0000', COMMENT_MAX, { multiline: true })).toBe('first line\nsecond line')
    expect(cleanText('a\tb\n\nc', COMMENT_MAX, { multiline: true })).toBe('a b\n\nc')
    // a lone surrogate is no character
    expect(cleanText('a\uD800b\uDC00', 80)).toBe('ab')
    expect(cleanText('a\uD800b', 80, { multiline: true })).toBe('ab')
    expect(cleanText('abcdef', 3)).toBe('abc')
    // a cut does not split a character made of two UTF-16 units
    expect(cleanText('ab\u{1F600}cd', 3)).toBe('ab\u{1F600}')
    expect(cleanText('ab  cd', 3)).toBe('ab')
    expect(cleanText('  \u200B\n ', 80)).toBeNull()
    expect(cleanText(42, 80)).toBeNull()
    expect(cleanText(null, 80)).toBeNull()
  })

  it('a single-line text turns every run of whitespace, line breaks included, into one space', () => {
    expect(cleanText('Buy\na  car\t\tnow\u2028later\u2029then\r\nend', TITLE_MAX)).toBe('Buy a car now later then end')
    expect(cleanText(' \n Car \n ', TITLE_MAX)).toBe('Car')
  })
})

describe('validateCardText', () => {
  it('validateCardText rejects a digit, a percent sign and a currency sign; accepts words', () => {
    expect(validateCardText('Payment fits, the emergency fund stays healthy')).toBe('ok')
    expect(validateCardText('Die Rate passt, das Polster bleibt groß')).toBe('ok')
    expect(validateCardText('Leaves 3 months')).toBe('has_numbers')
    // a digit of another script is a digit too
    expect(validateCardText('Leaves ٣ months')).toBe('has_numbers')
    expect(validateCardText('A quarter of income goes to loans, about a fifth %')).toBe('has_numbers')
    expect(validateCardText('Costs more than a € a day')).toBe('has_numbers')
    expect(validateCardText('Saves ₽ every month')).toBe('has_numbers')
    expect(validateCardText('Costs $ a lot')).toBe('has_numbers')
  })
})

describe('parseVerdict', () => {
  it('parseVerdict accepts the computed risk and one step more cautious, refuses a lighter one and an unknown computed risk', () => {
    const reason = 'The payment fits'
    expect(parseVerdict({ risk: 'caution', recommended: null, reason }, evaluationOf('caution'))).toEqual({ risk: 'caution', recommended: null, reason })
    expect(parseVerdict({ risk: 'risky', recommended: null, reason }, evaluationOf('caution')).risk).toBe('risky')
    expect(parseVerdict({ risk: 'caution', recommended: null, reason }, evaluationOf('ok')).risk).toBe('caution')
    expect(parseVerdict({ risk: 'risky', recommended: null, reason }, evaluationOf('risky')).risk).toBe('risky')
    expect(thrown(() => parseVerdict({ risk: 'risky', recommended: null, reason }, evaluationOf('ok')))).toEqual({ code: 'invalid_param', param: 'risk' })
    expect(thrown(() => parseVerdict({ risk: 'ok', recommended: null, reason }, evaluationOf('caution')))).toEqual({ code: 'invalid_param', param: 'risk' })
    expect(thrown(() => parseVerdict({ risk: 'unknown', recommended: null, reason }, evaluationOf('unknown')))).toEqual({ code: 'invalid_param', param: 'risk' })
    expect(thrown(() => parseVerdict({ risk: 'risky', recommended: null, reason }, evaluationOf('unknown')))).toEqual({ code: 'invalid_param', param: 'risk' })
    expect(thrown(() => parseVerdict({ risk: 'fine', recommended: null, reason }, evaluationOf('ok')))).toEqual({ code: 'invalid_param', param: 'risk' })
    expect(thrown(() => parseVerdict({ recommended: null, reason }, evaluationOf('ok')))).toEqual({ code: 'missing_param', param: 'risk' })
    expect(thrown(() => parseVerdict(null, evaluationOf('ok')))).toEqual({ code: 'missing_param', param: 'risk' })
  })

  it('parseVerdict refuses a recommended kind that is not among the alternatives', () => {
    const ev = evaluationOf('caution', ['smaller', 'longer_term'])
    expect(parseVerdict({ risk: 'caution', recommended: 'longer_term', reason: 'A longer term halves the strain' }, ev).recommended).toBe('longer_term')
    // left out: no recommendation
    expect(parseVerdict({ risk: 'caution', reason: 'Fits' }, ev).recommended).toBeNull()
    expect(thrown(() => parseVerdict({ risk: 'caution', recommended: 'save_up', reason: 'Wait' }, ev))).toEqual({ code: 'invalid_param', param: 'recommended' })
    expect(thrown(() => parseVerdict({ risk: 'caution', recommended: 7, reason: 'Wait' }, ev))).toEqual({ code: 'invalid_param', param: 'recommended' })
  })

  it('parseVerdict cleans the reason and refuses one with numbers or none', () => {
    const ev = evaluationOf('ok')
    expect(parseVerdict({ risk: 'ok', recommended: null, reason: '  Fits\u200B well ' }, ev).reason).toBe('Fits well')
    expect(parseVerdict({ risk: 'ok', recommended: null, reason: 'a'.repeat(REASON_MAX) }, ev).reason).toHaveLength(REASON_MAX)
    // too long is refused, not cut: Claude shortens it
    expect(thrown(() => parseVerdict({ risk: 'ok', recommended: null, reason: 'a'.repeat(REASON_MAX + 1) }, ev))).toEqual({ code: 'invalid_param', param: 'reason' })
    // a reason is one line
    expect(parseVerdict({ risk: 'ok', recommended: null, reason: 'Fits\nwell' }, ev).reason).toBe('Fits well')
    expect(thrown(() => parseVerdict({ risk: 'ok', recommended: null, reason: 'Leaves 3 months' }, ev))).toEqual({ code: 'invalid_param', param: 'reason' })
    expect(thrown(() => parseVerdict({ risk: 'ok', recommended: null }, ev))).toEqual({ code: 'missing_param', param: 'reason' })
    expect(thrown(() => parseVerdict({ risk: 'ok', recommended: null, reason: ' \u0007 ' }, ev))).toEqual({ code: 'missing_param', param: 'reason' })
    expect(thrown(() => parseVerdict({ risk: 'ok', recommended: null, reason: 5 }, ev))).toEqual({ code: 'invalid_param', param: 'reason' })
  })
})

describe('deadlines', () => {
  it('deadlineAfter adds whole days; remindAt is null when reminders are off', () => {
    const deadline = deadlineAfter(new Date('2031-07-03T09:15:00.000Z'), 14)
    expect(deadline).toBe('2031-07-17T09:15:00.000Z')
    expect(remindAt(deadline, 3)).toBe('2031-07-14T09:15:00.000Z')
    expect(remindAt(deadline, null)).toBeNull()
  })
})

describe('parseSettings', () => {
  it('parseSettings: 1–60 days, reminder 1–59 and before the deadline; remindDays null switches it off', () => {
    expect(parseSettings({ decideDays: 14, remindDays: 3 })).toEqual({ decideDays: 14, remindDays: 3 })
    expect(parseSettings({ decideDays: 1, remindDays: null })).toEqual({ decideDays: 1, remindDays: null })
    expect(parseSettings({ decideDays: 60, remindDays: 59 })).toEqual({ decideDays: 60, remindDays: 59 })
    for (const decideDays of [0, 61, 2.5, '14', undefined]) {
      expect(thrown(() => parseSettings({ decideDays, remindDays: null })), String(decideDays)).toEqual({ code: 'invalid_param', param: 'decideDays' })
    }
    for (const remindDays of [0, 60, 1.5, '3', undefined]) {
      expect(thrown(() => parseSettings({ decideDays: 60, remindDays })), String(remindDays)).toEqual({ code: 'invalid_param', param: 'remindDays' })
    }
    // a reminder on the deadline day or after it never comes before the deadline
    expect(thrown(() => parseSettings({ decideDays: 3, remindDays: 3 }))).toEqual({ code: 'invalid_param', param: 'remindDays' })
    expect(thrown(() => parseSettings(null))).toEqual({ code: 'invalid_param', param: 'decideDays' })
  })
})

describe('changes between versions', () => {
  it('scenarioChanges lists only the fields that differ, with null for a field one side lacks', () => {
    expect(scenarioChanges(CREDIT, { ...CREDIT, termMonths: 48, ratePct: 11.5 })).toEqual([
      { field: 'termMonths', before: 36, after: 48 },
      { field: 'ratePct', before: 12, after: 11.5 },
    ])
    expect(scenarioChanges(CREDIT, CREDIT)).toEqual([])
    const buy: Scenario = { kind: 'buy_now', amount: 900, currency: 'USD' }
    expect(scenarioChanges(buy, { ...buy, goalId: 'trip' })).toEqual([{ field: 'goalId', before: null, after: 'trip' }])
    expect(scenarioChanges({ ...buy, goalId: 'trip' }, buy)).toEqual([{ field: 'goalId', before: 'trip', after: null }])
    expect(scenarioChanges({ ...buy, goalId: 'trip' }, { ...buy, goalId: 'car' })).toEqual([{ field: 'goalId', before: 'trip', after: 'car' }])
    expect(scenarioChanges(CREDIT, { kind: 'save_up', amount: 20000, currency: 'USD', targetMonth: '2032-06' })).toEqual([
      { field: 'kind', before: 'credit', after: 'save_up' },
      { field: 'termMonths', before: 36, after: null },
      { field: 'ratePct', before: 12, after: null },
      { field: 'downPayment', before: 2000, after: null },
      { field: 'loanType', before: 'consumer', after: null },
      { field: 'targetMonth', before: null, after: '2032-06' },
    ])
  })

  it('numberChanges lists payment, payment share, left for living, emergency months and savings that changed', () => {
    const before = impactOf()
    const after = impactOf({
      credit: { principal: 18000, payment: 474.01, overpayment: 4752 },
      after: { ...NUMBERS, debtPaymentPct: 21.9, leftForLiving: 1623.85, emergencyMonths: 3.24, liquid: 9000 },
    })
    // emergency months 3.2 → 3.24 reads the same to one decimal; liquid is not compared
    expect(numberChanges(before, after)).toEqual([
      { key: 'payment', before: 597.86, after: 474.01 },
      { key: 'debtPaymentPct', before: 24.4, after: 21.9 },
      { key: 'leftForLiving', before: 1500, after: 1623.85 },
    ])
    expect(numberChanges(before, impactOf({ credit: null, after: { ...NUMBERS, savingsPerMonth: null } }))).toEqual([
      { key: 'payment', before: 597.86, after: null },
      { key: 'savingsPerMonth', before: 900, after: null },
    ])
    expect(numberChanges(before, before)).toEqual([])
  })
})

describe('outcome', () => {
  const voters = [1, 2, 3]
  it('voteSummary lists every voter in order, with no vote for one who has not voted', () => {
    expect(voteSummary(voters, [{ userId: 3, vote: 'against', settled: false }, { userId: 1, vote: 'agree', settled: true }], { 1: 'Robin', 2: 'Noa', 3: 'Sam' })).toEqual([
      { userId: 1, member: 'Robin', vote: 'agree', settled: true },
      { userId: 2, member: 'Noa', vote: null, settled: false },
      { userId: 3, member: 'Sam', vote: 'against', settled: false },
    ])
  })
})
