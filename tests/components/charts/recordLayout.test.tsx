import { act, screen } from '@testing-library/react'
import { ScheduleTable } from '../../../src/pages/admin/loans/ScheduleTable'
import { computeSchedule } from '../../../src/domain/loans'
import { ValueStepChart } from '../../../src/modules/real-estate/view/ValueStepChart'
import { WaterfallSvg } from '../../../src/components/charts/WaterfallSvg'
import { applyFamilyLanguage } from '../../../src/i18n/client'
import { renderWithClient } from '../../helpers/render'

describe('record chart label space', () => {
  it('reserves line height and width for enlarged waterfall text', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(256)
    const computed = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(el => el.classList.contains('wf__v') ? { fontSize: '24px' } as CSSStyleDeclaration : computed(el))
    const { container } = renderWithClient(<WaterfallSvg start={{ name: 'Start', value: 100, label: '100 000 000 RUB · no rate at the start' }} end={{ name: 'End', value: 200, label: '200 000 000 RUB' }} steps={[{ key: '1', name: 'Change', from: 100, to: 200, label: '+100 000 000 RUB' }]} label="Change" />)
    const name = container.querySelector('.wf__n')!, value = container.querySelector('.wf__v')!
    expect(Number(value.getAttribute('y')) - Number(name.getAttribute('y'))).toBeGreaterThanOrEqual(30)
    expect([...value.querySelectorAll('tspan')].every(line => line.textContent!.length * 14 <= 240)).toBe(true)
  })

  it('exposes the loan schedule as a named keyboard scrolling region', () => {
    const schedule = computeSchedule({ rowid: 1, name: 'Loan', principal: 1000, rate: 0, term_months: 2, monthly_payment: 500, issue_date: '2026-01-01', payment_day: 1, currency: 'USD', member: 'A', type: 'consumer', status: 'active', closed_date: null }, [])
    renderWithClient(<ScheduleTable schedule={schedule} currentIdx={0} currency="USD" />)
    expect(screen.getAllByRole('region', { name: 'Payment schedule' }).some(el => el.getAttribute('tabindex') === '0' && el.querySelector('table'))).toBe(true)
  })

  it('places the full single valuation amount inside the frame', () => {
    const { container } = renderWithClient(<ValueStepChart name="Home" purchase={{ date: '2026-01-01', price: 12500000, currency: 'RUB' }} valuations={[{ year: 2026, value: 13000000 }]} currency="RUB" currentYear={2026} compact />)
    const text = container.querySelector('.re-chart__vl')!
    const x = Number(text.getAttribute('x')), estimatedWidth = text.textContent!.length * 7
    const left = text.getAttribute('text-anchor') === 'end' ? x - estimatedWidth : x
    expect(left).toBeGreaterThanOrEqual(48)
    expect(left + estimatedWidth).toBeLessThanOrEqual(324)
  })

  it('spaces localized change labels according to their widths', async () => {
    await act(() => applyFamilyLanguage('ru-RU'))
    try {
      const { container } = renderWithClient(<ValueStepChart name="Home" purchase={{ date: '2022-01-01', price: 13500000, currency: 'RUB' }} valuations={[{ year: 2022, value: 13500000 }, { year: 2023, value: 14310000 }, { year: 2024, value: 15168500 }, { year: 2025, value: 16078500 }]} currency="RUB" currentYear={2026} compact />)
      const labels = [...container.querySelectorAll('.re-chart__cl')].filter(e => e.textContent !== '—').map(e => ({ x: Number(e.getAttribute('x')), width: e.textContent!.length * 6.5 }))
      expect(labels.every((r, i) => i === 0 || r.x - r.width / 2 >= labels[i - 1].x + labels[i - 1].width / 2 + 4)).toBe(true)
    } finally { await act(() => applyFamilyLanguage('en-US')) }
  })

  it('keeps a usable waterfall plot instead of spending its width on long values', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(256)
    const { container } = renderWithClient(<WaterfallSvg start={{ name: 'Start', value: 100000000, label: '100 000 000 ₽ · no rate at the start' }} end={{ name: 'End', value: 200000000, label: '200 000 000 ₽' }} steps={[{ key: '1', name: 'Change', from: 100000000, to: 200000000, label: '+100 000 000 ₽' }]} label="Change" />)
    expect(Number(container.querySelector('.wf__bar')!.getAttribute('width'))).toBeGreaterThanOrEqual(96 / 1.12 - 0.1)
    expect(container.querySelector('.wf')!.textContent).toContain('100 000 000 ₽ · no rate at the start')
  })
})
