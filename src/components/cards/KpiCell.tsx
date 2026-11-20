import type { ReactNode } from 'react'

interface KpiCellProps {
  label: string
  /** Already formatted: the cell does not know what it shows */
  value: string
  /** The line under the number: the change against the month before, a share, a target */
  delta?: ReactNode
  /** The figure of the moment: its rule is `--primary` instead of `--rule` */
  current?: boolean
}

/** One figure of the Overview's KPI row (`ul.kpis`): the label, the number and a line under it, a rule on top. */
export function KpiCell({ label, value, delta, current = false }: KpiCellProps) {
  return (
    <li className={current ? 'kpi kpi--current' : 'kpi'}>
      <span className="figure-label">{label}</span>
      <strong className="kpi__value num">{value}</strong>
      {delta && <span className="kpi__meta">{delta}</span>}
    </li>
  )
}
