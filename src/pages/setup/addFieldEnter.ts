import type { KeyboardEvent } from 'react'

/**
 * The step form's onKeyDown where an add field (the members' or the currencies') sits in the form: Enter in that field with
 * text in it, or on an option of its list, adds and must not also submit the step; Enter in an empty one submits the step.
 */
export function keepAddFieldEnter(e: KeyboardEvent<HTMLFormElement>) {
  const field = e.target
  if (e.key !== 'Enter' || !(field instanceof HTMLInputElement) || field.type === 'radio') return
  if (field.value.trim() !== '' || field.getAttribute('aria-activedescendant')) e.preventDefault()
}
