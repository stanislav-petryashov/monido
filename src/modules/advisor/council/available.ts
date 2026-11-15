// Where the council works: Telegram sign-in and a signed-in user. One rule for the site's routes, the MCP tools and the
// store's `propose`, one refusal (409 `advisor.council_unavailable`).
import type { AuthMode } from '../../../domain/api'
import { InputError, type Actor } from '../../../server/http'

/** Whether the council works for this request: Telegram sign-in and a signed-in user. */
export const councilAvailable = ({ authMode, actor }: { authMode: AuthMode; actor: Actor }): boolean =>
  authMode === 'telegram' && actor.userId !== null

/** The signed-in user's id, whatever the sign-in mode; 409 `advisor.council_unavailable` when there is none. */
export function councilUser(actor: Actor): number {
  if (actor.userId === null) throw new InputError('advisor.council_unavailable', 409)
  return actor.userId
}

/** The user's id when the council works for this request; else 409 `advisor.council_unavailable`. */
export function requireCouncilUser(authMode: AuthMode, actor: Actor): number {
  if (authMode !== 'telegram') throw new InputError('advisor.council_unavailable', 409)
  return councilUser(actor)
}
