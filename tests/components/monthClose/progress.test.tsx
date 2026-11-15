import { fireEvent, render, screen } from '@testing-library/react'
import { CloseProgress } from '../../../src/pages/admin/CloseProgress'
import { closeColumns, rowFilled } from '../../../src/pages/admin/closeRows'
import type { DraftRow } from '../../../src/domain/monthClose'
import { account, base, renderScreen, stubState } from '../../helpers/monthClose'

const filled = (name: string): DraftRow => ({ ...account(name), balance: 10, active: 0, passive: 0, expense: 0 })
const columns = closeColumns(true)
const renderCard = (rows: DraftRow[], onJump = vi.fn()) => {
  render(<CloseProgress rows={rows} filledOf={r => rowFilled(r, columns)} month="2031-06" flows loans={false} onJump={onJump} />)
  return onJump
}
const six = () => [filled('A'), account('B'), account('C'), filled('D'), account('E'), { ...account('F'), balance: 5 }]

describe('The month-close progress card', () => {
  it('says how many accounts are filled, one segment per account', () => {
    renderCard(six())
    const card = screen.getByRole('region', { name: 'Filling in June 2031' })
    expect(card).toHaveClass('card', 'close-progress')
    expect(card.querySelector('.close-progress__fig')).toHaveTextContent('2 of 6accounts filled')
    const segments = [...card.querySelectorAll('button.close-seg')]
    expect(segments).toHaveLength(6)
    expect(segments.filter(s => s.classList.contains('close-seg--on'))).toHaveLength(2)
    expect(segments[0]).toHaveAccessibleName('A: filled')
    expect(segments[1]).toHaveAccessibleName('B: not filled')
  })

  it('names the unfilled accounts in row order, and nothing once all are filled', () => {
    renderCard(six())
    expect(screen.getByText(/^Missing:/)).toHaveTextContent('Missing: B, C, E')
    expect(screen.getByText(/^Missing:/)).not.toHaveTextContent(', F')
    fireEvent.click(screen.getByText('Show all missing accounts'))
    expect(screen.getByRole('button', { name: 'F' })).toBeInTheDocument()
  })

  it('uses a single progress indicator and can jump to a missing account in a long list', () => {
    const rows = Array.from({ length: 156 }, (_, i) => account(`Account ${i}`))
    const jump = renderCard(rows)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '156')
    expect(document.querySelectorAll('.close-seg')).toHaveLength(0)
    fireEvent.click(screen.getByText('Show all missing accounts'))
    fireEvent.click(screen.getByRole('button', { name: 'Account 155' }))
    expect(jump).toHaveBeenCalledWith(JSON.stringify(['Account 155', 'Robin']))
  })

  it('has no missing line when every account is filled', () => {
    renderCard([filled('A'), filled('B')])
    expect(screen.queryByText(/^Missing:/)).toBeNull()
    expect(document.querySelector('.close-progress__fig')).toHaveTextContent('2 of 2accounts filled')
  })

  it('a segment jumps to its account', () => {
    const onJump = renderCard(six())
    fireEvent.click(screen.getByRole('button', { name: 'C: not filled' }))
    expect(onJump).toHaveBeenCalledWith(JSON.stringify(['C', 'Robin']))
  })

  it('without onJump (a viewer, who has no fields) the segments are marks, not buttons', () => {
    render(<CloseProgress rows={six()} filledOf={r => rowFilled(r, columns)} month="2031-06" flows loans={false} />)
    expect(document.querySelectorAll('button.close-seg')).toHaveLength(0)
    const marks = [...document.querySelectorAll('i.close-seg')]
    expect(marks).toHaveLength(6)
    expect(marks[0]).toHaveAccessibleName('A: filled')
  })

  it('without the cash-flow module a row needs the balance only', () => {
    const balanceOnly = { ...account('A'), balance: 0 }
    expect(rowFilled(balanceOnly, closeColumns(false))).toBe(true)
    expect(rowFilled(balanceOnly, closeColumns(true))).toBe(false)
    expect(rowFilled(account('A'), closeColumns(false))).toBe(false)
  })
})

describe('The progress card on the wizard', () => {
  it('a segment puts the cursor in its account’s balance', async () => {
    stubState(base)
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Deposit: not filled' }))
    expect(screen.getByLabelText('Balance: Deposit')).toHaveFocus()
  })
})

it('keeps jumps for the last three missing accounts in a large queue', () => {
  const rows = Array.from({ length: 156 }, (_, i) => i < 153 ? filled(`Account ${i}`) : account(`Account ${i}`))
  const jump = renderCard(rows)
  fireEvent.click(screen.getByText('Show all missing accounts'))
  fireEvent.click(screen.getByRole('button', { name: 'Account 155' }))
  expect(jump).toHaveBeenCalledWith(JSON.stringify(['Account 155', 'Robin']))
})
