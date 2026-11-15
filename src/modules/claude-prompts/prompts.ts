import { HEALTH_KEYS } from '../../domain/health'
import { METRICS, type MetricKey } from '../../domain/metricCatalog'
import { partialCapitalMonths } from '../../domain/overviewBlocks'
import type { FinanceSnapshot, HealthKey, Warning } from '../../domain/types'
import { t } from '../../i18n/client'
import { fmtMonth, fmtNum } from '../../lib/formatters'
import { factLabel, factText, metricAsk, metricFormula, metricMeaning, metricTitle, normText, zoneTitle } from '../../lib/metricText'
import { warningText as shownWarning } from '../../lib/snapshotSelectors'

/** How to show money: the same function and currency as on screen. */
export interface PromptFormat {
  money(usd: number): string
  /** The currency name as the prompt sentence needs it (the currency's display name in the UI language, e.g. “US Dollar”) */
  currencyName: string
  /** Some amounts were held in another currency: the prompt says they were converted at each date's rate */
  converted: boolean
}

const MAX_WARNINGS = 5
const MAX_LOANS = 3
/** Prompt lines are locale keys under this prefix, built in the active UI language. */
const P = 'modules.claude_prompts.prompt'

const isHealthKey = (key: MetricKey): key is HealthKey => (HEALTH_KEYS as readonly string[]).includes(key)

function metricBody(s: FinanceSnapshot, key: MetricKey, f: PromptFormat): string {
  const def = METRICS[key]
  let valueLine = t(`${P}.value`, { value: factText(def.value(s), f.money) })
  if (isHealthKey(key)) {
    const zone = s.health?.metrics[key]?.zone
    valueLine += `${zone ? t(`${P}.zone`, { zone: zoneTitle(zone) }) : ''}${t(`${P}.norm`, { norm: normText(key) })}`
  }
  const lines = [valueLine, t(`${P}.meaning`, { text: metricMeaning(key) }), t(`${P}.formula`, { text: metricFormula(key) })]
  const parts = def.facts(s).filter(x => x.value !== null)
  if (parts.length) lines.push(t(`${P}.facts`), ...parts.map(x => `- ${factLabel(x)}: ${factText(x, f.money)}`))
  return lines.join('\n')
}

function summaryLines(s: FinanceSnapshot, key: MetricKey, f: PromptFormat): string[] {
  const S = `${P}.summary`
  const lines: string[] = []
  const c = s.capital
  if (c) {
    const delta = c.monthDelta === null ? '' : t(`${S}.delta`, { value: `${c.monthDelta >= 0 ? '+' : ''}${f.money(c.monthDelta)}` })
    // a balance missing or without a rate: the net worth is unknown, as on Overview
    const netWorth = partialCapitalMonths(s).has(c.date.slice(0, 7)) ? '—' : f.money(c.netWorth)
    lines.push(t(`${S}.capital`, { netWorth, delta, assets: f.money(c.assets), liabilities: f.money(c.liabilities) }))
  }
  // the closed month's line even when its totals are unknown (a row without a rate): "—", not left out
  const m = s.cashflow.closedMonth
  const cash = (v: number | undefined) => (v === undefined ? '—' : f.money(v))
  if (s.asOf.closedMonth) lines.push(t(`${S}.cashflow`, { income: cash(m?.income), expense: cash(m?.expense), net: cash(m?.net) }))
  const rate = s.cashflow.savingsRatePct
  const rate3 = s.cashflow.avg3m.ratePct
  if (rate !== null || rate3 !== null) {
    const parts = [rate === null ? null : t(`${S}.rateMonth`, { value: fmtNum(rate) }), rate3 === null ? null : t(`${S}.rate3`, { value: fmtNum(rate3) })]
    lines.push(t(`${S}.savingsRate`, { parts: parts.filter(Boolean).join(', ') }))
  }
  if (m) {
    const cover = m.expense > 0 ? t(`${S}.cover`, { value: fmtNum((m.passive / m.expense) * 100) }) : ''
    lines.push(t(`${S}.passive`, { value: f.money(m.passive), cover }))
  }
  const cushion = s.cashflow.emergencyMonths
  if (key !== 'emergency_months' && cushion !== null) lines.push(t(`${S}.cushion`, { value: fmtNum(cushion) }))
  const loans = (c?.loans ?? [])
    .filter(l => l.balanceBase === null || l.balanceBase > 0.01)
    .sort((a, b) => (b.balanceBase ?? -1) - (a.balanceBase ?? -1))
  if (loans.length) {
    const shown = loans.slice(0, MAX_LOANS)
      .map(l => t(`${S}.loan`, { name: l.name, balance: l.balanceBase === null ? t(`${S}.noRate`) : f.money(l.balanceBase), rate: fmtNum(l.rate) }))
    const more = loans.length > MAX_LOANS ? t(`${S}.loansMore`, { n: loans.length - MAX_LOANS }) : ''
    lines.push(t(`${S}.loans`, { list: shown.join('; '), more }))
  }
  const goals: string[] = []
  if (s.goals.fire) goals.push(`FIRE ${fmtNum(s.goals.fire.progressPct)}%`)
  const plan = s.goals.plan
  if (plan.totalRequiredBase > 0 && plan.surplusBase !== null) {
    goals.push(plan.surplusBase >= 0
      ? t(`${S}.surplus`, { value: f.money(plan.surplusBase) })
      : t(`${S}.shortfall`, { value: f.money(-plan.surplusBase) }))
  }
  if (goals.length) lines.push(t(`${S}.goals`, { list: goals.join('; ') }))
  return lines
}

