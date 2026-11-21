import { fireEvent, screen } from '@testing-library/react'
import { HouseholdReview } from '../../src/pages/overview/HouseholdReview'
import { demoFamilyData } from '../helpers/demoFamily'
import { renderWithSnapshot, stubPrivacyOn } from '../helpers/render'

const { snapshot } = await demoFamilyData()
const show = (s = snapshot) => renderWithSnapshot(<HouseholdReview snapshot={s} />, s)

it('compares the latest closed month and expands its spending categories', () => {
  show()
  expect(screen.getByRole('heading', { name: 'September for the family' })).toBeVisible()
  expect(screen.getByText('August 2026')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
  const expand = screen.getByRole('button', { name: /All categories/ })
  expect(screen.getAllByRole('listitem')).toHaveLength(4)
  fireEvent.click(expand)
  expect(screen.getAllByRole('listitem').length).toBeGreaterThan(4)
  expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true')
})

it('shows missing months and partial amounts without substituting a previous month', () => {
  show({ ...snapshot, capitalChange: [...snapshot.capitalChange!, { month: '2026-10', reason: 'no_balance' }] })
  expect(screen.getByRole('heading', { name: 'October for the family' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Expenses' })).toBeNull()
  expect(screen.queryByRole('list')).toBeNull()
})

it('masks amounts and omits proportional bars in privacy mode', () => {
  stubPrivacyOn()
  const { container } = show()
  expect(container.textContent).toContain('•••')
  expect(container.textContent).not.toContain('$')
  expect(container.querySelector('.household-review__track')).toBeNull()
})
