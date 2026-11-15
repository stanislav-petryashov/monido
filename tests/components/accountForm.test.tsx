import { fireEvent, screen } from '@testing-library/react'
import type { DraftRow } from '../../src/domain/monthClose'
import { AccountForm, type AccountFormValues } from '../../src/pages/admin/AccountForm'
import { draftAccountOrError } from '../../src/pages/admin/useMonthClose'
import { renderAdmin } from '../helpers/render'

const card: DraftRow = { name: 'Card', member: 'Robin', currency: 'USD', class: 'bank', balance: null, active: null, passive: null, expense: null, closing: false, added: true }

/** The form over `rows` with the draft's rules (as Close month and the setup's accounts step wire it) */
function renderForm(rows: DraftRow[] = []) {
  const added: DraftRow[] = []
  const onAdd = vi.fn((values: AccountFormValues) => {
    const result = draftAccountOrError(values, rows)
    if ('error' in result) return result.error
    added.push(result.row)
    return null
  })
  const onCancel = vi.fn()
  renderAdmin(<AccountForm members={['Robin', 'Noa']} currencies={['USD', 'EUR']} suggestions={[]} onAdd={onAdd} onCancel={onCancel} />)
  const name = screen.getByRole('combobox', { name: 'Name' })
  return { added, onAdd, onCancel, name }
}

describe('AccountForm', () => {
  it('an empty name is refused with its reason', () => {
    const { added, name } = renderForm()
    fireEvent.change(name, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Noa' }))
    fireEvent.click(screen.getByRole('radio', { name: 'EUR' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Enter an account name')
    expect(name).toHaveFocus()
    expect(added).toEqual([])
    fireEvent.change(name, { target: { value: 'Cash' } })
    expect(name).not.toHaveAttribute('aria-invalid')
    expect(screen.getByRole('radio', { name: 'Noa' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'EUR' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(added[0]).toMatchObject({ name: 'Cash', member: 'Noa', currency: 'EUR' })
  })

  it('an account already in the draft shows the duplicate error', () => {
    const { added, name } = renderForm([card])
    fireEvent.change(name, { target: { value: ' Card ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('alert')).toHaveTextContent('This account is already in the month')
    expect(added).toEqual([])
  })

  it('adds the trimmed name with the picked member and currency', () => {
    const { added, name } = renderForm([card])
    fireEvent.change(name, { target: { value: ' Cash ' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Noa' }))
    fireEvent.click(screen.getByRole('radio', { name: 'EUR' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(added).toEqual([{ ...card, name: 'Cash', member: 'Noa', currency: 'EUR' }])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('allows a draft account without an owner', () => {
    const onAdd = vi.fn(() => null)
    renderAdmin(<AccountForm members={[]} currencies={['USD']} suggestions={[]} onAdd={onAdd} onCancel={() => {}} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Name' }), { target: { value: 'Cash' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cash', member: '', currency: 'USD' }))
  })

  it('Escape cancels', () => {
    const { onCancel, onAdd, name } = renderForm()
    fireEvent.keyDown(name, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onAdd).not.toHaveBeenCalled()
  })
})
