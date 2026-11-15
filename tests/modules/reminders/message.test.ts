import { describe, expect, it } from 'vitest'
import { createI18n, type Translate } from '../../../src/i18n/core'
import { monthTitle } from '../../../src/i18n/dates'
import { reminderText, testMessage } from '../../../src/modules/reminders/message'
import { ru } from '../../helpers/i18n'

const en: Translate = (await createI18n('en-US')).getFixedT('en-US')
const russian: Translate = (await createI18n('ru-RU')).getFixedT('ru-RU')
const url = 'https://finance.example.com'
/** n months from January 2029 on, 'YYYY-MM'. */
const months = (n: number) => Array.from({ length: n }, (_, i) => `${2029 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`)

describe('reminderText in English', () => {
  it('names one open month and points to the app without an address', () => {
    expect(reminderText(en, ['2031-05'], null)).toBe('May 2031 is not closed yet.\nOpen “Close month” in the app.')
  })
  it('names one open month with the link', () => {
    expect(reminderText(en, ['2031-09'], url)).toBe('September 2031 is not closed yet.\nClose it: https://finance.example.com/close')
  })
  it('lists several and says which comes first', () => {
    expect(reminderText(en, ['2031-09', '2031-10'], url))
      .toBe('2 months are not closed yet: September 2031, October 2031.\nClose September 2031: https://finance.example.com/close')
  })
  it('shortens a long queue', () => {
    expect(reminderText(en, months(7), url)).toContain('7 months are not closed yet: January 2029, February 2029, March 2029 and 4 more.')
  })
  it('lists six in full', () => {
    expect(reminderText(en, months(6), null).split('\n')[0]).toBe('6 months are not closed yet: January 2029, February 2029, March 2029, April 2029, May 2029, June 2029.')
  })
  it('does not double the slash of the address', () => {
    expect(reminderText(en, ['2031-09'], `${url}/`)).toContain('https://finance.example.com/close')
    expect(reminderText(en, ['2031-09'], `${url}/`)).not.toContain('com//data')
  })
})

describe('reminderText in Russian', () => {
  const category = (n: number) => new Intl.PluralRules('ru-RU').select(n)
  const titles = (list: string[]) => list.map(ym => monthTitle(ru, ym))

  it('names one open month', () => {
    expect(reminderText(russian, ['2031-09'], url)).toBe(`${ru('modules.reminders.message.single', { month: monthTitle(ru, '2031-09') })}\n${ru('modules.reminders.message.closeAt', { url: `${url}/close` })}`)
    expect(reminderText(russian, ['2031-09'], null).split('\n')[1]).toBe(ru('modules.reminders.message.openApp'))
  })

  it.each([2, 5, 21])('agrees the headline with %i months', n => {
    const all = titles(months(n))
    const list = n > 6 ? ru('modules.reminders.message.more', { list: all.slice(0, 3).join(', '), rest: n - 3 }) : all.join(', ')
    expect(reminderText(russian, months(n), url)).toBe(
      `${ru(`modules.reminders.message.head_${category(n)}`, { count: n, list })}\n${ru('modules.reminders.message.closeFirstAt', { month: all[0], url: `${url}/close` })}`,
    )
  })

  it('agrees the verb with the count: 21 takes the singular, 22 the plural', () => {
    // the headline opens with the negated verb: two words
    const verb = (n: number) => reminderText(russian, months(n), null).split(' ').slice(0, 2).join(' ')
    expect(verb(21)).toBe(verb(1))
    expect(verb(22)).not.toBe(verb(21))
    expect(verb(22)).toBe(verb(5))
  })
})

describe('testMessage', () => {
  it('says that the reminders are set up, in the given language', () => {
    expect(testMessage(en)).toBe('Test message: reminders about months not closed yet are set up.')
    expect(testMessage(russian)).toBe(ru('modules.reminders.message.test'))
  })
})
