import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { DemoDataResult } from '../../src/domain/api'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { DemoDataDialog, type DemoDataDialogProps } from '../../src/pages/admin/DemoDataDialog'
import { authSettingsView } from '../helpers/authSettings'
import { DEMO_RESULT, demoBodies, stubDemo } from '../helpers/demoData'
import { jsonResponse } from '../helpers/http'
import { renderAdmin } from '../helpers/render'

function renderDialog(props: Partial<DemoDataDialogProps> = {}) {
  const onDone = vi.fn()
  const onClose = vi.fn()
  renderAdmin(<DemoDataDialog open confirmation="word" onDone={onDone} onClose={onClose} {...props} />)
  return { onDone, onClose }
}

const findDialog = () => screen.findByRole('dialog', { name: 'Load test data?' })

describe('DemoDataDialog', () => {
  afterEach(() => { resetAuth() })

  it('renders nothing while closed', () => {
    stubDemo()
    renderDialog({ open: false })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it("'word': the action enables only on the exact word and sends { confirm: true } without language or password", async () => {
    const fetchMock = stubDemo()
    renderDialog()
    const dialog = await findDialog()
    expect(within(dialog).getByText(/First everything now in the app is deleted/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Download backup' })).toBeInTheDocument()
    const button = within(dialog).getByRole('button', { name: 'Delete everything and load' })
    expect(button).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'DELET' } })
    expect(button).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'DELETE' } })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(demoBodies(fetchMock)).toHaveLength(1))
    expect(demoBodies(fetchMock)[0]).toEqual({ confirm: true })
  })

  it("'plain': the action is enabled at once, no textbox, no backup button; language 'ru-RU' goes in the body", async () => {
    const fetchMock = stubDemo()
    const { onDone } = renderDialog({ confirmation: 'plain', language: 'ru-RU' })
    const dialog = await findDialog()
    expect(within(dialog).getByText(/The example family brings its own members/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Download backup' })).toBeNull()
    const button = within(dialog).getByRole('button', { name: 'Load test data' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(demoBodies(fetchMock)).toEqual([{ confirm: true, language: 'ru-RU' }])
  })

  it('the Telegram paragraph appears only in telegram mode', async () => {
    stubDemo({ view: authSettingsView({ mode: 'telegram' }) })
    setAuth({ mode: 'telegram', me: { name: 'Artyom', rights: { edit: true, vote: true, manage: true } } })
    renderDialog()
    expect(within(await findDialog()).getByText(/Sign-in through Telegram ends/)).toBeInTheDocument()
  })

  it('no Telegram paragraph in password mode', async () => {
    stubDemo()
    renderDialog()
    expect(within(await findDialog()).queryByText(/Sign-in through Telegram ends/)).toBeNull()
  })

  it('the password fields mirror 12–128 and the mismatch: the action stays disabled, the worded alert shows; a good pair is sent as password', async () => {
    const fetchMock = stubDemo({ view: authSettingsView({ password: { set: false, source: null } }) })
    const { onDone } = renderDialog({ confirmation: 'plain' })
    // the question is drawn again once the settings say no password is stored
    await screen.findByLabelText('Family password')
    const dialog = await findDialog()
    const password = within(dialog).getByLabelText('Family password')
    const repeat = within(dialog).getByLabelText('Repeat the password')
    expect(within(dialog).getByText(/No family password is set yet/)).toBeInTheDocument()
    expect(within(dialog).getByText('At least 12 characters.')).toBeInTheDocument()
    expect(password).toHaveAttribute('autocomplete', 'new-password')
    expect(repeat).toHaveAttribute('autocomplete', 'new-password')
    // the first input takes the focus: there is no word in the plain variant
    expect(password).toHaveFocus()
    const button = within(dialog).getByRole('button', { name: 'Load test data' })
    expect(button).toBeDisabled()
    // nothing worded before both fields are typed
    fireEvent.change(password, { target: { value: 'short pass' } })
    expect(within(dialog).queryByRole('alert')).toBeNull()
    // too short, the pair equal: worded on the first field
    fireEvent.change(repeat, { target: { value: 'short pass' } })
    expect(button).toBeDisabled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The password must be at least 12 characters')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password.getAttribute('aria-describedby')).toContain(within(dialog).getByRole('alert').id)
    // too long
    const long = 'x'.repeat(129)
    fireEvent.change(password, { target: { value: long } })
    fireEvent.change(repeat, { target: { value: long } })
    expect(button).toBeDisabled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The password must be at most 128 characters')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    // long enough, a mismatch: worded on the repeat
    fireEvent.change(password, { target: { value: 'a long family password' } })
    fireEvent.change(repeat, { target: { value: 'a long family passwor' } })
    expect(button).toBeDisabled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The two passwords do not match')
    expect(password).not.toHaveAttribute('aria-invalid', 'true')
    expect(repeat).toHaveAttribute('aria-invalid', 'true')
    // the good pair
    fireEvent.change(repeat, { target: { value: 'a long family password' } })
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(demoBodies(fetchMock)).toEqual([{ confirm: true, password: 'a long family password' }])
  })

  it('with password.set true there are no password fields and the body carries no password key', async () => {
    const fetchMock = stubDemo()
    const { onDone } = renderDialog({ confirmation: 'plain' })
    const dialog = await findDialog()
    const button = within(dialog).getByRole('button', { name: 'Load test data' })
    await waitFor(() => expect(button).toBeEnabled())
    expect(within(dialog).queryByLabelText('Family password')).toBeNull()
    fireEvent.click(button)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(demoBodies(fetchMock)[0]).not.toHaveProperty('password')
  })

  it('success: the toast, onDone(result) with the server answer', async () => {
    const answer: DemoDataResult = { loaded: true, language: 'ru-RU', currency: 'RUB' }
    stubDemo({ answer })
    const { onDone, onClose } = renderDialog({ confirmation: 'plain' })
    const button = within(await findDialog()).getByRole('button', { name: 'Load test data' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(answer))
    expect(screen.getByText('Test data loaded')).toBeInTheDocument()
    expect(screen.getAllByText(/Two fictional people, three years of closed months/).length).toBeGreaterThan(0)
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each([
    ['password_needed', 'Set a family password first: everyone will sign in with it'],
    ['auth_mode_locked', /The sign-in mode cannot be changed here/],
  ])('a 409 %s shows its translated message and the dialog stays', async (code, message) => {
    stubDemo({ answer: { code, status: 409 } })
    const { onDone, onClose } = renderDialog({ confirmation: 'plain' })
    const button = within(await findDialog()).getByRole('button', { name: 'Load test data' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByText('Could not load the test data')).toBeInTheDocument())
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    const again = await findDialog()
    await waitFor(() => expect(within(again).getByRole('button', { name: 'Load test data' })).toBeEnabled())
  })

  it('while the request runs Escape, Cancel and a forced close leave onClose uncalled and the dialog open; onDone follows', async () => {
    let finish!: (r: Response) => void
    stubDemo({ answer: new Promise<Response>(r => { finish = r }) })
    const { onClose, onDone } = renderDialog({ confirmation: 'plain' })
    const button = within(await findDialog()).getByRole('button', { name: 'Load test data' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Load test data?' })).getByRole('button', { name: 'Load test data' })).toBeDisabled())
    const escape = new Event('cancel', { cancelable: true })
    fireEvent(screen.getByRole('dialog', { name: 'Load test data?' }), escape)
    expect(escape.defaultPrevented).toBe(true)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Load test data?' })).getByRole('button', { name: 'Cancel' }))
    ;(screen.getByRole('dialog', { name: 'Load test data?' }) as HTMLDialogElement).close('cancel')
    expect(onClose).not.toHaveBeenCalled()
    const again = await findDialog()
    expect(within(again).getByRole('button', { name: 'Load test data' })).toBeDisabled()
    finish(jsonResponse(DEMO_RESULT))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('cancelling closes without a request', async () => {
    const fetchMock = stubDemo()
    const { onClose, onDone } = renderDialog()
    fireEvent.click(within(await findDialog()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onDone).not.toHaveBeenCalled()
    expect(demoBodies(fetchMock)).toEqual([])
  })
})
