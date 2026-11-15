import i18next, { type i18n } from 'i18next'
import type { ProblemParam } from '../domain/types'
import { dayOfMonth, inMonth, monthTitle } from './dates'
import { FALLBACK_LANGUAGE, loadMessages, type Language } from './languages'

export type Translate = (key: string, params?: Record<string, unknown>) => string

// keys are plain strings (no typed resources), so i18next 27's strict variable checks only made the params of `t` required
declare module 'i18next' {
  interface CustomTypeOptions {
    strictInterpolationChecks: false
  }
}

/** A number in the language's format: at most `digits` decimals (exactly `digits` with `fixed`), typographic minus, no negative zero. */
export function formatNumber(value: number, lng: string, digits: number, { fixed = false }: { fixed?: boolean } = {}): string {
  const rounded = Number(value.toFixed(digits))
  return (rounded === 0 ? 0 : rounded)
    .toLocaleString(lng, { minimumFractionDigits: fixed ? digits : 0, maximumFractionDigits: digits }).replace('-', '−')
}

/** A month-close problem: `monthClose.problem.<code>` with its fields listed (or, for a loan payment, the loan's name); `mask` stands for its amounts (privacy). */
export function problemText(t: Translate, { code, fields, name, flow, lines, total }: ProblemParam['problem'], mask?: string): string {
  return t(`monthClose.problem.${code}`, {
    fields: (fields ?? []).map(f => t(`monthClose.field.${f}`)).join(', '), name: name ?? '',
    flow: flow ? t(`monthClose.field.${flow}`) : '', lines: mask ?? lines ?? 0, total: mask ?? total ?? 0,
  })
}

/** Problems of a month as one line: the account (and its member) before each problem, `; ` between them. */
function problemList(t: Translate, problems: readonly ProblemParam[]): string {
  return problems.map(({ name, member, problem }) => {
    const text = problemText(t, problem)
    if (!name) return text
    return member ? t('monthClose.problemAccountMember', { name, member, problem: text }) : t('monthClose.problemAccount', { name, problem: text })
  }).join('; ')
}

/**
 * An i18next instance for `lang` with English as the fallback; shared by the browser and the server.
 * Interpolation formatters: `{{v, decimal}}`, `{{v, amount}}` (a sum, up to two decimals), `{{ym, month}}`, `{{ym, inMonth}}`, `{{date, day}}`, `{{list, problems}}`.
 */
export async function createI18n(lang: Language): Promise<i18n> {
  // copies: i18next keeps the objects it is given and merges added messages into them (the client's locale chunks), and the
  // imported locale modules are shared by every instance
  const resources: Record<string, { translation: Record<string, unknown> }> = {
    [FALLBACK_LANGUAGE]: { translation: structuredClone(await loadMessages(FALLBACK_LANGUAGE)) },
  }
  if (lang !== FALLBACK_LANGUAGE) resources[lang] = { translation: structuredClone(await loadMessages(lang)) }

  const instance = i18next.createInstance()
  await instance.init({
    lng: lang,
    fallbackLng: FALLBACK_LANGUAGE,
    resources,
    interpolation: { escapeValue: false }, // React escapes; Telegram text is plain
    nsSeparator: false,
    returnNull: false,
  })

  const fixedT = (lng: string | undefined): Translate => (key, params) => instance.t(key, { ...params, lng: lng ?? lang })
  const formatter = instance.services.formatter
  formatter?.add('decimal', (value: number, lng) => formatNumber(value, lng ?? lang, 1))
  // a string is a mask (privacy) and goes as it is
  formatter?.add('amount', (value: number | string, lng) => (typeof value === 'string' ? value : formatNumber(value, lng ?? lang, 2)))
  formatter?.add('month', (value: string, lng) => monthTitle(fixedT(lng), value))
  formatter?.add('inMonth', (value: string, lng) => inMonth(fixedT(lng), value))
  formatter?.add('day', (value: string, lng) => dayOfMonth(fixedT(lng), value))
  formatter?.add('problems', (value: readonly ProblemParam[], lng) => problemList(fixedT(lng), value))
  return instance
}
