import type { ReactNode } from 'react'

/**
 * The entry table of a Records screen: `.admin-table` in its sideways scroll wrapper, named for assistive technology. A new
 * table is drawn through it (tests/styles/sharedUi.test.ts freezes the native tables drawn elsewhere); `className` adds a
 * page's layout hook, never its own table look.
 */
export function EntryTable({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className="admin-table-scroll">
      <table className={className ? `admin-table ${className}` : 'admin-table'} aria-label={label}>{children}</table>
    </div>
  )
}
