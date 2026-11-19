import type { Translate } from '../i18n/core'
import { addedOf, marketsOf, MATERIAL_SHARE } from '../domain/capitalChange'
import type { Milestone, MonthChange } from '../domain/types'

/** A milestone as one sentence; `fmt` draws an amount in its own currency (the screen's masks it in privacy mode, the bot's does not) */
export function milestoneText(t: Translate, m: Milestone, fmt: (amount: number, currency: string) => string): string {
  const key = `data.close.milestone.${m.kind}`
  if (m.kind === 'netWorthMark') return m.level === 0 ? t('data.close.milestone.outOfTheRed') : t(key, { amount: fmt(m.level!, m.currency!) })
  if (m.kind === 'addedThisYear') return t(key, { count: m.level })
  return t(key, m.params)
}

/** What the family did this month, markets and rates apart, and the rest the records do not explain when it matters */
export function changeText(t: Translate, c: MonthChange, fmt: (v: number) => string): string {
  if (c.form === 'balances') return t('data.close.whatWeDid.accounts', { amount: fmt(c.rows.accounts ?? 0) })
  const added = addedOf(c), markets = marketsOf(c), rest = c.rows.unexplained ?? 0
  const moves = Object.values(c.rows).reduce<number>((a, v) => a + Math.abs(v ?? 0), 0) - Math.abs(rest)
  return [
    t(added < 0 ? 'data.close.whatWeDid.tookOut' : 'data.close.whatWeDid.added', { amount: fmt(Math.abs(added)) }),
    t(markets < 0 ? 'data.close.whatWeDid.marketsDown' : 'data.close.whatWeDid.marketsUp', { amount: fmt(Math.abs(markets)) }),
    ...(Math.abs(rest) >= Math.max(1, MATERIAL_SHARE * moves) ? [t('data.close.whatWeDid.unexplained', { amount: fmt(Math.abs(rest)) })] : []),
  ].join(' ')
}
