import { fireEvent, screen, within } from '@testing-library/react'
import { base, renderScreen, stubState } from '../../helpers/monthClose'

it('keeps flows folded under a named owner and edits them without leaving the account', async () => {
  stubState(base)
  renderScreen()
  const owner = await screen.findByRole('region', { name: 'Robin' })
  const row = within(owner).getByText('Quillmark Bank', { selector: '.close-table__account' }).closest('tr')!
  const toggle = within(row).getByRole('button', { expanded: false, name: /Enter amounts/ })
  expect(screen.queryByRole('textbox', { name: 'Expense: Quillmark Bank' })).toBeNull()
  fireEvent.click(toggle)
  const expense = screen.getByRole('textbox', { name: 'Expense: Quillmark Bank' })
  fireEvent.change(expense, { target: { value: '25' } })
  fireEvent.click(toggle)
  fireEvent.click(toggle)
  expect(expense).toHaveValue('25')
})
