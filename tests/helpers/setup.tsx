import type { Mock } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type { AuthSettingsView, MonthCloseState, SetupView } from '../../src/domain/api'
import { SetupWizard } from '../../src/pages/setup/SetupWizard'
import { STEP_STORAGE_KEY } from '../../src/lib/setup'
import type { StepKey } from '../../src/pages/setup/useSetupWizard'
import { base as monthCloseBase } from './monthClose'
import { authSettingsView } from './authSettings'
import { type Answers, type ApiMock, jsonResponse, stubApi } from './http'
import { renderAdmin } from './render'
import type { QueryClient } from '@tanstack/react-query'

// the setup wizard's fixture, shared by tests/pages/setup/* and tests/components/SetupGate.test.tsx

interface StubOptions {
  setup?: Partial<SetupView>
  authSettings?: Partial<AuthSettingsView>
  members?: string[]
  currencies?: string[]
  monthClose?: Partial<MonthCloseState>
  /** answers laid over the wizard's server (stubApi's `answer`: by `METHOD url`, url or `METHOD *`; `next` is the wizard's own) */
  answer?: Answers
}

/**
 * The wizard's server: /api/setup (GET; PUT updates the state), /api/auth (password mode, signed in, with the setup state),
 * /api/auth-settings, /api/month-close, and stubApi's /api/settings and /api/admin/:table. Every call is
 * recorded by the returned fetch mock.
 */
export function stubSetupApi({ setup = {}, authSettings = {}, members = ['Robin', 'Noa'], currencies = ['USD'], monthClose = {}, answer = {} }: StubOptions = {}): ApiMock {
  let view: SetupView = { state: 'pending', hasData: false, hasAccounts: false, ...setup }
  return stubApi({
    members: members.map((name, i) => ({ rowid: i + 1, name })),
    currencies: currencies.map((code, i) => ({ rowid: i + 1, code })),
  }, {
    answer: {
      '/api/setup': init => {
        if (init?.method === 'PUT') view = { ...view, ...JSON.parse(String(init.body)) as Partial<SetupView> }
        return jsonResponse(view)
      },
      '/api/auth': () => jsonResponse({ mode: 'password', authenticated: true, setup: view.state }),
      '/api/auth-settings': () => jsonResponse(authSettingsView(authSettings)),
      '/api/month-close': () => jsonResponse({ ...monthCloseBase, rows: [], ...monthClose }),
    },
  }).answer(answer)
}

/** The wizard alone (renderAdmin), opened on `step` when given (kept in sessionStorage as the wizard keeps it). */
export function renderWizard({ again = false, step, client }: { again?: boolean; step?: StepKey; client?: QueryClient } = {}) {
  if (step) sessionStorage.setItem(STEP_STORAGE_KEY, step)
  return renderAdmin(<SetupWizard again={again} />, client ? { client } : {})
}

/** The requests the mock saw, as [method, url, body], optionally only those of one method. */
export function calls(fetchMock: Mock, method?: string): [string, string, unknown][] {
  return (fetchMock.mock.calls as [RequestInfo | URL, RequestInit | undefined][])
    .map(([input, init]) => [
      init?.method ?? 'GET', String(input), init?.body ? JSON.parse(String(init.body)) as unknown : undefined,
    ] as [string, string, unknown])
    .filter(([m]) => !method || m === method)
}

/** A step's button once it can be pressed: Start and Skip wait for the stored settings, so a press before is ignored */
export async function readyButton(name: string): Promise<HTMLElement> {
  const button = await screen.findByRole('button', { name })
  await waitFor(() => expect(button).toBeEnabled())
  return button
}
