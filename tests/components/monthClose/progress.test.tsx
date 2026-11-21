import { fireEvent, render, screen } from '@testing-library/react'
import { CloseProgress } from '../../../src/pages/admin/CloseProgress'
import { closeColumns, rowFilled } from '../../../src/pages/admin/closeRows'
import type { DraftRow } from '../../../src/domain/monthClose'
import { account } from '../../helpers/monthClose'

function renderHeader(rows: DraftRow[], flows = true, onJump?: (key: string) => void) {
  render(<CloseProgress rows={rows} filledOf={r => rowFilled(r, closeColumns(flows))} month="2032-02" flows={flows} loans={false} onJump={onJump} />)
}

it('names the closing period and its actual last day without repeating the action bar count', () => {
  renderHeader([account('Cash')])
  expect(screen.getByRole('heading', { name: 'Closing February' })).toBeVisible()
  expect(screen.getByText(/Enter balances as of February 29, 2032/)).toBeVisible()
  expect(screen.queryByText('Show all missing accounts')).toBeNull()
  expect(screen.queryByText(/accounts filled/)).toBeNull()
})

it('explains balances only when the household does not track cash flow', () => {
  renderHeader([account('Cash')], false)
  expect(screen.getByText('Enter balances as of February 29, 2032 for your family report.')).toBeVisible()
  expect(screen.getByText('How to enter balances')).toBeVisible()
  expect(screen.queryByText('What counts as income or expenses?')).toBeNull()
})

it('offers a jump to each outstanding account in a long list', () => {
  const rows = Array.from({ length: 156 }, (_, i) => ({ ...account(`Account ${i}`), balance: i < 153 ? 0 : null }))
  const jump = vi.fn()
  renderHeader(rows, false, jump)
  fireEvent.click(screen.getByText('Show all missing accounts'))
  expect(screen.queryByRole('button', { name: 'Account 152' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Account 155' }))
  expect(jump).toHaveBeenCalledWith(JSON.stringify(['Account 155', 'Robin']))
})

it('keeps the missing account list readable for a viewer', () => {
  renderHeader(Array.from({ length: 13 }, (_, i) => account(`Account ${i}`)))
  fireEvent.click(screen.getByText('Show all missing accounts'))
  expect(screen.getByText('Account 12')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Account 12' })).toBeNull()
})
