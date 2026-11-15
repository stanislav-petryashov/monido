interface SegmentedPillsProps<T extends string> {
  overflow?: 'scroll'
  items: readonly T[]
  /** null — none is pressed */
  active: T | null
  onSelect: (value: T) => void
  ariaLabel: string
  /** The caption of an item when it differs from its value */
  label?: (item: T) => string
  /** Why an item cannot be picked (its title); undefined — it can */
  disabledReason?: (item: T) => string | undefined
}

/** A switch made of pills: the active one is filled with --primary. */
export function SegmentedPills<T extends string>({ items, active, onSelect, ariaLabel, label, disabledReason, overflow }: SegmentedPillsProps<T>) {
  return (
    <div className={overflow === 'scroll' ? 'pills pills--scroll' : 'pills'} role="group" aria-label={ariaLabel}>
      {items.map(item => (
        <button
          key={item}
          type="button"
          className="pills__item"
          aria-pressed={item === active}
          disabled={disabledReason?.(item) !== undefined}
          title={disabledReason?.(item)}
          onClick={() => onSelect(item)}
        >
          {label ? label(item) : item}
        </button>
      ))}
    </div>
  )
}
