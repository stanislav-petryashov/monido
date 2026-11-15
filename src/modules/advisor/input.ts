// Reading a request body for the advisor's site routes (server.ts) and its MCP tools (tools/*.ts): the same errors, byte for
// byte — 400 `missing_param` / `invalid_param` naming the parameter.
import { InputError } from '../../server/http'

/** The body as a record; anything that is not an object is an empty one. */
export const bodyOf = (body: unknown): Record<string, unknown> => (body !== null && typeof body === 'object' ? body : {}) as Record<string, unknown>

export const missing = (param: string): InputError => new InputError('missing_param', 400, { param })
export const invalid = (param: string): InputError => new InputError('invalid_param', 400, { param })

/** A required positive whole number: `missing_param` when absent, `invalid_param` when anything else. */
export function positiveInt(value: unknown, param: string): number {
  if (value === undefined || value === null) throw missing(param)
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw invalid(param)
  return value as number
}

/** A required string that is not empty: `missing_param` when absent, `invalid_param` when anything else. */
export function nonEmptyString(value: unknown, param: string): string {
  if (value === undefined || value === null) throw missing(param)
  if (typeof value !== 'string' || value === '') throw invalid(param)
  return value
}
