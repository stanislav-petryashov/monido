import { render, screen } from '@testing-library/react'
import { Loading } from '../../src/components/ui/Loading'
import { LoadingScreen } from '../../src/pages/admin/ui/LoadingScreen'

it('shows placeholders, never the word: a page skeleton, a section\'s lines or nothing before the shell', () => {
  // the word stays for a screen reader only
  const { rerender, container } = render(<Loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(screen.getByText('Loading…')).toHaveClass('sr-only')
  expect(container.querySelectorAll('.skeleton-card')).not.toHaveLength(0)
  rerender(<Loading className="reminder-state" />)
  expect(screen.getByRole('status')).toHaveClass('reminder-state')
  expect(screen.getByText('Loading…')).toHaveClass('sr-only')
  expect(container.querySelectorAll('.skeleton-lines .skeleton')).toHaveLength(3)
  rerender(<Loading quiet />)
  expect(screen.getByRole('status')).toHaveClass('sr-only')
  expect(container.querySelector('.skeleton')).toBeNull()
})

it('keeps the admin loading layout and announces its state', () => {
  render(<LoadingScreen action="Add" />)
  expect(screen.getByRole('status')).toHaveClass('admin-empty')
})
