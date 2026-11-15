import { render, screen } from '@testing-library/react'
import { Loading } from '../../src/components/ui/Loading'
import { LoadingScreen } from '../../src/pages/admin/ui/LoadingScreen'

it('announces loading with the default or caller layout', () => {
  const { rerender } = render(<Loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(screen.getByRole('status')).toHaveClass('page-loading')
  rerender(<Loading className="reminder-state" />)
  expect(screen.getByRole('status')).toHaveClass('reminder-state')
  expect(screen.getByRole('status')).not.toHaveClass('page-loading')
})

it('keeps the admin loading layout and announces its state', () => {
  render(<LoadingScreen action="Add" />)
  expect(screen.getByRole('status')).toHaveClass('admin-empty')
})