/** A warning's text without the member's name: “No balance for “Quillmark Bank” (Robin) in …” → without “(Robin)”. */
function warningText(w: Warning): string {
  const text = shownWarning(w)
  const member = w.params?.member
  return member ? text.replace(` (${member})`, '') : text
}

function warningLines(s: FinanceSnapshot): string[] {
  const shown = s.warnings.slice(0, MAX_WARNINGS).map(w => `- ${warningText(w)}`)
  const rest = s.warnings.length - MAX_WARNINGS
  return rest > 0 ? [...shown, `- ${t(`${P}.moreWarnings`, { n: rest })}`] : shown
}

type PromptBlockKind = 'intro' | 'metric' | 'summary' | 'warnings' | 'question'
/** A prompt block: “## heading” and a body in the text; the preview dialog draws them apart. */
export interface PromptBlock { kind: PromptBlockKind; heading: string | null; body: string }

/** A prompt about one metric in blocks: intro, metric, summary, warnings, question; in the active UI language. */
export function buildMetricPromptBlocks(s: FinanceSnapshot, key: MetricKey, f: PromptFormat): PromptBlock[] {
  const def = METRICS[key]
  const closed = s.asOf.closedMonth
  const blocks: PromptBlock[] = [
    {
      kind: 'intro',
      heading: null,
      body: [
        t(`${P}.role`),
        t(f.converted ? `${P}.ratesLatest` : `${P}.ratesData`, { currency: f.currencyName }),
        t(`${P}.only`),
      ].join(' '),
    },
    { kind: 'metric', heading: t(`${P}.metricHeading`, { title: metricTitle(key) }), body: metricBody(s, key, f) },
  ]
  const summary = summaryLines(s, key, f)
  if (summary.length) {
    const heading = closed ? t(`${P}.summaryHeadingClosed`, { month: fmtMonth(closed) }) : t(`${P}.summaryHeading`)
    blocks.push({ kind: 'summary', heading, body: summary.join('\n') })
  }
  const warnings = warningLines(s)
  if (warnings.length) blocks.push({ kind: 'warnings', heading: t(`${P}.warningsHeading`), body: warnings.join('\n') })
  const ask = metricAsk(key, s)
  const question = def.value(s).value === null
    ? t(`${P}.noValue`)
    : [t(`${P}.explain`), ask, t(`${P}.actions`), t(`${P}.answerIn`)].filter(Boolean).join(' ')
  blocks.push({ kind: 'question', heading: t(`${P}.questionHeading`), body: question })
  return blocks.map(b => ({ ...b, heading: b.heading === null ? null : scrubMembers(b.heading, s), body: scrubMembers(b.body, s) }))
}

/** Clipboard text: exactly what the preview dialog shows. */
export function promptText(blocks: PromptBlock[]): string {
  return blocks.map(b => (b.heading === null ? b.body : `## ${b.heading}\n${b.body}`)).join('\n\n')
}

/** A Claude prompt about one metric as one string; tests check the block assembly against it. @public */
export function buildMetricPrompt(s: FinanceSnapshot, key: MetricKey, f: PromptFormat): string {
  return promptText(buildMetricPromptBlocks(s, key, f))
}

/**
 * A safeguard: member names never reach the chat, even if they got into some data text. A name is replaced as a whole
 * word, the longer names first ("Annika" before "Ann"), so neither a longer name nor a word ("Also" for "Al") is cut.
 * No lookbehind: this runs in the browser (Safari before 16.4 has none), so the char before the name is kept by a group.
 */
function scrubMembers(text: string, s: FinanceSnapshot): string {
  const members = new Set([
    ...(s.capital?.accounts ?? []).map(a => a.member),
    ...(s.capital?.realEstate ?? []).map(r => r.member),
    ...(s.capital?.loans ?? []).map(l => l.member),
    ...s.cashflow.rows.map(r => r.member),
    ...s.warnings.map(w => typeof w.params?.member === 'string' ? w.params.member : ''),
  ])
  const names = [...members].filter(name => name.length > 1).sort((a, b) => b.length - a.length)
  if (!names.length) return text
  const word = t(`${P}.member`)
  const alternatives = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, 'gu')
  return text.replace(pattern, (_, before: string) => before + word)
}
