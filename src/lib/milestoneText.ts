import type { Translate } from '../i18n/core'
import type { Milestone } from '../domain/types'

/** A milestone as one sentence; `fmt` draws an amount in its own currency (the screen's masks it in privacy mode, the bot's does not) */
export function milestoneText(t: Translate, m: Milestone, fmt: (amount: number, currency: string) => string): string {
  const key = `data.close.milestone.${m.kind}`
  if (m.kind === 'netWorthMark') return m.level === 0 ? t('data.close.milestone.outOfTheRed') : t(key, { amount: fmt(m.level!, m.currency!) })
  if (m.kind === 'addedThisYear') return t(key, { count: m.level })
  return t(key, m.params)
}
