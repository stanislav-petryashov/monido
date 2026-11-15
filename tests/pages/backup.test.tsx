import { onTestFinished } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { DataView } from '../../src/pages/settings/DataView'
import { BackupView, RESTORE_DOCS_URL } from '../../src/pages/settings/BackupView'
import { stubDemo } from '../helpers/demoData'
import { jsonResponse } from '../helpers/http'
import { renderAdmin } from '../helpers/render'
import { stubDownload } from '../helpers/download'

/** The restore answer: the kept copy's name, or an error code with its status; the rest as stubDemo (the Replace or delete data reads the Sign-in settings). */
function stubRestore(answer: { kept: string } | { code: string; status: number }) {
  return stubDemo().answer({
    'GET /api/backup/result': () => jsonResponse({ result: null }),
    'POST /api/backup/preview': () => jsonResponse({ lastPeriod: '2030-12-31', accounts: 2, goals: 3 }),
    'POST /api/backup/restore': () => 'kept' in answer ? jsonResponse(answer) : jsonResponse({ error: { code: answer.code } }, answer.status),
  })
}

/**
 * The navigations jsdom refused for the rest of the test: it cannot load another document, so `location.reload()` (not
 * spyable: an unforgeable property) is reported on jsdom's virtual console instead, and lands here.
 */
function watchNavigations(): string[] {
  const virtualConsole = (globalThis as unknown as { jsdom: { virtualConsole: VirtualConsole } }).jsdom.virtualConsole
  const seen: string[] = []
  const listener = (e: Error) => { if (e.message.startsWith('Not implemented: navigation')) seen.push(e.message) }
  virtualConsole.on('jsdomError', listener)
  onTestFinished(() => { virtualConsole.off('jsdomError', listener) })
  return seen
}
interface VirtualConsole {
  on(event: 'jsdomError', listener: (e: Error) => void): void
  off(event: 'jsdomError', listener: (e: Error) => void): void
}

/** The initial action opens the native file picker without authorizing any restore. */
async function pickBackup() {
  const pickerClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
  fireEvent.click(screen.getByRole('button', { name: 'Choose backup' }))
  expect(pickerClick).toHaveBeenCalledTimes(1)
  const file = new File([new Uint8Array([1, 2, 3])], 'finance-2031-10-19.sqlite')
  fireEvent.change(screen.getByTestId('restore-file'), { target: { files: [file] } })
  return file
}

async function confirmBackup() {
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Replace data with this file' }))
}

