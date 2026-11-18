import { fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react'
import { resetAuth, setAuth, useAuth } from '../../src/lib/authState'
import { IconTrash } from '@tabler/icons-react'
import { DangerDialog } from '../../src/pages/admin/DangerDialog'
import { DangerZone } from '../../src/pages/admin/DangerZone'
import { STEP_STORAGE_KEY } from '../../src/lib/setup'
import { authSettingsView } from '../helpers/authSettings'
import { DEMO_RESULT, stubDemo } from '../helpers/demoData'
import { jsonResponse, stubApi } from '../helpers/http'
import { renderAdmin, testClient } from '../helpers/render'
import { errorToasts } from '../helpers/toasts'
import { stubDownload } from '../helpers/download'

/** /api/wipe answers `answer`; everything else as stubDemo (the Sign-in settings for the load's button). */
function stubWipe(answer: { ok: true } | { code: string; status: number }) {
  return stubDemo().answer({
    'POST /api/wipe': () => 'ok' in answer ? jsonResponse({ wiped: true }) : jsonResponse({ error: { code: answer.code } }, answer.status),
  })
}

const wipeCalls = (fetchMock: ReturnType<typeof stubApi>) => fetchMock.mock.calls.filter(c => String(c[0]) === '/api/wipe')

function openZone() {
  const title = screen.queryByText('Replace or delete data')
  if (!title) return
  const details = title.closest('details')!
  if (!details.open) {
    details.open = true
    fireEvent(details, new Event('toggle'))
  }
}

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete all family data' }))
  const dialog = screen.getByRole('dialog', { name: 'Delete all family data?' })
  return { dialog, word: within(dialog).getByRole('textbox'), button: within(dialog).getByRole('button', { name: 'Delete everything' }) }
}

