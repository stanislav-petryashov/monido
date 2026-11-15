import { serializeSigned } from 'hono/utils/cookie'
import type { AuthRuntime } from '../../src/server/authSettings'

/** A password for tests that need a signed-in family and do not care about the sign-in itself (≥ 8 characters). */
export const FAMILY_PASSWORD = 'test family password'

async function cookie(value: string, auth: Pick<AuthRuntime, 'signingKey'>): Promise<string> {
  return (await serializeSigned('session', value, auth.signingKey())).split(';')[0]
}

/**
 * The session cookie of the family password (password mode; all rights), signed with the runtime's current key, so
 * read it again after a password change or a mode switch.
 */
export const familyCookie = (auth: Pick<AuthRuntime, 'signingKey'>) => cookie(String(Date.now()), auth)

/**
 * The session cookie of `userId` in telegram mode (the rights of the users row). The user needs a telegram_id; the
 * credential is issued a few ms ahead so it is strictly after the row's created_at, as the server requires.
 */
export const userCookie = (auth: Pick<AuthRuntime, 'signingKey'>, userId: number, issuedAt = Date.now() + 5) => cookie(`${userId}.${issuedAt}`, auth)

type Requester = { request: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response> }

/** `app` whose every request carries the cookie (given as a value or a function read at each request). */
export function withCookie(app: Requester, cookieOf: string | (() => string | Promise<string>)): Requester {
  return {
    async request(input, init = {}) {
      const headers = new Headers(init.headers)
      headers.set('Cookie', typeof cookieOf === 'string' ? cookieOf : await cookieOf())
      return app.request(input, { ...init, headers })
    },
  }
}
