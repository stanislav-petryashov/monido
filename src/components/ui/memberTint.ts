const TONES = ['member-1', 'member-2', 'member-3', 'member-4'] as const

/** A member's colour token by their place in the family (a fifth member takes the first again); null for no member or a stranger */
export const memberTint = (member: string, members: string[]): typeof TONES[number] | null => {
  const i = members.indexOf(member)
  return i < 0 ? null : TONES[i % TONES.length]
}