describe('DangerZone', () => {
  beforeEach(() => window.history.replaceState(null, '', '/settings/backup'))
  afterEach(() => { resetAuth(); sessionStorage.clear() })

  it('says what is deleted and what is kept; the copy is the Backup page\'s own button, not repeated here', () => {
    stubDemo()
    renderAdmin(<DangerZone />)
    openZone()
    const zone = screen.getByRole('heading', { name: 'Replace or delete data' }).closest('details')!
    expect(within(zone).getByRole('heading', { name: 'Replace or delete data' })).toBeInTheDocument()
    expect(within(zone).getByText(/Kept: the family language and currency/)).toBeInTheDocument()
    expect(within(zone).queryByRole('button', { name: 'Download backup' })).toBeNull()
  })

  it('offers a database copy in the dialog, before the word', async () => {
    const fetchMock = stubWipe({ ok: true })
    // jsdom cannot navigate to a file link: the download's own click on its <a> is stubbed
    const { anchorClick } = stubDownload()
    const backups = () => fetchMock.mock.calls.filter(c => String(c[0]) === '/api/backup')
    renderAdmin(<DangerZone />)
    openZone()
    const { dialog, word } = openDialog()
    expect(within(dialog).getAllByRole('button').map(b => b.textContent).slice(-2)).toEqual(['Cancel', 'Delete everything'])
    const copy = within(dialog).getByRole('button', { name: 'Download backup' })
    // offered before the confirmation word
    expect(copy.compareDocumentPosition(word) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(copy)
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1))
    expect(backups()).toHaveLength(1)
    // the dialog stays open and nothing is deleted
    expect(screen.getByRole('dialog', { name: 'Delete all family data?' })).toBeInTheDocument()
    expect(wipeCalls(fetchMock)).toEqual([])
  })

  it('DangerZone enables the button only on the exact word', async () => {
    const fetchMock = stubWipe({ ok: true })
    const client = testClient()
    const reset = vi.spyOn(client, 'resetQueries')
    renderAdmin(<DangerZone />, { client })
    openZone()
    const { word, button } = openDialog()
    expect(button).toBeDisabled()
    for (const typed of ['delete', 'DELET', ' DELETE', 'DELETE ', 'DELETED']) {
      fireEvent.change(word, { target: { value: typed } })
      expect(button, typed).toBeDisabled()
    }
    // Enter in the field with the wrong word deletes nothing
    fireEvent.submit(word.closest('form')!)
    expect(wipeCalls(fetchMock)).toEqual([])
    fireEvent.change(word, { target: { value: 'DELETE' } })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(wipeCalls(fetchMock)).toHaveLength(1)
    expect(wipeCalls(fetchMock)[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ confirm: true }) })
    // every query is dropped and read again: the app opens as a fresh install, no old number on the way
    expect(reset).toHaveBeenCalledWith()
    expect(screen.getByText('All family data deleted')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancelling deletes nothing', async () => {
    const fetchMock = stubWipe({ ok: true })
    renderAdmin(<DangerZone />)
    openZone()
    const { dialog, word } = openDialog()
    fireEvent.change(word, { target: { value: 'DELETE' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(wipeCalls(fetchMock)).toEqual([])
    expect(window.location.pathname).toBe('/settings/backup')
    // the word is asked again the next time
    expect(openDialog().button).toBeDisabled()
  })

  it('re-reads /api/auth after a wipe, before going to Overview', async () => {
    /** the address at each read of /api/auth: the re-read must come before the navigation */
    const authAt: string[] = []
    const fetchMock = stubWipe({ ok: true }).answer({
      'GET /api/auth': () => {
        authAt.push(window.location.pathname)
        return jsonResponse({ mode: 'password', authenticated: true, setup: 'pending' })
      },
    })
    sessionStorage.setItem(STEP_STORAGE_KEY, 'modules')
    const auth = renderHook(() => useAuth())
    renderAdmin(<DangerZone />)
    openZone()
    const { word, button } = openDialog()
    fireEvent.change(word, { target: { value: 'DELETE' } })
    fireEvent.click(button)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    const calls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(calls.indexOf('/api/wipe')).toBeGreaterThanOrEqual(0)
    expect(calls.lastIndexOf('/api/auth')).toBeGreaterThan(calls.indexOf('/api/wipe'))
    expect(authAt.at(-1)).toBe('/settings/backup')
    expect(auth.result.current.setup).toBe('pending')
    // the wizard that follows starts at Welcome
    expect(sessionStorage.getItem(STEP_STORAGE_KEY)).toBeNull()
  })

  it('a refusal is shown and the page stays', async () => {
    stubWipe({ code: 'not_in_demo', status: 403 })
    renderAdmin(<DangerZone />)
    openZone()
    const { word, button } = openDialog()
    fireEvent.change(word, { target: { value: 'DELETE' } })
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByText('Could not delete the data')).toBeInTheDocument())
    expect(screen.getByText('Not available in the demo')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/settings/backup')
  })

  it('is not shown in the demo', () => {
    const fetchMock = stubApi()
    setAuth({ mode: 'demo' })
    renderAdmin(<DangerZone />)
    openZone()
    expect(screen.queryByRole('heading', { name: 'Replace or delete data' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete all family data' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load test data' })).not.toBeInTheDocument()
    // the availability does not read the Sign-in settings in the demo
    expect(fetchMock.mock.calls.map(c => String(c[0]))).not.toContain('/api/auth-settings')
  })
})

