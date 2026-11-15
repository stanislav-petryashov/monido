// The key of a new goal, shared by the Goals screen in Records and the Advisor page's "Create goal".
import type { Row } from '../../domain/api'

/** The key of a new goal: `fire` for the financial-independence goal (the domain finds it by that), else the name as a slug, free among the existing goals. */
export function goalKey(form: Record<string, string>, rows: readonly Row[], isFire: boolean): string {
  if (isFire) return 'fire'
  const base = (form['name'] ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'goal'
  const taken = new Set(rows.map(r => String(r['id'])))
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`
  return key
}
