import { Fragment, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { Me, SetupState } from '../../src/domain/api'
import { SetupGate } from '../../src/components/SetupGate'
import { applyFamilyLanguage } from '../../src/i18n/client'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { STEP_STORAGE_KEY } from '../../src/lib/setup'
import { deferred, jsonResponse } from '../helpers/http'
import { ru } from '../helpers/i18n'
import { renderAdmin } from '../helpers/render'
import { calls, readyButton, stubSetupApi } from '../helpers/setup'

const russianOption = () => document.querySelector<HTMLInputElement>('input[type="radio"][value="ru-RU"]')!
const person = (edit: boolean, manage: boolean): Me => ({ name: 'Robin', rights: { edit, vote: true, manage } })
const manageAndEdit = person(true, true)
const manageOnly = person(false, true)
const editOnly = person(true, false)
const none = person(false, false)

/** The gate remounted on a language switch, as App.tsx's PerLanguage does: the step must come back from sessionStorage. */
function PerLanguage({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  return <Fragment key={i18n.language}>{children}</Fragment>
}

function renderGate(setup: SetupState | null, me: Me | null, mode: 'password' | 'demo' = 'password') {
  setAuth({ mode, authenticated: true, me, setup })
  return renderAdmin(<PerLanguage><SetupGate><div>Shell</div></SetupGate></PerLanguage>)
}

beforeEach(() => { sessionStorage.clear(); window.history.replaceState(null, '', '/') })
afterEach(() => { sessionStorage.clear(); resetAuth() })

describe('SetupGate', () => {
  it.each([
    ['pending', manageAndEdit, 'wizard'],
    ['pending', manageOnly, 'shell'],
    ['pending', editOnly, 'shell'],
    ['pending', none, 'shell'],
    ['skipped', manageAndEdit, 'shell'],
    ['done', manageAndEdit, 'shell'],
  ] as const)('setup %s, rights %o: the %s', async (setup, me, shown) => {
    stubSetupApi()
    renderGate(setup, me)
    if (shown === 'shell') {
      expect(screen.getByText('Shell')).toBeInTheDocument()
      return
    }
    expect(await screen.findByRole('heading', { name: 'Set up your finances' })).toBeInTheDocument()
    expect(document.querySelector('main.setup')).not.toBeNull()
    expect(screen.queryByText('Shell')).toBeNull()
  })

  it('never fires in the demo', () => {
    stubSetupApi()
    renderGate(null, null, 'demo')
    expect(screen.getByText('Shell')).toBeInTheDocument()
  })

  it('keeps the step across a language switch', async () => {
    stubSetupApi()
    sessionStorage.setItem(STEP_STORAGE_KEY, 'data')
    renderGate('pending', manageAndEdit)
    await waitFor(() => expect(screen.getByRole('heading', {})).toHaveTextContent('Where shall we start?'))
    // a move made in this mount, so only the stored key can bring it back after the remount
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByRole('heading', {})).toHaveTextContent('Who owns the accounts'))
    try {
      await act(() => applyFamilyLanguage('ru-RU'))
      await waitFor(() => expect(screen.getByRole('heading', {})).toHaveTextContent(ru('data.setup.members.title')))
    } finally {
      await act(() => applyFamilyLanguage('en-US'))
    }
  })

  it('the first mount does not scroll; picking a language keeps the focus on the language control', async () => {
    stubSetupApi()
    const scroll = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll
    renderGate('pending', manageAndEdit)
    await waitFor(() => expect(screen.getByRole('heading', {})).toHaveTextContent('Set up your finances'))
    const option = russianOption()
    option.focus()
    try {
      fireEvent.click(option)
      await waitFor(() => expect(screen.getByRole('heading', {})).toHaveTextContent(ru('data.setup.welcomeTitle')))
      const picked = russianOption()
      expect(picked).not.toBe(option)
      await waitFor(() => expect(picked).toHaveFocus())
      expect(screen.getByRole('heading', {})).not.toHaveFocus()
      expect(scroll).not.toHaveBeenCalled()
    } finally {
      await act(() => applyFamilyLanguage('en-US'))
      Element.prototype.scrollIntoView = original
    }
  })

  it('"Exit setup" waits for the stored settings: before them a picked language could not be saved', async () => {
    const settings = deferred<Response>()
    stubSetupApi({ answer: { 'GET /api/settings': () => settings.promise } })
    renderGate('pending', manageAndEdit)
    const exit = await screen.findByRole('button', { name: 'Exit setup' })
    expect(exit).toBeDisabled()
    settings.resolve(jsonResponse({ language: 'en-US', currency: 'USD' }))
    await waitFor(() => expect(exit).toBeEnabled())
  })

  it('"Exit setup" saves the picked language before it puts skipped', async () => {
    const fetchMock = stubSetupApi()
    renderGate('pending', manageAndEdit)
    await waitFor(() => expect(screen.getByRole('heading', {})).toHaveTextContent('Set up your finances'))
    try {
      fireEvent.click(russianOption())
      await waitFor(() => expect(screen.getByRole('heading', {})).toHaveTextContent(ru('data.setup.welcomeTitle')))
      fireEvent.click(await readyButton(ru('data.setup.exit')))
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: ru('data.setup.exitConfirm') }))
      expect(await screen.findByText('Shell')).toBeInTheDocument()
      expect(calls(fetchMock, 'PUT')).toEqual([
        ['PUT', '/api/settings', { language: 'ru-RU' }],
        ['PUT', '/api/setup', { state: 'skipped' }],
      ])
    } finally {
      await act(() => applyFamilyLanguage('en-US'))
    }
  })

  it('"Exit setup" asks, then puts skipped, forgets the step and shows the shell', async () => {
    const fetchMock = stubSetupApi()
    sessionStorage.setItem(STEP_STORAGE_KEY, 'data')
    renderGate('pending', manageAndEdit)
    fireEvent.click(await readyButton('Exit setup'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Leave the setup?')
    expect(calls(fetchMock, 'PUT')).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave' }))
    expect(await screen.findByText('Shell')).toBeInTheDocument()
    expect(calls(fetchMock, 'PUT')).toEqual([['PUT', '/api/setup', { state: 'skipped' }]])
    expect(sessionStorage.getItem(STEP_STORAGE_KEY)).toBeNull()
  })
})
