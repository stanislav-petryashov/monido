import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { healthCardView } from '../../src/lib/healthCard'
import { ru, withLanguage } from '../helpers/i18n'

describe('healthCardView', () => {
  it('builds the card from the catalog: value and advice', () => {
    expect(healthCardView('emergency_months', { value: 2.38, zone: 'amber' })).toEqual({
      formattedValue: '2.4 mo',
      rec: 'Grow the emergency fund to 3+ months of expenses',
    })
  })

  it('gives advice only in the red and amber zones', () => {
    expect(healthCardView('emergency_months', { value: 5.2, zone: 'green' }).rec).toBeUndefined()
    expect(healthCardView('savings_rate', { value: 3.4, zone: 'red' }).rec).toBe('Raise your savings rate to at least 15% of income')
  })

  it('formats by unit and signs real growth', () => {
    expect(healthCardView('real_growth_yoy', { value: 5.43, zone: 'green' }).formattedValue).toBe('+5.4%')
    // «of income» is the smaller unit text beside the number, so the value keeps one line
    const debt = healthCardView('consumer_debt_months', { value: 0.52, zone: 'excellent' }).formattedValue as ReactElement
    expect(renderToStaticMarkup(debt)).toBe('0.5 mo <span class="status__unit">of income</span>')
  })

  it('shows a dash without a value', () => {
    expect(healthCardView('fi_rate', { value: null, zone: null })).toEqual({ formattedValue: '—', rec: undefined })
  })

  it('real growth: slightly positive is not «losing purchasing power»', () => {
    expect(healthCardView('real_growth_yoy', { value: 1.8, zone: 'amber' }).rec).toBe('Your net worth barely beats inflation. Review returns and expenses')
    expect(healthCardView('real_growth_yoy', { value: -3.1, zone: 'red' }).rec).toBe('Your net worth is losing purchasing power. Review returns and expenses')
  })

  it('in Russian takes the advice and the unit from the Russian locale', async () => {
    await withLanguage('ru-RU', () => {
      expect(healthCardView('real_growth_yoy', { value: 1.8, zone: 'amber' }).rec).toBe(ru('metrics.real_growth_yoy.amberAdvice'))
      const debt = healthCardView('consumer_debt_months', { value: 0.52, zone: 'excellent' }).formattedValue as ReactElement
      expect(renderToStaticMarkup(debt)).toBe(`0,5 ${ru('units.health.monthsOfIncome').trim().replace(/ (\S+)$/, ' <span class="status__unit">$1</span>')}`)
    })
  })
})
