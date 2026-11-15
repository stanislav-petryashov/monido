import type { ReactNode } from 'react'

export interface ChoiceCardProps {
  /** The radio group's name */
  name: string
  value: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
  title: string
  /** The sentence under the title */
  children: ReactNode
}

/** One choice of a setup step: a real radio drawn as a card, with a title and a sentence */
export function ChoiceCard({ name, value, checked, disabled, onChange, title, children }: ChoiceCardProps) {
  return (
    <label className="setup-choice">
      <input type="radio" className="setup-choice__input" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="setup-choice__body">
        <span className="setup-choice__title">{title}</span>
        <span>{children}</span>
      </span>
    </label>
  )
}
