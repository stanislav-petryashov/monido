import type { ReactNode } from 'react'

/**
 * The entry table of a Records screen: `.admin-table` in its sideways scroll wrapper, named for assistive technology. A new
 * table is drawn through it (tests/styles/sharedUi.test.ts freezes the native tables drawn elsewhere); `className` adds a
 * page's layout hook, never its own table look.
 */
export function EntryTable({ label, className, reading = false, children }: { label: string; className?: string; reading?: boolean; children: ReactNode }) {
  const tableClass = reading ? 'page-table' : 'admin-table'
  return (
    <div className="admin-table-scroll">
      <table className={className ? `${tableClass} ${className}` : tableClass} aria-label={label}>{children}</table>
    </div>
  )
}
