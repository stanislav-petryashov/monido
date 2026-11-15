import { screen, within } from '@testing-library/react'

/** An alert's own dismiss button: a notification card has one, an alert line inside a page section has none. */
const dismissible = (alert: HTMLElement) => within(alert).queryByRole('button', { name: 'Dismiss notification' }) !== null

/** The error notifications on the screen that say `text` (alert cards with a dismiss button). */
export const errorToasts = (text: string) =>
  screen.queryAllByRole('alert').filter(a => dismissible(a) && a.textContent!.includes(text))

/** The alerts inside the page that say `text`: not notifications. */
export const inlineAlerts = (text: string) =>
  screen.queryAllByRole('alert').filter(a => !dismissible(a) && a.textContent!.includes(text))
