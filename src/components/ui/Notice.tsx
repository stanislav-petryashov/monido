import type { ReactNode } from 'react'

/**
 * A notice strip above the page's cards (Overview: setup skipped, open months; the proposals waiting for a vote). It
 * is its own --paper card rather than `Card`, which adds its padding; the strip has its own (`.notice`, with `.notice__text`
 * and `.notice__title` inside).
 */
export function Notice({ as: Tag = 'div', children, tone, title }: { as?: 'div' | 'p'; children: ReactNode; tone?: 'neutral' | 'warning' | 'subtle' | 'info'; title?: string }) {
  if (tone) return <Tag className={`notice notice--state notice--${tone}`}>
    {title && <strong className="notice__title">{title}</strong>}
    <span className="notice__text">{children}</span>
  </Tag>
  return <Tag className="notice mb-2">{children}</Tag>
}
