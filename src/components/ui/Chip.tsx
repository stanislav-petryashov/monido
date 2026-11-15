import type { ReactNode } from 'react'
import { toneTextStyle, type SemanticColor } from './types'

interface ChipProps {
  children: ReactNode
  color?: SemanticColor
}

/** A tinted label: status, trend, health zone. */
export function Chip({ children, color = 'secondary' }: ChipProps) {
  return (
    <span className="chip" data-color={color} style={toneTextStyle(color)}>
      {children}
    </span>
  )
}
