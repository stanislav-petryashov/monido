interface SwitchProps {
  checked: boolean
  /** Accessible name: the name of what is being switched */
  label: string
  disabled?: boolean
  onChange: (next: boolean) => void
}

/** A switch: on is --primary, off is --track. */
export function Switch({ checked, label, disabled, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      // aria-disabled rather than the disabled attribute: a disabled button loses the focus to <body>
      aria-disabled={disabled || undefined}
      className="switch"
      onClick={() => { if (!disabled) onChange(!checked) }}
    >
      <span className="switch__thumb" aria-hidden="true" />
    </button>
  )
}
