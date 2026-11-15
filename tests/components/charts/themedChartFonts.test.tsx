import { act, render, screen } from '@testing-library/react'
import { ThemedChart } from '../../../src/components/charts/ThemedChart'

const { resize } = vi.hoisted(() => ({ resize: vi.fn() }))
vi.mock('../../../src/components/charts/echarts', () => import('../../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', async () => {
  const { useEffect, createElement } = await import('react')
  return { default: function MockChart({ onChartReady, option }: { onChartReady?: (chart: unknown) => void; option: { textStyle?: { fontFamily?: string } } }) {
    useEffect(() => { onChartReady?.({ resize, isDisposed: () => false }) }, [onChartReady])
    return createElement('div', { 'data-testid': 'chart-font', 'data-font': option.textStyle?.fontFamily })
  } }
})

it('redraws an existing chart after fonts arrive, and ignores completion after unmount', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(document, 'fonts')
  let complete!: () => void
  const fonts = { status: 'loading', check: () => fonts.status === 'loaded', ready: new Promise<void>(resolve => { complete = resolve }), addEventListener: vi.fn(), removeEventListener: vi.fn() }
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
  try {
    document.documentElement.style.setProperty('--font', 'Onest Variable, system-ui')
    const first = render(<ThemedChart height={180} buildOption={() => ({})} />)
    expect(screen.getByTestId('chart-font').getAttribute('data-font')).toBe('system-ui, -apple-system, sans-serif')
    expect(resize).not.toHaveBeenCalled()
    await act(async () => { fonts.status = 'loaded'; complete(); await fonts.ready })
    expect(screen.getByTestId('chart-font')).toHaveAttribute('data-font', 'Onest Variable, system-ui')
    expect(resize).toHaveBeenCalledTimes(1)
    first.unmount()
    fonts.status = 'loading'
    fonts.ready = new Promise<void>(resolve => { complete = resolve })
    const second = render(<ThemedChart height={180} buildOption={() => ({})} />)
    second.unmount()
    await act(async () => { complete(); await fonts.ready })
    expect(resize).toHaveBeenCalledTimes(1)
  } finally {
    document.documentElement.style.removeProperty('--font')
    if (descriptor) Object.defineProperty(document, 'fonts', descriptor)
    else Reflect.deleteProperty(document, 'fonts')
  }
})
