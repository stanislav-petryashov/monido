interface RecordKpisProps {
  /** The row's accessible name; a row under a visible heading may go without */
  label?: string
  cells: { key: string; label: string; value: string; meta: string | null; tone?: 'ok' | 'late'; bad?: boolean }[]
  className?: string
}

/** A row of facts (`.kpis--facts`) on a record or a section; callers supply already formatted figures. `tone` colours the line under a value as an assessment, `bad` the value. */
export function RecordKpis({ label, cells, className = '' }: RecordKpisProps) {
  return (
    <dl className={`kpis kpis--facts${className ? ` ${className}` : ''}`} aria-label={label}>
      {cells.map(c => (
        <div key={c.key} className="kpi">
          <dt className="figure-label">{c.label}</dt>
          <dd className={c.bad ? 'kpi__value kpi__value--bad num' : 'kpi__value num'}>{c.value}</dd>
          {c.meta && <dd className={c.tone ? `kpi__meta kpi__meta--${c.tone}` : 'kpi__meta'}>{c.meta}</dd>}
        </div>
      ))}
    </dl>
  )
}