describe('DangerZone: Load test data', () => {
  beforeEach(() => window.history.replaceState(null, '', '/settings/backup'))
  afterEach(() => { resetAuth() })

  const loadButton = () => screen.getByRole('button', { name: 'Load test data' })
  const wipeButton = () => screen.getByRole('button', { name: 'Delete all family data' })

  it('offers "Load test data" before the wipe button, with the note sentence', async () => {
    stubDemo()
    renderAdmin(<DangerZone />)
    openZone()
    const zone = screen.getByRole('heading', { name: 'Replace or delete data' }).closest('details')!
    const load = within(zone).getByRole('button', { name: 'Load test data' })
    expect(load).toHaveClass('btn', 'btn--ghost')
    expect(load.compareDocumentPosition(wipeButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wipeButton()).toHaveClass('btn--danger')
    expect(within(zone).getByText(/Replaces current data with a fictional family/)).toBeInTheDocument()
    await waitFor(() => expect(load).toBeEnabled())
  })

  it('loading: the word, then resetQueries, /api/auth read again, navigation to /', async () => {
    const authAt: string[] = []
    const fetchMock = stubDemo().answer({
      'GET /api/auth': (_, next) => { authAt.push(window.location.pathname); return next() },
    })
    const client = testClient()
    const reset = vi.spyOn(client, 'resetQueries')
    sessionStorage.setItem(STEP_STORAGE_KEY, 'members')
    renderAdmin(<DangerZone />, { client })
    openZone()
    await waitFor(() => expect(loadButton()).toBeEnabled())
    fireEvent.click(loadButton())
    const dialog = screen.getByRole('dialog', { name: 'Load test data?' })
    const confirm = within(dialog).getByRole('button', { name: 'Delete everything and load' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'DELETE' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls.lastIndexOf('/api/auth')).toBeGreaterThan(urls.indexOf('/api/demo-data'))
    // read again before the navigation, still on the Backup page
    expect(authAt.at(-1)).toBe('/settings/backup')
    expect(reset).toHaveBeenCalledWith()
    expect(sessionStorage.getItem(STEP_STORAGE_KEY)).toBeNull()
    expect(screen.getByText('Test data loaded')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('both buttons are disabled while the wipe request runs', async () => {
    let finish!: (r: Response) => void
    stubDemo().answer({ 'POST /api/wipe': () => new Promise<Response>(r => { finish = r }) })
    renderAdmin(<DangerZone />)
    openZone()
    await waitFor(() => expect(loadButton()).toBeEnabled())
    const { word, button } = openDialog()
    fireEvent.change(word, { target: { value: 'DELETE' } })
    fireEvent.click(button)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(loadButton()).toBeDisabled()
    expect(wipeButton()).toBeDisabled()
    finish(jsonResponse({ wiped: true }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('both buttons are disabled while the load request runs', async () => {
    let finish!: (r: Response) => void
    stubDemo({ answer: new Promise<Response>(r => { finish = r }) })
    renderAdmin(<DangerZone />)
    openZone()
    await waitFor(() => expect(loadButton()).toBeEnabled())
    fireEvent.click(loadButton())
    const dialog = screen.getByRole('dialog', { name: 'Load test data?' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'DELETE' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete everything and load' }))
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Load test data?' })).getByRole('button', { name: 'Delete everything and load' })).toBeDisabled())
    expect(wipeButton()).toBeDisabled()
    expect(loadButton()).toBeDisabled()
    finish(jsonResponse(DEMO_RESULT))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  // Escape, Cancel and the backdrop while busy: DangerDialog below; both buttons disabled while the load runs: above
  it('a close the browser forces while the load request runs (a repeated Escape) draws the question again', async () => {
    let finish!: (r: Response) => void
    stubDemo({ answer: new Promise<Response>(r => { finish = r }) })
    renderAdmin(<DangerZone />)
    openZone()
    await waitFor(() => expect(loadButton()).toBeEnabled())
    fireEvent.click(loadButton())
    fireEvent.change(within(screen.getByRole('dialog', { name: 'Load test data?' })).getByRole('textbox'), { target: { value: 'DELETE' } })
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Load test data?' })).getByRole('button', { name: 'Delete everything and load' }))
    const running = () => screen.getByRole('dialog', { name: 'Load test data?' })
    await waitFor(() => expect(within(running()).getByRole('button', { name: 'Delete everything and load' })).toBeDisabled())
    ;(running() as HTMLDialogElement).close('cancel')
    expect(await screen.findByRole('dialog', { name: 'Load test data?' })).toBeInTheDocument()
    expect(loadButton()).toBeDisabled()
    finish(jsonResponse(DEMO_RESULT))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('a failed read of the Sign-in settings is told once, and the button stays disabled', async () => {
    stubDemo().answer({ 'GET /api/auth-settings': () => jsonResponse({ error: { code: 'load_failed' } }, 500) })
    renderAdmin(<DangerZone />)
    openZone()
    await waitFor(() => expect(errorToasts('Could not load data')).toHaveLength(1))
    expect(loadButton()).toBeDisabled()
  })

  it('a failed re-read while the dialog is open is told once, not by the zone and the dialog both', async () => {
    const fetchMock = stubDemo()
    const client = testClient()
    renderAdmin(<DangerZone />, { client })
    openZone()
    await waitFor(() => expect(loadButton()).toBeEnabled())
    fetchMock.answer({ 'GET /api/auth-settings': () => jsonResponse({ error: { code: 'load_failed' } }, 500) })
    // the dialog reads the settings again on opening
    fireEvent.click(loadButton())
    await waitFor(() => expect(errorToasts('Could not load data')).not.toEqual([]))
    // nothing left to read: the dialog's own notification would be on the screen by now
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(errorToasts('Could not load data')).toHaveLength(1)
  })

  it('none mode remains available when the auth mode is locked', async () => {
    stubDemo({ view: authSettingsView({ mode: 'none', locked: true }) })
    setAuth({ mode: 'none', me: { name: 'Artyom', rights: { edit: true, vote: true, manage: true } } })
    renderAdmin(<DangerZone />)
    openZone()
    await waitFor(() => expect(loadButton()).toBeEnabled())
    expect(screen.queryByText(/The sign-in mode cannot be changed here/)).toBeNull()
  })
})

describe('DangerZone without manage', () => {
  afterEach(() => { resetAuth() })

  it('is not shown to an editor', () => {
    const fetchMock = stubApi()
    setAuth({ me: { name: 'Robin', rights: { edit: true, vote: true, manage: false } } })
    renderAdmin(<DangerZone />)
    openZone()
    expect(screen.queryByRole('button', { name: 'Delete all family data' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load test data' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map(c => String(c[0]))).not.toContain('/api/auth-settings')
  })
})

describe('DangerDialog', () => {
  const dialog = (props: Partial<Parameters<typeof DangerDialog>[0]> = {}) => renderAdmin(
    <DangerDialog icon={IconTrash} title="Load it?" text="It replaces the data." confirmLabel="Load" busy={false} onAnswer={() => {}} {...props} />,
  )

  it('without a required word the action is enabled at once and there is no textbox', () => {
    dialog()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Load' })).toBeEnabled()
  })

  it('refuses the submit while canSubmit is false, though no word is required', () => {
    dialog({ canSubmit: false })
    expect(screen.getByRole('button', { name: 'Load' })).toBeDisabled()
  })

  it('while busy, Cancel is disabled, Escape is prevented and the backdrop does not answer', () => {
    const onAnswer = vi.fn()
    dialog({ busy: true, onAnswer })
    const panel = screen.getByRole('dialog', { name: 'Load it?' })
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    const escape = new Event('cancel', { cancelable: true })
    fireEvent(panel, escape)
    expect(escape.defaultPrevented).toBe(true)
    fireEvent.mouseDown(panel); fireEvent.click(panel, { detail: 1 })
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('when not busy, Escape is left to the browser and the backdrop cancels', () => {
    const onAnswer = vi.fn()
    dialog({ onAnswer })
    const panel = screen.getByRole('dialog', { name: 'Load it?' })
    const escape = new Event('cancel', { cancelable: true })
    fireEvent(panel, escape)
    expect(escape.defaultPrevented).toBe(false)
    fireEvent.mouseDown(panel); fireEvent.click(panel, { detail: 1 })
    expect(onAnswer).toHaveBeenCalledWith(false)
  })

  it('starts the focus on the first input of its children when no word is required', () => {
    dialog({ children: <input aria-label="Password" /> })
    expect(screen.getByLabelText('Password')).toHaveFocus()
  })
})
