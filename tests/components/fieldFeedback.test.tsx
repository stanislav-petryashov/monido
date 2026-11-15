import { render, screen } from '@testing-library/react'
import { Field } from '../../src/pages/admin/ui/Field'

it('keeps the input, draft and focus when an error appears or clears', () => {
  const form = (error?: string) => <Field label="Name" error={error}><input defaultValue="Draft" aria-invalid={!!error || undefined} /></Field>
  const { rerender } = render(form())
  const input = screen.getByRole('textbox', { name: 'Name' })
  input.focus()
  rerender(form('Name already exists'))
  expect(screen.getByRole('textbox')).toBe(input)
  expect(input).toHaveFocus()
  expect(input).toHaveValue('Draft')
  expect(input).toHaveAccessibleDescription('Name already exists')
  expect(screen.getByRole('alert')).toHaveTextContent('Name already exists')
  rerender(form())
  expect(screen.getByRole('textbox')).toBe(input)
  expect(input).toHaveFocus()
  expect(input).not.toHaveAttribute('aria-describedby')
})

it('preserves the control description alongside the field hint', () => {
  render(<><p id="existing">Existing message</p><Field label="Amount" hint="In dollars"><input aria-describedby="existing" /></Field></>)
  expect(screen.getByRole('textbox')).toHaveAccessibleDescription('In dollars Existing message')
})

it('keeps group captions outside radio options even with an inset preference', () => {
  render(<Field label="Currency" variant="inset" group><div role="radiogroup"><input type="radio" aria-label="USD" /></div></Field>)
  expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Currency')
  expect(screen.getByRole('radio').closest('label')).toBeNull()
  expect(document.querySelector('.field--inset')).toBeNull()
})
