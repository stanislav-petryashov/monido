import { fireEvent, render, screen } from '@testing-library/react'
import { PageError } from '../../src/components/PageError'

it('offers a retry and disables it while the read is running', () => {
  const retry = vi.fn()
  const { rerender } = render(<PageError onRetry={retry} />)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalledOnce()
  rerender(<PageError onRetry={retry} retrying />)
  expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
})

it('preserves an inline layout, custom message and retry action', () => {
  const retry = vi.fn()
  render(<PageError className="reminder-state" onRetry={retry}>Could not load reminders</PageError>)
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load reminders')
  expect(screen.getByRole('alert').parentElement).toHaveClass('reminder-state')
  expect(screen.getByRole('alert').parentElement).not.toHaveClass('page-error')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalledOnce()
})
