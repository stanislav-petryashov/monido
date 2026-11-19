import { fireEvent, render, screen, within } from '@testing-library/react'
import { ScheduleTable } from '../../src/pages/admin/loans/ScheduleTable'
import { EarlyPaymentsTable } from '../../src/pages/admin/loans/EarlyPaymentsTable'

const day = (n: number) => `2031-${String(n).padStart(2, '0')}-01`
const row = (n: number, early = 0) => ({
  rowNum: n, date: day(n), openingBalance: 1300 - n * 100, scheduledPayment: 110, principalPart: 100,
  interest: 10, earlyPayment: early, earlyPrincipal: early, closingBalance: 1200 - n * 100,
})
const schedule = [row(1), row(2, 500), row(3), row(4), row(5), row(6), row(7), row(8), row(9), row(10)]
const dates = (container: HTMLElement) => [...container.querySelectorAll('tbody tr')].map(r => r.querySelector('time')?.textContent)

describe('ScheduleTable', () => {
  it('shows the two rows before the current one, the current one and the three after it', () => {
    const { container } = render(<ScheduleTable schedule={schedule} currentIdx={4} currency="USD" />)
    expect(dates(container)).toEqual(['03/01/2031', '04/01/2031', '05/01/2031', '06/01/2031', '07/01/2031', '08/01/2031'])
    expect(screen.getByText('next 05/01/2031 · USD')).toBeInTheDocument()
    expect(screen.getByText('Coming payments · 10 in all')).toBeInTheDocument()
  })

  it('marks the current row for sight and for a screen reader, without a warning colour', () => {
    const { container } = render(<ScheduleTable schedule={schedule} currentIdx={2} currency="USD" />)
    const current = container.querySelector('tr.is-current') as HTMLElement
    expect(within(current).getByText('03/01/2031')).toBeInTheDocument()
    expect(current).toHaveAttribute('aria-current', 'true')
    expect(container.innerHTML).not.toMatch(/warning/)
  })

  it('“Full schedule” shows every row, and the current one stays marked', () => {
    const { container } = render(<ScheduleTable schedule={schedule} currentIdx={4} currency="USD" />)
    fireEvent.click(screen.getByRole('button', { name: 'Full schedule' }))
    expect(container.querySelectorAll('tbody tr')).toHaveLength(10)
    expect(container.querySelector('tr.is-current')).toHaveTextContent('05/01/2031')
    fireEvent.click(screen.getByRole('button', { name: 'Coming payments only' }))
    expect(container.querySelectorAll('tbody tr')).toHaveLength(6)
  })

  it('a paid-off loan shows its last rows, ending at the payoff row, none dimmed', () => {
    const { container } = render(<ScheduleTable schedule={schedule} currentIdx={-1} currency="USD" />)
    expect(dates(container).at(-1)).toBe('10/01/2031')
    expect(container.querySelectorAll('tr.is-past')).toHaveLength(0)
    expect(screen.getByText('last payment 10/01/2031 · USD')).toBeInTheDocument()
    expect(screen.getByText('Last payments')).toBeInTheDocument()
  })

  it('dims past rows of an active loan', () => {
    const { container } = render(<ScheduleTable schedule={schedule} currentIdx={2} currency="USD" />)
    expect(container.querySelectorAll('tr.is-past')).toHaveLength(2)
  })

  it('marks an early payment with an icon in its cell, not with a row background', () => {
    const { container } = render(<ScheduleTable schedule={schedule} currentIdx={3} currency="USD" />)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows[0].querySelector('svg')).not.toBeNull()
    expect(rows[1].querySelector('svg')).toBeNull()
    expect((rows[0] as HTMLElement).getAttribute('style')).toBeNull()
  })

  it('says there is nothing to show for an empty schedule', () => {
    render(<ScheduleTable schedule={[]} currentIdx={-1} currency="USD" />)
    expect(screen.getByText(/^No data for the schedule\. Check the loan amount, rate, term/)).toBeInTheDocument()
  })
})

describe('EarlyPaymentsTable', () => {
  const props = { currency: 'USD', adding: null, editing: null, actions: null }
  it('says what an early payment would show when there are none, and counts them when there are', () => {
    const { unmount } = render(<EarlyPaymentsTable selectedEPs={[]} total={0} {...props} />)
    expect(screen.getByText(/No early payments yet\. Choose “Early payment”/)).toBeInTheDocument()
    unmount()
    render(<EarlyPaymentsTable total={500} selectedEPs={[{ rowid: 1, id: 1, loan_name: 'L', payment_date: '2031-02-10', amount: 500, strategy: 'reduce_term', new_payment: null, principal_credit: null, notes: null }]} {...props} />)
    expect(screen.getByText('1 payment · $500 · newest first')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '$500.00' })).toBeInTheDocument()
  })
})
