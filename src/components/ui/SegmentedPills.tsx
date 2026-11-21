import type { ReactNode } from 'react'

interface SegmentedPillsProps<T extends string | null> {
  appearance?: 'owners' | 'history'
  overflow?: 'scroll'
  items: readonly T[]
  /** null selects the family option when present, otherwise clears the selection. */
  active: T | null
  onSelect: (value: T) => void
  ariaLabel: string
  /** The caption of an item when it differs from its value */
  label?: (item: T) => ReactNode
  /** Why an item cannot be picked (its title); undefined — it can */
  disabledReason?: (item: T) => string | undefined
}

/** A switch made of pills: the active one is filled with --primary. */
export function SegmentedPills<T extends string | null>({ items, active, onSelect, ariaLabel, label, disabledReason, overflow, appearance }: SegmentedPillsProps<T>) {
  const groupClass = appearance === 'owners' ? 'acc-who' : appearance === 'history' ? 'capital-history__switch' : overflow === 'scroll' ? 'pills pills--scroll' : 'pills'
  const itemClass = appearance === 'owners' ? 'acc-who__chip' : appearance === 'history' ? undefined : 'pills__item'
  return (
    <div className={groupClass} role="group" aria-label={ariaLabel}>
      {items.map(item => (
        <button
          key={item === null ? 'family' : 'item:' + item}
          type="button"
          className={itemClass}
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
