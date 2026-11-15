import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { useChartFrame } from '../../../src/components/charts/useChartFrame'
import { monthWindow } from '../../../src/domain/overviewBlocks'
import { WindowChart } from '../../../src/pages/overview/WindowChart'
import { renderWithClient } from '../../helpers/render'

it('measures a frame appearing after an empty state and reconnects when it returns', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  let pixels = 512
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => pixels)
  function ConditionalChart() {
    const [shown, setShown] = useState(false)
    const { ref, width } = useChartFrame(700)
    return <><button onClick={() => setShown(s => !s)}>Toggle</button>{shown && <svg ref={ref} data-testid="frame" viewBox={`0 0 ${width} 100`} />}</>
  }
  const count = document.querySelectorAll('.chart-type-probe').length
  render(<ConditionalChart />)
  fireEvent.click(screen.getByText('Toggle'))
  expect(screen.getByTestId('frame')).toHaveAttribute('viewBox', '0 0 512 100')
  fireEvent.click(screen.getByText('Toggle'))
  expect(document.querySelectorAll('.chart-type-probe')).toHaveLength(count)
  pixels = 640
  fireEvent.click(screen.getByText('Toggle'))
  expect(screen.getByTestId('frame')).toHaveAttribute('viewBox', '0 0 640 100')
})

it('fits the SVG to its container and gives enlarged text its own geometry without changing history', () => {
  const callbacks: (() => void)[] = []
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { callbacks.push(callback) } observe() {} disconnect() {} })
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(512)
  document.documentElement.style.fontSize = '32px'
  document.documentElement.style.setProperty('--fs-meta', '.75rem')
  const history = [100, 200].map((netWorth, i) => ({ date: `2026-0${i + 1}-28`, netWorth, assets: netWorth, liabilities: 0 }))
  const window = monthWindow(history, '2026-02'), original = structuredClone(window)
  try {
    const { container } = renderWithClient(<WindowChart window={window} fmtCompact={String} value="200 USD" label="History" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 256 224')
    expect(512 / Number(svg.getAttribute('viewBox')!.split(' ')[2]) * Number(svg.querySelector('.wchart__tag')!.getAttribute('height'))).toBe(44)
    document.documentElement.style.fontSize = '48px'
    act(() => callbacks.forEach(callback => callback()))
    expect(Number(svg.getAttribute('viewBox')!.split(' ')[2])).toBeCloseTo(512 / 3)
    expect(svg.querySelector('.wchart__tagText')).toHaveTextContent('200 USD')
    expect(window).toEqual(original)
  } finally {
    document.documentElement.style.removeProperty('font-size')
    document.documentElement.style.removeProperty('--fs-meta')
  }
})

it('moves long narrow-frame captions into wrapped rows without losing their text', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(256)
  const history = [100, 200, 300, 400].map((netWorth, i) => ({ date: `2026-0${i + 1}-28`, netWorth, assets: netWorth, liabilities: 0 }))
  const text = 'September 2026: +$264,719, the biggest month'
  const heading = 'A very long caption for the current month'
  const { container } = renderWithClient(<WindowChart window={monthWindow(history, '2026-04')} fmtCompact={String} value="400" label="History" highlight={{ from: 1, label: heading }} event={() => text} />)
  const event = container.querySelector('.wchart__event')!, span = container.querySelector('.wchart__spanLabel')!
  expect(event.querySelectorAll('tspan').length).toBeGreaterThan(1)
  expect(event.textContent).toBe(text)
  expect(span.textContent).toBe(heading)
  expect(Number(event.getAttribute('y'))).toBeGreaterThan(224)
})
