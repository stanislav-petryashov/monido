import type { ReactNode } from 'react'

/** A caption on the left and its number on the right (`.cmp__row`): the stat lines of the cards and of Net worth */
export function StatRow({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={className ? `cmp__row ${className}` : 'cmp__row'}>
      <span>{label}</span>
      <span className="num">{value}</span>
    </div>
  )
}