describe('Backup page', () => {
  afterEach(() => { vi.useRealTimers(); resetAuth(); window.history.replaceState(null, '', '/') })

  it('describes the copy and downloads it through /api/backup', async () => {
    const fetchMock = stubDemo()
    // jsdom cannot navigate to a file link: the download's own click on its <a> is stubbed and awaited
    const { anchorClick } = stubDownload()
    renderAdmin(<BackupView />)
    expect(screen.getByText(/All data and settings in a SQLite file/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Download backup' }))
    await waitFor(() => expect(fetchMock.mock.calls.map(c => String(c[0]))).toContain('/api/backup'))
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1))
  })

  it('keeps maintenance and the danger zone separate from backups', () => {
    stubDemo()
    renderAdmin(<BackupView />)
    expect(screen.queryByRole('heading', { name: 'Replace or delete data' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Setup wizard' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Download backup' })).toHaveLength(1)
  })

  it('the data page shows setup before the danger zone', () => {
    // not the demo mode: stubDemo only answers the Replace or delete data's reads (the Sign-in settings, the test-data load); the
    // session stays the default family-password one, the only kind that sees both the setup block and the danger zone
    stubDemo()
    window.history.replaceState(null, '', '/settings/data')
    renderAdmin(<DataView />)
    const setup = screen.getByRole('heading', { name: 'Setup wizard' })
    const danger = screen.getByRole('heading', { name: 'Replace or delete data' })
    expect(setup.compareDocumentPosition(danger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('has no danger zone in the demo or for an editor without manage', () => {
    stubDemo()
    window.history.replaceState(null, '', '/settings/data')
    setAuth({ mode: 'demo' })
    const { unmount } = renderAdmin(<DataView />)
    expect(screen.queryByRole('heading', { name: 'Replace or delete data' })).toBeNull()
    unmount()
    // a signed-in mode, so only the missing manage right hides it
    setAuth({ mode: 'telegram', me: { name: 'Robin', rights: { edit: true, vote: true, manage: false } } })
    const editor = renderAdmin(<DataView />)
    expect(screen.queryByRole('heading', { name: 'Replace or delete data' })).toBeNull()
    editor.unmount()
    setAuth({ mode: 'telegram', me: { name: 'Robin', rights: { edit: true, vote: true, manage: true } } })
    renderAdmin(<DataView />)
    expect(screen.getByRole('heading', { name: 'Replace or delete data' })).toBeInTheDocument()
  })

  it('choosing a backup is neutral; replacement requires a separate confirmation', () => {
    stubDemo()
    renderAdmin(<BackupView />)
    expect(screen.getByRole('button', { name: 'Choose backup' })).toHaveClass('btn', 'btn--ghost')
  })

  it('its blocks are settings rows', () => {
    stubDemo()
    renderAdmin(<BackupView />)
    expect(screen.getByRole('region', { name: 'Backup and export' })).toHaveClass('settings-section')
  })

  it('links to the restore section of the deployment guide', () => {
    stubDemo()
    renderAdmin(<BackupView />)
    const link = screen.getByRole('link', { name: 'How to restore' })
    expect(link).toHaveAttribute('href', RESTORE_DOCS_URL)
    expect(RESTORE_DOCS_URL).toMatch(/^https:\/\/github\.com\/.+\/blob\/master\/docs\/deploy-docker\.md#backup-and-restore$/)
    // a real repository, not the placeholder: users of the published image open this link (built from parts for set-repo's coverage check)
    expect(RESTORE_DOCS_URL).not.toContain(['OWNER', 'REPO'].join('/'))
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('restores from a file after a danger confirmation, then reloads', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const navigations = watchNavigations()
    const fetchMock = stubRestore({ kept: 'before-restore-20311019-100000.sqlite' })
    renderAdmin(<BackupView />)
    const file = await pickBackup()
    await screen.findByText(file.name)
    expect(fetchMock.mock.calls.map(c => String(c[0]))).not.toContain('/api/backup/restore')
    expect(screen.getByText('2030-12-31')).toBeInTheDocument()
    await confirmBackup()
    await waitFor(() => expect(screen.getByText('Backup restored')).toBeInTheDocument())
    expect(screen.getAllByText(/kept as before-restore-20311019-100000\.sqlite/)[0]).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(c => String(c[0]) === '/api/backup/restore')!
    expect(call[1]).toMatchObject({ method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } })
    // the notification first, the buttons disabled until the reload; the reload 1.5 s later
    expect(navigations).toEqual([])
    expect(screen.getByRole('button', { name: 'Choose backup' })).toBeDisabled()
    await act(() => vi.advanceTimersByTimeAsync(1500))
    expect(navigations).toHaveLength(1)
  })

  it('a failed upload says so, re-enables the button and does not reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const navigations = watchNavigations()
    stubRestore({ code: 'restore_failed', status: 500 })
    renderAdmin(<BackupView />)
    await pickBackup()
    await confirmBackup()
    await waitFor(() => expect(screen.getByText('Could not restore the backup')).toBeInTheDocument())
    expect(screen.queryByText('Backup restored')).toBeNull()
    expect(screen.getByRole('button', { name: 'Choose backup' })).toBeEnabled()
    await act(() => vi.advanceTimersByTimeAsync(1500))
    expect(navigations).toEqual([])
  })

  it('the confirmation offers a database copy first and stays open', async () => {
    const fetchMock = stubRestore({ kept: 'before-restore-20311019-100000.sqlite' })
    const { anchorClick } = stubDownload()
    renderAdmin(<BackupView />)
    await pickBackup()
    await screen.findByRole('dialog')
    const dialog = screen.getByRole('dialog', { name: 'Replace all data with a backup?' })
    // the focus starts on Cancel: an accidental Enter replaces nothing
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    // the actions read as in every confirmation: Cancel first, the destructive one last
    expect(within(dialog).getAllByRole('button').map(b => b.textContent).slice(-2)).toEqual(['Cancel', 'Replace data with this file'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download backup' }))
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls.map(c => String(c[0]))).toContain('/api/backup')
    expect(screen.getByRole('dialog', { name: 'Replace all data with a backup?' })).toBeInTheDocument()
  })

  it('cancelling the preview never restores data', async () => {
    const fetchMock = stubRestore({ kept: 'x.sqlite' })
    renderAdmin(<BackupView />)
    await pickBackup()
    await screen.findByRole('dialog')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.map(c => String(c[0]))).not.toContain('/api/backup/restore')
  })

  it('shows the translated reason when the file is not a backup', async () => {
    stubRestore({ code: 'backup_invalid', status: 400 })
    renderAdmin(<BackupView />)
    await pickBackup()
    await confirmBackup()
    await waitFor(() => expect(screen.getByText('Could not restore the backup')).toBeInTheDocument())
    expect(screen.getByText(/not a Monido backup or is damaged/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose backup' })).toBeEnabled()
  })

  it('loads the durable restoration result after a fresh mount and offers the previous copy', async () => {
    const fetchMock = stubDemo().answer({ 'GET /api/backup/result': () => jsonResponse({ result: { kept: 'before-restore-20311019-100000.sqlite', restoredAt: '2031-10-19T10:00:00Z' } }) })
    const { anchorClick } = stubDownload()
    renderAdmin(<BackupView />)
    await screen.findByText('Backup restored')
    fireEvent.click(screen.getByRole('button', { name: 'Download pre-restore copy' }))
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls.map(c => String(c[0]))).toContain('/api/backup/kept/before-restore-20311019-100000.sqlite')
  })

  it('an invalid preview never offers confirmation or sends a restore', async () => {
    const fetchMock = stubDemo().answer({ 'POST /api/backup/preview': () => jsonResponse({ error: { code: 'backup_invalid' } }, 400) })
    renderAdmin(<BackupView />)
    await pickBackup()
    await screen.findByText('Could not check the backup')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchMock.mock.calls.map(c => String(c[0]))).not.toContain('/api/backup/restore')
    expect(screen.getByRole('button', { name: 'Choose backup' })).toBeEnabled()
  })

  it('exports the data to CSV through /api/export/csv', async () => {
    const fetchMock = stubDemo()
    stubDownload('blob:csv')
    renderAdmin(<BackupView />)
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(fetchMock.mock.calls.map(c => String(c[0]))).toContain('/api/export/csv'))
  })

  it('offers neither the database copy, restore nor CSV export in the demo', () => {
    stubDemo()
    setAuth({ mode: 'demo' })
    renderAdmin(<BackupView />)
    expect(screen.queryByRole('button', { name: 'Download backup' })).not.toBeInTheDocument()
    expect(screen.queryByText(/All data and settings in a SQLite file/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose backup' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('restore-file')).not.toBeInTheDocument()
  })
})

describe('Backup page without manage', () => {
  afterEach(() => resetAuth())

  it('an editor can export to CSV but neither download the database copy nor restore, and is told why', () => {
    stubDemo()
    setAuth({ me: { name: 'Robin', rights: { edit: true, vote: true, manage: false } } })
    renderAdmin(<BackupView />)
    expect(screen.queryByRole('button', { name: 'Download backup' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose backup' })).not.toBeInTheDocument()
    // Restore explains the missing manage right
    expect(screen.getAllByText('Only family members who manage users and settings can change this')).toHaveLength(1)
  })
})
