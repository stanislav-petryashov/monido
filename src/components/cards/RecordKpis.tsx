interface RecordKpisProps {
  label: string
  cells: { key: string; label: string; value: string; meta: string | null }[]
  className?: string
}

/** The records' shared definition list; callers supply already formatted figures. */
export function RecordKpis({ label, cells, className = '' }: RecordKpisProps) {
  return (
    <dl className={`acc-kpis${className ? ` ${className}` : ''}`} aria-label={label}>
      {cells.map(c => (
        <div key={c.key} className="acc-kpi">
          <dt className="figure-label">{c.label}</dt>
          <dd className="acc-kpi__v num">{c.value}</dd>
          {c.meta && <dd className="acc-kpi__m">{c.meta}</dd>}
        </div>
      ))}
    </dl>
  )
}
