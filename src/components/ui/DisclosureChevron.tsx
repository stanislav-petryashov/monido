import { IconChevronDown } from '@tabler/icons-react'

/** The one chevron of everything that folds; `details[open]` turns it. Its own file: the initial load has `<details>` of its own and should not carry Disclosure. */
export function DisclosureChevron({ size = 18 }: { size?: 16 | 18 }) {
  return <IconChevronDown className="disclosure__chevron" size={size} stroke={1.75} aria-hidden="true" />
}
