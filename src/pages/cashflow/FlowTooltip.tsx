/** A node's tooltip on the flow chart: its name, amount and share, and one sentence of what it means. Placed by the card. */
export function FlowTooltip({ id, name, amount, share, lines, left, top, onMouseEnter, onMouseLeave }: {
  id: string; name: string; amount: string; share: string; lines: string[]; left: number; top: number
  /** the pointer may rest on the tooltip: it stays */
  onMouseEnter: () => void; onMouseLeave: () => void
}) {
  return (
    <div id={id} role="tooltip" className="ch-tip cf-flow__tip" style={{ left, top }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <b>{name}</b>
      <div className="cf-flow__tip-fig"><span className="num">{amount}</span><span>{share}</span></div>
      {lines.map(line => <p key={line}>{line}</p>)}
    </div>
  )
}
