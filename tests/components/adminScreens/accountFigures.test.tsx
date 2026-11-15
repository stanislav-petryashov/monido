// The Accounts detail's figures: the KPI strip, the usual range and the findings (Task 3 of the accounts screen).
import { screen, within } from '@testing-library/react'
import { accountStats } from '../../../src/domain/accountStats'
import { AccountKpis } from '../../../src/pages/admin/accounts/AccountKpis'
import { AccountFindings, UsualRange } from '../../../src/pages/admin/accounts/UsualRange'
import { renderWithClient, stubPrivacyOn } from '../../helpers/render'

/** Thirteen month ends up to May 2031: a year ago 9 600, the minimum 8 180 in December, 8 800 in April, then 10 520 */
const balances = [9600, 9500, 9450, 9300, 9200, 9000, 9450, 8180, 9310, 9240, 9160, 8800, 10520]
  .map((value, i) => ({ month: `20${i < 8 ? '30' : '31'}-${String(((i + 4) % 12) + 1).padStart(2, '0')}`, value }))
const stats = accountStats(balances, [], '2031-05')
const USD = { valueBase: 10520, currency: 'USD', assets: 1144127, date: '2031-05-31' }

const cell = (label: string) => {
  const term = screen.getByText(label)
  return [...term.parentElement!.querySelectorAll('dd')].map(d => d.textContent)
}

describe('AccountKpis', () => {
  it('shows the balance, the month and the year change with %, and the share of assets', () => {
    renderWithClient(<AccountKpis stats={stats} month="2031-05" currency="USD" base={USD} />)
    expect(within(screen.getByLabelText('The account in figures')).getAllByRole('term').map(t => t.textContent))
      .toEqual(['Balance · May 2031', 'Over the month', 'Over the year', 'Share of assets'])
    expect(cell('Balance · May 2031')).toEqual(['$10,520', 'at the month end'])
    expect(cell('Over the month')).toEqual(['+$1,720', '+19.5% since the end of April 2031'])
    expect(cell('Over the year')).toEqual(['+$920', '+9.6% since the end of May 2030'])
    expect(cell('Share of assets')).toEqual(['0.9%', 'of $1,144,127 assets'])
    expect(screen.getByText('+$1,720')).not.toHaveClass('asset-up')
  })

  it('a foreign account adds its value in the snapshot currency at the snapshot\'s rate and date', () => {
    renderWithClient(<AccountKpis stats={stats} month="2031-05" currency="EUR" base={{ ...USD, valueBase: 12121 }} />)
    expect(cell('Balance · May 2031')).toEqual(['€10,520', '≈ $12,121 at the rate of May 31, 2031'])
    expect(cell('Over the month')[0]).toBe('+€1,720')
  })

  it('says «—» for a change it cannot know and leaves out the share without a rate', () => {
    renderWithClient(<AccountKpis stats={accountStats(balances.slice(-1), [], '2031-05')} month="2031-05" currency="USD" base={{ ...USD, valueBase: null }} />)
    expect(cell('Over the month')).toEqual(['—'])
    expect(cell('Over the year')).toEqual(['—'])
    expect(cell('Share of assets')).toEqual(['—', 'of $1,144,127 assets'])
  })

  it('masks every amount in privacy mode, the percentages stay', () => {
    stubPrivacyOn()
    const { container } = renderWithClient(<AccountKpis stats={stats} month="2031-05" currency="EUR" base={{ ...USD, valueBase: 12121 }} />, { dashboard: true })
    expect(container.textContent).not.toMatch(/\d,\d{3}/)
    expect(cell('Balance · May 2031')).toEqual(['•••', '≈ ••• at the rate of May 31, 2031'])
    expect(cell('Over the month')).toEqual(['•••', '+19.5% since the end of April 2031'])
  })
})

describe('UsualRange', () => {
  const range = stats.range!

  it('places the band between 4% and 96%, the average tick and the dot at the balance now, with the captions', () => {
    expect(range).toMatchObject({ min: 8180, minMonth: '2030-12', max: 10520 })
    const { container } = renderWithClient(<UsualRange range={range} last={stats.last} currency="USD" />)
    expect(container.querySelector('.acc-range__hd')).toHaveTextContent(`Balance over 12 months: from $8,180 to $10,520on average $${Math.round(range.avg).toLocaleString('en-US')}`)
    const left = (cls: string) => (container.querySelector(cls) as HTMLElement).style.left
    expect(left('.acc-range__now')).toBe('96%')
    expect(parseFloat(left('.acc-range__avg'))).toBeCloseTo(4 + ((range.avg - 8180) / (10520 - 8180)) * 92, 3)
    expect(screen.getByRole('img')).toHaveAccessibleName('The balance’s range over the year, now $10,520')
    expect([...container.querySelectorAll('.acc-range__ends span')].map(s => s.textContent)).toEqual(['minimum · Dec 2030', 'now $10,520', 'maximum'])
  })

  it('puts the minimum at 4%, and no dot without a balance now', () => {
    const { container, rerender } = renderWithClient(<UsualRange range={range} last={8180} currency="USD" />)
    expect((container.querySelector('.acc-range__now') as HTMLElement).style.left).toBe('4%')
    rerender(<UsualRange range={range} last={null} currency="USD" />)
    expect(container.querySelector('.acc-range__now')).toBeNull()
  })

  it('masks the amounts in privacy mode', () => {
    stubPrivacyOn()
    const { container } = renderWithClient(<UsualRange range={range} last={stats.last} currency="USD" />, { dashboard: true })
    expect(container.textContent).not.toMatch(/\$/)
    expect(screen.getByRole('img')).toHaveAccessibleName('The balance’s range over the year, now •••')
  })
})

describe('AccountFindings', () => {
  it('writes each finding the domain returns from its key, the month as «in <month> <year>», the amounts in the currency', () => {
    renderWithClient(<AccountFindings currency="EUR" findings={[
      { key: 'pages.accounts.finding.grew', params: { count: 2, of: 12 } },
      { key: 'pages.accounts.finding.expensePeak', params: { month: '2031-03', amount: 900, average: 381.67 } },
      { key: 'pages.accounts.finding.belowAverage', params: { amount: 450 } },
    ]} />)
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'The balance grew in 2 of 12 months.',
      'Expenses above usual in March 2031: €900 against an average of €382.',
      'The balance is €450 below its yearly average.',
    ])
    expect(screen.getByText('2 of 12').tagName).toBe('B')
  })

  it('draws nothing when the domain found nothing, and masks the amounts in privacy mode', () => {
    const { container, unmount } = renderWithClient(<AccountFindings currency="EUR" findings={[]} />)
    expect(container).toBeEmptyDOMElement()
    unmount()
    stubPrivacyOn()
    renderWithClient(<AccountFindings currency="EUR" findings={[{ key: 'pages.accounts.finding.belowAverage', params: { amount: 450 } }]} />, { dashboard: true })
    expect(screen.getByRole('listitem')).toHaveTextContent('The balance is ••• below its yearly average.')
  })
})
