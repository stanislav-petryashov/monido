import { render, screen } from '@testing-library/react'
import { StatusCard } from '../../../src/components/cards/StatusCard'
import { ZoneBar } from '../../../src/components/cards/ZoneBar'

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) })

describe('StatusCard', () => {
  describe.each([false, true])('disclosure with phone viewport = %s', narrow => {
    const phone = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: narrow, media: query, addEventListener() {}, removeEventListener() {} }))
    const card = (zone: 'red' | 'amber' | 'green' | 'excellent' | null) => render(
      <StatusCard label="Savings rate" value="12%" zone={zone} thresholds={[5, 15, 25]} inverse={false} unit="%" advice="Save more" />,
    ).container.querySelector('details')!

    it.each(['red', 'amber'] as const)('a card in the %s zone is open: its advice is on the screen', zone => {
      phone()
      expect(card(zone).open).toBe(true)
    })

    it.each(['green', 'excellent', null] as const)('a card in the %s zone stays closed', zone => {
      phone()
      expect(card(zone).open).toBe(false)
    })

    it('shows that the card opens', () => {
      phone()
      expect(card('green').querySelector('summary svg')).not.toBeNull()
    })
  })

  it('keeps thresholds before comparison rows in the explanation', () => {
    const { container } = render(
      <StatusCard label="Savings rate" value="12%" zone="amber" thresholds={[5, 15, 25]} inverse={false} unit="%" rows={[{ label: '3-month average', value: '9%' }]} />,
    )
    const zones = container.querySelector('.zones')!
    const row = screen.getByText('3-month average')
    expect(zones.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the value, the zone as a status chip, the thresholds and the advice', () => {
    const { container } = render(
      <StatusCard label="Emergency fund" value="1.6 mo" zone="amber" thresholds={[1, 3, 6]} inverse={false} unit=" mo" advice="Grow the emergency fund to 3+ months of expenses" />
    )
    expect(screen.getByText('1.6 mo')).toBeInTheDocument()
    expect(screen.getByText('Needs work')).toHaveAttribute('data-color', 'warning')
    expect(screen.getByText('Grow the emergency fund to 3+ months of expenses')).toBeInTheDocument()
    expect(container.querySelectorAll('.zones__seg')).toHaveLength(4)
    expect(container.querySelectorAll('.zones__seg--on')).toHaveLength(1)
  })

  it('«Excellent» is a shade of good', () => {
    render(<StatusCard label="Debt rate" value="4.2%" zone="excellent" thresholds={[10, 15, 20]} inverse unit="%" />)
    expect(screen.getByText('Excellent')).toHaveAttribute('data-color', 'success')
  })

  it('can carry an anchor, comparison rows and a link to the page that owns the metric', () => {
    const { container } = render(
      <StatusCard
        id="savings_rate" label="Savings rate" value="12%" zone="amber" thresholds={[5, 15, 25]} inverse={false} unit="%"
        rows={[{ label: '3-month average', value: '9%' }]} link={{ to: '/cashflow', label: 'More on the Income and expenses page' }}
      />
    )
    expect(container.querySelector('.status')).toHaveAttribute('id', 'savings_rate')
    expect(screen.getByText('3-month average').closest('.cmp__row')).toHaveTextContent('9%')
    expect(screen.getByRole('link', { name: 'More on the Income and expenses page' })).toHaveAttribute('href', '/cashflow')
  })

  it('without them, has no anchor, rows or link', () => {
    const { container } = render(<StatusCard label="Debt rate" value="4.2%" zone="excellent" thresholds={[10, 15, 20]} inverse unit="%" />)
    expect(container.querySelector('.status')).not.toHaveAttribute('id')
    expect(container.querySelector('.cmp__row')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('opens a linked metric even when it is healthy', () => {
    const { container } = render(<StatusCard id="debt" target label="Debt rate" value="4.2%" zone="excellent" thresholds={[10, 15, 20]} inverse unit="%" />)
    expect(container.querySelector('details')).toHaveAttribute('open')
    expect(container.querySelector('details')).toHaveAttribute('tabindex', '-1')
  })

  it('keeps an explanation of missing data open', () => {
    const { container } = render(<StatusCard label="Real growth" value="—" zone={null} thresholds={[0, 3, 7]} inverse={false} unit="%" note="Set inflation first" />)
    expect(container.querySelector('details')).toHaveAttribute('open')
    expect(screen.getByText('Set inflation first')).toBeInTheDocument()
  })

  it('says there is no data instead of guessing a zone', () => {
    const { container } = render(<StatusCard label="Real growth" value="—" zone={null} thresholds={[0, 3, 7]} inverse={false} unit="%" />)
    expect(screen.getByText('No data')).toHaveAttribute('data-color', 'secondary')
    expect(container.querySelector('.zones__seg--on')).toBeNull()
  })
})

describe('ZoneBar', () => {
  const on = (c: HTMLElement) => [...c.querySelectorAll('.zones__seg')].findIndex(el => el.classList.contains('zones__seg--on'))

  it('labels the bad end inclusively, as zoneOf does', () => {
    const { container } = render(<ZoneBar zone="red" thresholds={[5, 15, 25]} inverse={false} unit="%" />)
    expect(container).toHaveTextContent('≤ 5%')
    expect(container).toHaveTextContent('> 25%')
  })

  it('runs from bad to excellent and lights the current zone', () => {
    const { container, rerender } = render(<ZoneBar zone="red" thresholds={[5, 15, 25]} inverse={false} unit="%" />)
    expect(on(container)).toBe(0)
    rerender(<ZoneBar zone="excellent" thresholds={[5, 15, 25]} inverse={false} unit="%" />)
    expect(on(container)).toBe(3)
  })

  it('keeps bad on the left for metrics where less is better', () => {
    const { container } = render(<ZoneBar zone="amber" thresholds={[20, 40, 60]} inverse unit="%" />)
    expect(on(container)).toBe(1)
    expect(screen.getByRole('img')).toHaveAccessibleName(/Needs work/)
    expect(container).toHaveTextContent('≥ 60%')
    expect(container).toHaveTextContent('< 20%')
  })
})

describe('ZoneBar labels', () => {
  it('leaves a word unit to the value above: it does not fit a quarter of a card, and the screen reader still hears it', () => {
    const { container } = render(<ZoneBar zone="green" thresholds={[6, 12, 24]} inverse unit=" mo of income" />)
    expect([...container.querySelectorAll('.zones__label')].map(l => l.textContent)).toEqual(['≥ 24', '12–24', '6–12', '< 6'])
    expect(container.querySelector('.zones')!.getAttribute('aria-label')).toContain('≥ 24 mo of income')
  })

  it('keeps a sign that fits', () => {
    const { container } = render(<ZoneBar zone="green" thresholds={[5, 15, 25]} inverse={false} unit="%" />)
    expect([...container.querySelectorAll('.zones__label')].map(l => l.textContent)).toEqual(['≤ 5%', '5–15', '15–25', '> 25%'])
  })
})
