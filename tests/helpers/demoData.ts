import type { AuthSettingsView, DemoDataResult } from '../../src/domain/api'
import { authSettingsView } from './authSettings'
import { jsonResponse, stubApi } from './http'

export const DEMO_RESULT: DemoDataResult = { loaded: true, language: 'en-US', currency: 'USD' }

/** The answer of /api/demo-data: a result, an error code, or a promise the test resolves (a request still running) */
type DemoAnswer = DemoDataResult | { code: string; status: number } | Promise<Response>

/**
 * stubApi plus: /api/auth-settings answers `view` (default: a password-mode family, nothing locked), /api/demo-data `answer`, /api/auth a signed-in family-password session.
 * Returns the fetch mock.
 */
export function stubDemo({ view = authSettingsView(), answer = DEMO_RESULT }: { view?: AuthSettingsView; answer?: DemoAnswer } = {}) {
  return stubApi().answer({
    'GET /api/auth-settings': () => jsonResponse(view),
    'GET /api/auth': () => jsonResponse({ mode: 'password', authenticated: true }),
    'POST /api/demo-data': () => {
      if (answer instanceof Promise) return answer
      return 'code' in answer ? jsonResponse({ error: { code: answer.code } }, answer.status) : jsonResponse(answer)
    },
  })
}

/** The bodies of the /api/demo-data requests, parsed */
export const demoBodies = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(c => String(c[0]) === '/api/demo-data').map(c => JSON.parse(String(c[1]?.body)) as Record<string, unknown>)
