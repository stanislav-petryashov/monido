import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { CouncilSettings } from '../../../src/modules/advisor/CouncilSettings'
import type { SpendingRecords } from '../../../src/domain/api'
import { loadLocaleChunk } from '../../../src/i18n/client'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { jsonResponse as json } from '../../helpers/http'
import { renderAdmin } from '../../helpers/render'
import { pageOf, stubCouncil } from './proposalViews'

const SPENDING: SpendingRecords = { categories: [], accounts: [], sources: [], manual: { amount: 1500, currency: 'EUR', updated_at: '2031-09-12T08:30:00.000Z' } }
const RIGHTS = { edit: true, vote: true, manage: true }

beforeAll(() => loadLocaleChunk('advisor'))
afterEach(() => { resetAuth() })

const section = () => screen.findByRole('region', { name: 'Proposal settings' })

describe('Proposal settings', () => {
  it('is shown only to who may manage settings', async () => {
    setAuth({ mode: 'telegram', me: { name: 'Annika', rights: { ...RIGHTS, manage: false } } })
    stubCouncil(pageOf([]), { spending: SPENDING })
    const fetch = vi.mocked(globalThis.fetch)
    renderAdmin(<CouncilSettings />)
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/api/advisor/proposals')).toBe(true))
    expect(screen.queryByRole('region', { name: 'Proposal settings' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Base monthly expenses' })).toBeNull()
  })

  it('saves the days to decide and the reminder; with the reminder off it sends null', async () => {
    const calls = stubCouncil(pageOf([]), { spending: SPENDING, onWrite: call => call.body })
    renderAdmin(<CouncilSettings />)
    const settings = await section()
    const days = await within(settings).findByRole('textbox', { name: 'Days to decide' })
    await waitFor(() => expect(days).toHaveValue('14'))
    const remind = within(settings).getByRole('switch', { name: 'Remind before the deadline' })
    expect(remind).toHaveAttribute('aria-checked', 'true')
    expect(within(settings).getByRole('textbox', { name: 'Days before the deadline' })).toHaveValue('3')
    fireEvent.change(days, { target: { value: '10' } })
    fireEvent.change(within(settings).getByRole('textbox', { name: 'Days before the deadline' }), { target: { value: '2' } })
    fireEvent.click(within(settings).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/advisor/settings', method: 'PUT', body: { decideDays: 10, remindDays: 2 } }]))
    expect((await screen.findAllByText('Proposal settings saved')).length).toBeGreaterThan(0)

    // the saved settings start the form again
    fireEvent.click(within(settings).getByRole('switch', { name: 'Remind before the deadline' }))
    expect(within(settings).queryByRole('textbox', { name: 'Days before the deadline' })).toBeNull()
    fireEvent.click(within(settings).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls[1]).toEqual({ url: '/api/advisor/settings', method: 'PUT', body: { decideDays: 10, remindDays: null } }))
  })

  it('saving keeps the keyboard focus on Save', async () => {
    stubCouncil(pageOf([]), { spending: SPENDING, onWrite: call => call.body })
    renderAdmin(<CouncilSettings />)
    const settings = await section()
    const days = await within(settings).findByRole('textbox', { name: 'Days to decide' })
    await waitFor(() => expect(days).toHaveValue('14'))
    fireEvent.change(days, { target: { value: '9' } })
    const save = within(settings).getByRole('button', { name: 'Save' })
    save.focus()
    fireEvent.click(save)
    expect((await screen.findAllByText('Proposal settings saved')).length).toBeGreaterThan(0)
    await waitFor(() => expect(within(settings).getByRole('textbox', { name: 'Days to decide' })).toHaveValue('9'))
    await waitFor(() => expect(document.activeElement).toBe(within(settings).getByRole('button', { name: 'Save' })))
  })

  it('refuses a reminder not before the deadline: the server says why', async () => {
    const calls = stubCouncil(pageOf([]), {
      spending: SPENDING,
      onWrite: () => json({ error: { code: 'advisor.remind_after_deadline', params: { param: 'remindDays' } } }, 400),
    })
    renderAdmin(<CouncilSettings />)
    const settings = await section()
    await waitFor(() => expect(within(settings).getByRole('textbox', { name: 'Days to decide' })).toHaveValue('14'))
    fireEvent.change(within(settings).getByRole('textbox', { name: 'Days to decide' }), { target: { value: '3' } })
    fireEvent.click(within(settings).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('The reminder must come before the deadline')).toBeInTheDocument()
    expect(screen.getByText('Could not save the proposal settings')).toBeInTheDocument()
    expect(calls).toHaveLength(1)
  })

  it('an empty number is refused before anything is sent', async () => {
    const calls = stubCouncil(pageOf([]), { spending: SPENDING })
    renderAdmin(<CouncilSettings />)
    const settings = await section()
    await waitFor(() => expect(within(settings).getByRole('textbox', { name: 'Days to decide' })).toHaveValue('14'))
    fireEvent.change(within(settings).getByRole('textbox', { name: 'Days to decide' }), { target: { value: '' } })
    fireEvent.click(within(settings).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Could not save the proposal settings')).toBeInTheDocument()
    expect(calls).toEqual([])
  })

  it('without the council (not Telegram sign-in) it shows nothing, even to a manager', async () => {
    stubCouncil(pageOf([], { available: false }), { spending: SPENDING })
    const { container } = renderAdmin(<CouncilSettings />)
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => url === '/api/advisor/proposals')).toBe(true))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('leaves the base monthly expenses to Settings → General', async () => {
    stubCouncil(pageOf([]), { spending: SPENDING })
    renderAdmin(<CouncilSettings />)
    await section()
    expect(screen.queryByRole('region', { name: 'Base monthly expenses' })).toBeNull()
  })
})
