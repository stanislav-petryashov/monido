import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  plain?: boolean
}

/** The one padded surface: no border or shadow. */
export function Card({ children, className = '', plain = false }: CardProps) {
  const cls = ['card', plain ? 'card--plain' : 'card--p', className].filter(Boolean).join(' ')
  return <div className={cls}>{children}</div>
}
