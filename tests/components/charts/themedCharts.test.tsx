import { render, screen } from '@testing-library/react'
import { ThemeContext } from '../../../src/lib/themeState'
import { buildCapitalHistory } from '../../../src/lib/capitalHistory'
import { AreaChart } from '../../../src/components/charts/AreaChart'
import { ThemedChart } from '../../../src/components/charts/ThemedChart'

vi.mock('../../../src/components/charts/echarts', () => import('../../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', async () => {
  const { createElement } = await import('react')
  return { default: (props: { theme?: string }) => createElement('div', { 'data-testid': 'chart', 'data-theme': props.theme }) }
})

const rows = [
  { date: '2031-08-31', assets: 280000, liabilities: 84000, netWorth: 196000 },
  { date: '2031-09-30', assets: 284900, liabilities: 83560, netWorth: 201340 },
]

describe('charts follow the app theme', () => {
  it('exposes the builder description as current React accessibility text', () => {
    const { rerender } = render(<ThemedChart height={180} buildOption={() => ({ aria: { enabled: true, label: { description: 'Net worth: $140' } } })} />)
    expect(screen.getByRole('img', { name: 'Net worth: $140' })).toBeInTheDocument()
    rerender(<ThemedChart height={180} buildOption={() => ({ aria: { enabled: true, label: { description: 'Net worth: •••' } } })} />)
    expect(screen.getByRole('img', { name: 'Net worth: •••' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Net worth: $140' })).toBeNull()
  })
  it('a chart opened in the dark theme gets the dark ECharts theme', () => {
    render(
      <ThemeContext.Provider value="dark">
        <AreaChart model={buildCapitalHistory(rows, null, 'amount')} visibleSeries={['capital']} selectedMonth="2031-09" onSelectMonth={() => {}} height={180} />
      </ThemeContext.Provider>
    )
    expect(screen.getByTestId('chart')).toHaveAttribute('data-theme', 'vuexy-dark')
  })

  it('switching the theme re-renders the chart with the new palette', () => {
    const { rerender } = render(
      <ThemeContext.Provider value="light">
        <AreaChart model={buildCapitalHistory(rows, null, 'amount')} visibleSeries={['capital']} selectedMonth="2031-09" onSelectMonth={() => {}} height={180} />
      </ThemeContext.Provider>
    )
    expect(screen.getByTestId('chart')).toHaveAttribute('data-theme', 'vuexy-light')
    rerender(
      <ThemeContext.Provider value="dark">
        <AreaChart model={buildCapitalHistory(rows, null, 'amount')} visibleSeries={['capital']} selectedMonth="2031-09" onSelectMonth={() => {}} height={180} />
      </ThemeContext.Provider>
    )
    expect(screen.getByTestId('chart')).toHaveAttribute('data-theme', 'vuexy-dark')
  })
})
