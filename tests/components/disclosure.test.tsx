import { fireEvent, render, screen } from '@testing-library/react'
import { Disclosure } from '../../src/components/ui/Disclosure'

function toggle(open: boolean) {
  const details = document.querySelector('details')!
  details.open = open
  fireEvent(details, new Event('toggle'))
}

afterEach(() => window.history.replaceState(null, '', '/'))

it('mounts details on demand and preserves a draft while folded', () => {
  render(<Disclosure title="Details"><input aria-label="Draft" defaultValue="" /></Disclosure>)
  expect(screen.queryByRole('textbox')).toBeNull()
  toggle(true)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unsaved' } })
  toggle(false)
  toggle(true)
  expect(screen.getByRole('textbox')).toHaveValue('unsaved')
})

it('opens an anchored section on entry', () => {
  window.history.replaceState(null, '', '/cashflow#forecast')
  render(<Disclosure title="Forecast" anchor="forecast"><h2 id="forecast">Scenario</h2></Disclosure>)
  expect(document.querySelector('details')).toHaveAttribute('open')
  expect(screen.getByRole('heading', { name: 'Scenario' })).toBeInTheDocument()
})

it('a row carries its hint in the summary, beside a heading, and a row without one has none', () => {
  render(<Disclosure title="Forecasts" hint="4 accounts"><p>Inside</p></Disclosure>)
  const summary = document.querySelector('summary')!
  expect(summary).toHaveTextContent('Forecasts4 accounts')
  expect(screen.getByRole('heading', { name: 'Forecasts', level: 2 })).toBeInTheDocument()
  expect(summary.querySelector('.disclosure__chevron')).not.toBeNull()
  document.body.innerHTML = ''
  render(<Disclosure title="Plain"><p>Inside</p></Disclosure>)
  expect(document.querySelector('.disclosure__hint')).toBeNull()
})

it('a list row takes a span for its title, so its columns are not a heading', () => {
  render(<Disclosure title={<span>Account</span>} titleAs="span"><p>Inside</p></Disclosure>)
  expect(screen.queryByRole('heading')).toBeNull()
})

it('an inline one keeps its content in the document while closed and has no heading', () => {
  render(<Disclosure variant="inline" title="Details"><p>Note</p></Disclosure>)
  expect(document.querySelector('details')).not.toHaveAttribute('open')
  expect(screen.getByText('Note')).toBeInTheDocument()
  expect(screen.queryByRole('heading')).toBeNull()
  expect(document.querySelector('summary .disclosure__chevron')).not.toBeNull()
})

it('marks a row visited only once its content has arrived, so the first opening is not animated into an empty body', () => {
  render(<Disclosure title="Details"><p>Note</p></Disclosure>)
  const details = document.querySelector('details')!
  expect(details).not.toHaveAttribute('data-visited')
  toggle(true)
  expect(details).toHaveAttribute('data-visited')
})

it('an eager row mounts its content while folded', () => {
  render(<Disclosure title="Account" eager><input aria-label="Draft" /></Disclosure>)
  expect(screen.getByRole('textbox')).toBeInTheDocument()
})

it('an owner decides through open, and hears the toggle', () => {
  const onToggle = vi.fn()
  const { rerender } = render(<Disclosure title="Review" open={false} onToggle={onToggle}><p>Note</p></Disclosure>)
  expect(document.querySelector('details')).not.toHaveAttribute('open')
  rerender(<Disclosure title="Review" open onToggle={onToggle}><p>Note</p></Disclosure>)
  expect(document.querySelector('details')).toHaveAttribute('open')
  toggle(false)
  expect(onToggle).toHaveBeenCalledWith(false)
})
