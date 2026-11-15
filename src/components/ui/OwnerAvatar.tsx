import type { CSSProperties } from 'react'
import { memberTint } from './memberTint'

/** An owner's initial on the pale tint of their colour; a name outside the family is plain. `name` is what is shown, the member by default. */
export function OwnerAvatar({ member, members, name = member }: { member: string; members: string[]; name?: string }) {
  const tint = memberTint(member, members)
  return tint === null
    ? <span className="lane__avatar" aria-hidden="true">{[...name][0]}</span>
    : <span className="lane__avatar lane__avatar--tinted" aria-hidden="true" style={{ '--tag': `var(--${tint})` } as CSSProperties}>{[...name][0]}</span>
}
