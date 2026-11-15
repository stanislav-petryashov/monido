import { fireEvent, screen, waitFor, within } from '@testing-library/react'

// shared by the tests of the Records screens

/** The Data screen's action row under the title (the title itself belongs to the shell) */
export const header = () => document.querySelector('.page-action-slot') as HTMLElement
/** The screen's main action once loaded: until then the button sits disabled in the header. */
export async function headerAction(name: string) {
  await waitFor(() => expect(within(header()).getByRole('button', { name })).toBeEnabled())
  return within(header()).getByRole('button', { name })
}

/**
 * Types `text` into a field as a keyboard does: what it held is cleared (kept with `append`: typed at its end), then one
 * character at a time — a masked field reads a whole text put in at once as a paste.
 */
export function typeText(input: HTMLElement, text: string, { append = false }: { append?: boolean } = {}) {
  if (!append) fireEvent.change(input, { target: { value: '' } })
  for (const ch of text) fireEvent.change(input, { target: { value: (input as HTMLInputElement).value + ch } })
}

/** Opens the account head's «···» menu (Accounts) and picks `item` from it */
export async function accountMenu(item: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Account actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name: item }))
}

/** A month's «Correct» on Accounts: the head's and the row's are one action under one name; the head's comes first */
export const correctButton = async (month: string) => (await screen.findAllByRole('button', { name: `Correct ${month}` }))[0]

/** Opens the property head's «···» menu (Real estate) and picks `item` from it */
export async function propertyMenu(item: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Property actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name: item }))
}

/** Real estate's «Enter the <year> valuation»: the new valuation's editor */
export const enterValuation = async () => fireEvent.click(await screen.findByRole('button', { name: /^Enter the \d{4} valuation$/ }))
