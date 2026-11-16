import { applyFamilyLanguage } from '../../src/i18n/client'
import { METRICS } from '../../src/domain/metricCatalog'
import {
  factLabel, factText, metricAdvice, metricAsk, metricCaveat, metricFormula, metricMeaning, metricTitle, normText, zoneTitle,
} from '../../src/lib/metricText'
import { ru, withLanguage } from '../helpers/i18n'
import { makeSnapshot } from '../helpers/snapshot'

const money = (usd: number) => `$${Math.round(usd)}`

describe('metric texts', () => {
  it('gives every metric a title, a meaning and a formula', () => {
    for (const key of Object.keys(METRICS) as (keyof typeof METRICS)[]) {
      for (const text of [metricTitle(key), metricMeaning(key), metricFormula(key)]) {
        expect(text, key).not.toBe('')
        expect(text, key).not.toMatch(/^metrics\./)
      }
    }
    expect(metricTitle('emergency_months')).toBe('Emergency fund')
  })

  it('gives a caveat only to the metrics that have one', () => {
    expect(metricCaveat('growth_beyond_savings')).toMatch(/real estate/)
    expect(metricCaveat('capital_growth')).toMatch(/savings/)
    expect(metricCaveat('net_worth')).toBeUndefined()
  })

  it('does not claim amounts are in USD', () => {
    expect(metricFormula('assets')).not.toMatch(/USD/)
  })

  it('asks the extra question only where the catalog says so', () => {
    const base = makeSnapshot()
    expect(metricAsk('net_worth', base)).toMatch(/year/)
    expect(metricAsk('net_worth', makeSnapshot({ capital: { ...base.capital!, yoyDelta: null } }))).toBeUndefined()
    expect(metricAsk('cashflow_net', base)).toBeUndefined()
  })

  it('gives advice in the red and amber zones, the amber one where it differs', () => {
    expect(metricAdvice('emergency_months', 'red')).toBe(metricAdvice('emergency_months', 'amber'))
    expect(metricAdvice('real_growth_yoy', 'red')).not.toBe(metricAdvice('real_growth_yoy', 'amber'))
    expect(metricAdvice('emergency_months', 'green')).toBeUndefined()
    expect(metricAdvice('emergency_months', null)).toBeUndefined()
  })

  it('names the zones', () => {
    expect(zoneTitle('excellent')).toBe('Excellent')
    expect(zoneTitle('amber')).toBe('Needs work')
  })
})

describe('facts', () => {
  it('labels a fact from its key and params', () => {
    expect(factLabel({ label: 'metrics.fact.loanRate', labelParams: { name: 'Mortgage', rate: 7.5 }, value: 1, kind: 'money' }))
      .toBe('Mortgage, 7.5% a year')
    expect(factLabel({ label: 'accounts.class.broker', value: 1, kind: 'money' })).toBe('Broker')
  })

  it('words the months-used fact by the Russian plural of the closed months it is out of', async () => {
    const totals = [1, 21, 22, 35]
    await withLanguage('ru-RU', () => {
      for (const count of totals) {
        expect(factLabel({ label: 'metrics.fact.monthsUsedOf', labelParams: { count }, value: 1, kind: 'count' }))
          .toBe(ru('metrics.fact.monthsUsedOf', { count }))
      }
    })
    const forms = totals.map(count => ru('metrics.fact.monthsUsedOf', { count }).replace(String(count), '#'))
    // "out of 1 / 21" takes the genitive singular, "out of 22 / 35" the genitive plural
    expect(forms[0]).toBe(forms[1])
    expect(forms[2]).toBe(forms[3])
    expect(forms[1]).not.toBe(forms[2])
    expect(factLabel({ label: 'metrics.fact.monthsUsedOf', labelParams: { count: 1 }, value: 1, kind: 'count' })).toBe('Months used, of 1 closed')
  })

  it('words the passive-income coverage as a share, as it is shown next to a percentage', () => {
    expect(factLabel({ label: 'metrics.fact.coversExpenses', value: 38, kind: 'pct' })).toBe('Share of the month’s expenses covered')
  })

  it('formats the value by kind, money through the given formatter', () => {
    const f = (value: number | string | null, kind: Parameters<typeof factText>[0]['kind']) => factText({ label: 'x', value, kind }, money)
    expect(f(2468, 'money')).toBe('$2468')
    expect(f(18.76, 'pct')).toBe('18.8%')
    expect(f(-41, 'pct')).toBe('−41%')
    expect(f(2.37, 'months')).toBe('2.4 mo')
    // one wording for any value: no "1 years"
    expect(f(7.4, 'years')).toBe('7.4 yr')
    expect(f(1, 'years')).toBe('1 yr')
    expect(f(3, 'count')).toBe('3')
    expect(f('metrics.factValue.noRate', 'text')).toBe('no exchange rate to convert')
    expect(f(null, 'money')).toBe('no data')
  })

  it('writes money that names its own currency in that currency, not through the base formatter', () => {
    expect(factText({ label: 'x', value: 1_100_000, kind: 'money', currency: 'RUB' }, money)).toBe('₽1,100,000')
  })
})

describe('normText', () => {
  it('derives norms from the same thresholds the zones use', () => {
    expect(normText('emergency_months')).toBe('norm: above 3 and up to 6 mo; above 6 mo is excellent')
    expect(normText('debt_to_asset')).toBe('norm: from 20 to below 40%; below 20% is excellent')
    expect(normText('debt_payment_ratio')).toBe('norm: from 10 to below 30%; below 10% is excellent')
    expect(normText('consumer_debt_months')).toBe('norm: from 6 to below 12 mo of income; below 6 mo of income is excellent')
  })

  it('in Russian is built from the Russian locale', async () => {
    await withLanguage('ru-RU', () => {
      expect(normText('emergency_months')).toBe(ru('metrics.norm.normal', { b: 3, c: 6, unit: ru('units.health.months') }))
    })
  })
})

describe('a months fact in a language whose month has a plural', () => {
  afterEach(async () => { await applyFamilyLanguage('en-US') })

  it('says 1 mes, not 1 meses', async () => {
    await applyFamilyLanguage('es-ES')
    expect(factText({ kind: 'months', value: 1, label: 'x' } as never, String)).toBe('1 mes')
    expect(factText({ kind: 'months', value: 2.5, label: 'x' } as never, String)).toBe('2,5 meses')
  })
})
