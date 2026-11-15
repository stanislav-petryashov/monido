/** Focuses the date field named `label` inside `root` through a blur: leaving it once shows why its text cannot be read (useDateText) */
export function revealUnreadDate(root: HTMLElement | null, label: string) {
  const date = [...(root?.querySelectorAll<HTMLInputElement>('input') ?? [])].find(input => input.getAttribute('aria-label') === label)
  date?.focus(); date?.blur(); date?.focus()
}
