import { createI18n, problemText, type Translate } from '../../src/i18n/core'
import type { Language } from '../../src/i18n/languages'
import { dayOfMonth, inMonth, monthShort, monthTitle } from '../../src/i18n/dates'
import { ru } from '../helpers/i18n'

async function translator(lang: Language): Promise<Translate> {
  const i18n = await createI18n(lang)
  i18n.addResource(lang, 'translation', 'x', '{{v, decimal}}')
  i18n.addResource(lang, 'translation', 'when', '{{ym, month}} · {{ym, inMonth}} · {{date, day}}')
  return (key, params) => i18n.t(key, params)
}

describe('createI18n (en-US)', () => {
  it('formats decimals like the cards: one digit, typographic minus, no negative zero', async () => {
    const t = await translator('en-US')
    expect(t('x', { v: 1234.56 })).toBe('1,234.6')
    expect(t('x', { v: -0.04 })).toBe('0')
    expect(t('x', { v: -2.5 })).toBe('−2.5')
  })

  it('names months and days', async () => {
    const t = await translator('en-US')
    expect(monthTitle(t, '2031-05')).toBe('May 2031')
    expect(inMonth(t, '2031-05')).toBe('in May')
    expect(dayOfMonth(t, '2031-11-01')).toBe('November 1')
    expect(monthShort(t, 1)).toBe('Jan')
  })

  it('orders month and year by the language (dates.monthYear)', async () => {
    const t = await translator('en-US')
    const i18n = await createI18n('en-US')
    i18n.addResource('en-US', 'translation', 'dates.monthYear', '{{year}}年{{month}}')
    i18n.addResource('en-US', 'translation', 'dates.month.11', '11月')
    expect(monthTitle(i18n.t.bind(i18n) as Translate, '2026-11')).toBe('2026年11月')
    expect(monthTitle(t, '2026-11')).toBe('November 2026')
  })

  it('offers the date helpers as interpolation formatters', async () => {
    const t = await translator('en-US')
    expect(t('when', { ym: '2031-05', date: '2031-11-01' })).toBe('May 2031 · in May · November 1')
  })

  it('falls back to the key for an unknown key, never null', async () => {
    const t = await translator('en-US')
    expect(t('no.such.key')).toBe('no.such.key')
  })
})

describe('createI18n (ru-RU)', () => {
  it('writes Chinese month titles year first', async () => {
    const t = await translator('zh-CN')
    expect(monthTitle(t, '2026-11')).toBe('2026年11月')
  })

  it('takes month names from the Russian locale', async () => {
    const t = await translator('ru-RU')
    expect(monthTitle(t, '2031-05')).toBe(`${ru('dates.month.5')} 2031`)
    expect(dayOfMonth(t, '2031-11-01')).toBe(ru('dates.dayOfMonth', { day: 1, month: ru('dates.monthOf.11') }))
  })

  it('formats decimals the Russian way', async () => {
    const t = await translator('ru-RU')
    expect(t('x', { v: 1234.56 })).toBe((1234.6).toLocaleString('ru-RU'))
    expect(t('x', { v: -2.5 })).toBe(`−${(2.5).toLocaleString('ru-RU')}`)
  })

  it('falls back to English for a key missing in Russian', async () => {
    const i18n = await createI18n('ru-RU')
    i18n.addResource('en-US', 'translation', 'only.en', 'English only')
    expect(i18n.t('only.en')).toBe('English only')
  })
})

describe('problemText', () => {
  it('words a month-close problem with its fields joined by commas', async () => {
    const t = await translator('en-US')
    expect(problemText(t, { code: 'missing', fields: ['balance', 'expense'] })).toBe('not filled in: balance, expenses')
    expect(problemText(t, { code: 'no_name' })).toBe('no name')
  })

  it('words an over-allocated account with its flow and both sums', async () => {
    const t = await translator('en-US')
    expect(problemText(t, { code: 'over_allocated', flow: 'passive', lines: 1200.5, total: 1000 }))
      .toBe('the lines by category (1,200.5) exceed the passive income (1,000): lower a line or raise the total')
  })

  it('keeps the Russian wording', async () => {
    const t = await translator('ru-RU')
    const fields = ['balance', 'expense'].map(f => ru(`monthClose.field.${f}`)).join(', ')
    expect(problemText(t, { code: 'missing', fields: ['balance', 'expense'] })).toBe(ru('monthClose.problem.missing', { fields }))
  })
})
