import { createElement } from 'react'
import type { TablerIcon } from '@tabler/icons-react'
import { toneStyle, type SemanticColor } from './types'

/** sm — a notification, lg — a confirmation window */
const SIZE = { sm: { box: 30, icon: 17 }, lg: { box: 72, icon: 36 } } as const

interface AvatarProps {
  icon: TablerIcon
  color: SemanticColor
  size: keyof typeof SIZE
}

/** An icon on a square tinted with the colour's pale shade. */
export function Avatar({ icon, color, size }: AvatarProps) {
  const s = SIZE[size]
  return (
    <span className="avatar" data-color={color} aria-hidden="true" style={{ ...toneStyle(color), width: s.box, height: s.box }}>
      {createElement(icon, { size: s.icon, stroke: 2 })}
    </span>
  )
}
