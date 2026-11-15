import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { jsonResponse } from '../../helpers/http'
import { calls, readyButton, renderWizard, stubSetupApi } from '../../helpers/setup'
import { STEP_STORAGE_KEY } from '../../../src/lib/setup'

const liveLine = () => document.querySelector('p[aria-live="polite"]')
const stepItems = () => within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem')
const heading = () => screen.getByRole('heading', {})

beforeEach(() => sessionStorage.clear())
afterEach(() => { sessionStorage.clear() })

describe('SetupWizard', () => {
  it('lists four steps in order', async () => {
    stubSetupApi()
    renderWizard()
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 1 of 4 · Welcome'))
    expect(stepItems().map(li => li.textContent)).toEqual(['1Welcome', '2Data', '3Account owners', '4Currencies'])
    expect(stepItems()[0]).toHaveAttribute('aria-current', 'step')
    expect(stepItems().filter(li => li.hasAttribute('aria-current'))).toHaveLength(1)
  })

  it.each([
    { authSettings: { mode: 'telegram' as const } },
    { authSettings: { locked: true } },
    { setup: { hasAccounts: true } },
  ])('keeps all four steps regardless of sign-in mode and existing accounts (%o)', async options => {
    stubSetupApi(options)
    renderWizard()
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 1 of 4 · Welcome'))
    expect(stepItems()).toHaveLength(4)
  })

  it('a failed start read is said on Welcome, and Try again recovers without changing the steps', async () => {
    let up = false
    stubSetupApi({ answer: { 'GET /api/setup': () => up ? jsonResponse({ state: 'pending', hasData: false, hasAccounts: false }) : jsonResponse({ error: { code: 'boom' } }, 500) } })
    renderWizard()
    expect(await screen.findByText('Could not read the setup state. Try loading it again.')).toBeInTheDocument()
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 1 of 4 · Welcome'))
    up = true
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 1 of 4 · Welcome'))
    expect(screen.queryByText('Could not read the setup state. Try loading it again.')).toBeNull()
  })

  it('shows the title alone until the setup query answers', async () => {
    let release!: () => void
    const answered = new Promise<void>(resolve => { release = resolve })
    stubSetupApi({ answer: { 'GET /api/setup': async () => { await answered; return jsonResponse({ state: 'pending', hasData: false, hasAccounts: false }) } } })
    renderWizard()
    await waitFor(() => expect(liveLine()).toHaveTextContent('Welcome'))
    expect(liveLine()!.textContent).toBe('Welcome')
    expect(screen.queryByRole('list', { name: 'Setup steps' })).toBeNull()
    await act(async () => { release() })
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 1 of 4 · Welcome'))
  })

  it('keeps four steps even when setup reading fails', async () => {
    stubSetupApi({ answer: {
      'GET /api/auth-settings': () => jsonResponse({ error: { code: 'load_failed' } }, 500),
      'GET /api/setup': () => jsonResponse({ error: { code: 'load_failed' } }, 500),
    } })
    renderWizard()
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 1 of 4 · Welcome'))
  })

  it('a stored step of the old Modules step opens Welcome', async () => {
    stubSetupApi()
    renderWizard({ step: 'modules' as never })
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 1 of 4 · Welcome'))
  })

  it('opens the stored step and ignores a key not in the list', async () => {
    stubSetupApi({ setup: { hasAccounts: true } })
    const first = renderWizard({ step: 'accounts' as never })
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 1 of 4 · Welcome'))
    first.unmount()
    renderWizard({ step: 'currencies' })
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 4 of 4 · Currencies'))
    expect(heading()).toHaveTextContent('Which currencies do you use?')
    expect(heading()).toHaveFocus()
  })

  it('opens Welcome when sessionStorage throws', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() {}, clear() {},
    })
    stubSetupApi()
    renderWizard()
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 1 of 4 · Welcome'))
    fireEvent.click(await readyButton('Start'))
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 2 of 4 · Data'))
  })

  it('Back never writes; a done step is a button that jumps back', async () => {
    const fetchMock = stubSetupApi()
    renderWizard({ step: 'members' })
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 3 of 4 · Account owners'))
    // the upcoming steps are not buttons, the done ones are and say so
    expect(screen.queryByRole('button', { name: /Currencies/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Welcome done' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 2 of 4 · Data'))
    expect(sessionStorage.getItem(STEP_STORAGE_KEY)).toBe('data')
    fireEvent.click(screen.getByRole('button', { name: 'Welcome done' }))
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 1 of 4 · Welcome'))
    expect(calls(fetchMock, 'PUT')).toEqual([])
  })

  it('the h2 takes the focus on a step change and the live region announces it', async () => {
    stubSetupApi()
    renderWizard({ step: 'data' })
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 2 of 4 · Data'))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 3 of 4 · Account owners'))
    expect(heading()).toHaveTextContent('Who owns the accounts')
    expect(heading()).toHaveFocus()
    expect(heading()).toHaveAttribute('tabindex', '-1')
  })

  it('a re-run left on Welcome does not stop the first run that follows (a wipe) from focusing its heading', async () => {
    stubSetupApi({ setup: { state: 'done' } })
    const rerun = renderWizard({ again: true })
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 1 of 4'))
    // a re-run's mount leaves the focus to the shell
    expect(heading()).not.toHaveFocus()
    rerun.unmount()
    renderWizard()
    await waitFor(() => expect(liveLine()).toHaveTextContent('Step 1 of 4'))
    await waitFor(() => expect(heading()).toHaveFocus())
  })
})
