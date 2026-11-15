import { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { RemindersBlock } from '../../../src/modules/reminders/RemindersBlock'
import type { RemindersView } from '../../../src/domain/api'
import { jsonResponse as json } from '../../helpers/http'
import { ru, withLanguage } from '../../helpers/i18n'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { renderAdmin } from '../../helpers/render'

const pairing = { pairingToken: 'synthetic-pairing-code' }

const base: RemindersView = {
  recipients: [], configured: true, linked: false, openMonths: ['2031-09'], next: null,
  settings: { enabled: false, startDay: 3, hour: 10, timezone: 'UTC', chatTitle: null, lastSentAt: null, lastError: null },
}

/** GET /api/reminders returns the view; a write goes to onWrite (returns a new view or throws). Returns the list of writes. */
function stub(view: RemindersView, onWrite?: (url: string, method: string, body: unknown) => RemindersView) {
  const calls: { url: string; method: string; body?: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method === 'GET') return json(view)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push(body === undefined ? { url, method } : { url, method, body })
    if (url === '/api/reminders/pairing') return json(pairing)
    try { return json(onWrite ? onWrite(url, method, body) : view) } catch (e) { return json({ error: (e as Error).message }, 400) }
  }))
  return calls
}

const renderBlock = () => renderAdmin(<RemindersBlock />)

describe('Reminders block without manage', () => {
  afterEach(() => resetAuth())

  it('shows the state line only, no settings form', async () => {
    stub({ ...base, linked: true })
    setAuth({ me: { name: 'Robin', rights: { edit: true, vote: true, manage: false } } })
    renderBlock()
    expect(await screen.findByText(/reminders/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})

describe('Reminders block', () => {




  it('offers days 1–15 only and saves the schedule', async () => {
    const calls = stub(base, (_u, _m, body) => ({ ...base, settings: { ...base.settings, ...(body as object) } }))
    renderBlock()
    const day = await screen.findByRole('combobox', { name: 'From day' })
    expect(within(day).getAllByRole('option').map(o => o.textContent)).toEqual(Array.from({ length: 15 }, (_, i) => String(i + 1)))
    fireEvent.change(day, { target: { value: '5' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'At' }), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Remind about unclosed months' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ url: '/api/reminders', method: 'PUT', body: { enabled: true, startDay: 5, hour: 9 } })
    expect(screen.getByText('Repeats every day until the month is closed')).toBeInTheDocument()
  })
  it('suggests the browser’s time zone before anything was saved', async () => {
    stub(base)
    renderBlock()
    expect(await screen.findByRole('combobox', { name: 'Time zone' })).toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
  it('Detect fills the field with the device zone and shows its offset and time', async () => {
    stub(base)
    renderBlock()
    const zone = await screen.findByRole('combobox', { name: 'Time zone' })
    fireEvent.change(zone, { target: { value: 'Europe/Berlin' } })
    const real = Intl.DateTimeFormat.prototype.resolvedOptions
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), timeZone: 'Asia/Yekaterinburg' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Detect' }))
    spy.mockRestore()
    expect(zone).toHaveValue('Asia/Yekaterinburg')
    expect(screen.getByText(/^UTC\+5 · now \d{2}:\d{2}$/)).toBeInTheDocument()
  })
  it('keeps the time of the zone current while the page stays open', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2031-09-10T12:00:10Z'))
    try {
      stub(base)
      renderBlock()
      const zone = await screen.findByRole('combobox', { name: 'Time zone' })
      fireEvent.change(zone, { target: { value: 'Asia/Tashkent' } })
      expect(screen.getByText('UTC+5 · now 17:00')).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(60_000) })
      expect(screen.getByText('UTC+5 · now 17:01')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
  it('keeps the example under an invalid zone and writes a negative offset with a minus sign', async () => {
    stub(base)
    renderBlock()
    const zone = await screen.findByRole('combobox', { name: 'Time zone' })
    fireEvent.change(zone, { target: { value: 'Mars/Olympus' } })
    expect(screen.getByText('For example Europe/Berlin or America/New_York')).toBeInTheDocument()
    fireEvent.change(zone, { target: { value: 'America/St_Johns' } })
    expect(screen.getByText(/^UTC\u2212[23]:30 · now /)).toBeInTheDocument()
  })




  it('says when the last reminder went out and when the next one is due', async () => {
    stub({ ...base, linked: true, openMonths: ['2031-09'], next: { date: '2031-10-04', hour: 10, minute: 0 }, settings: { ...base.settings, enabled: true, timezone: 'Europe/Moscow', lastSentAt: '2031-10-03T07:05:00Z' } })
    renderBlock()
    expect(await screen.findByText(/Last reminder: October 3, 10:05\./)).toBeInTheDocument()
    expect(screen.getByText(/Next: October 4 at 10:00/)).toBeInTheDocument()
  })
  it('shows why the last attempt failed', async () => {
    stub({ ...base, linked: true, settings: { ...base.settings, enabled: true, lastError: { code: 'telegram.external', params: { detail: 'Forbidden: bot was blocked by the user' } } } })
    renderBlock()
    expect(await screen.findByText(/The last send failed: Forbidden: bot was blocked by the user\./)).toBeInTheDocument()
  })
  it('words a stored error code in the UI language, not in the message language', async () => {
    const failed = { ...base, linked: true, settings: { ...base.settings, enabled: true, lastError: { code: 'telegram.unavailable' } } }
    stub(failed)
    const { unmount } = renderBlock()
    expect(await screen.findByText(/The last send failed: Telegram is unavailable\./)).toBeInTheDocument()
    unmount()
    await withLanguage('ru-RU', async () => {
      stub(failed)
      const { unmount: done } = renderBlock()
      expect(await screen.findByText(ru('modules.reminders.lastError', { error: ru('errors.telegram.unavailable') }), { exact: false })).toBeInTheDocument()
      done()
    })
  })
  it.each([['a code that names a group', 'reminders'], ['a code this build does not know', 'nope']])('falls back to the plain failure for %s', async (_name, code) => {
    stub({ ...base, linked: true, settings: { ...base.settings, enabled: true, lastError: { code } } })
    renderBlock()
    expect(await screen.findByText('The last send failed: Could not send.')).toBeInTheDocument()
  })
  it('has no language field', async () => {
    stub(base)
    renderBlock()
    await screen.findByRole('combobox', { name: 'Time zone' })
    expect(screen.queryByRole('combobox', { name: 'Message language' })).toBeNull()
  })
  it('says there is nothing to remind about when every month is closed', async () => {
    stub({ ...base, linked: true, settings: { ...base.settings, enabled: true }, openMonths: [], next: null })
    renderBlock()
    expect(await screen.findByText('All months are closed. Nothing to remind about')).toBeInTheDocument()
  })



  it('sends the chosen time zone and refuses one it does not know, without asking the server', async () => {
    const calls = stub(base, (_u, _m, body) => ({ ...base, settings: { ...base.settings, ...(body as object) } }))
    renderBlock()
    const zone = await screen.findByRole('combobox', { name: 'Time zone' })
    fireEvent.change(zone, { target: { value: 'Moscow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Unknown time zone/)).toBeInTheDocument()
    expect(zone).toHaveAttribute('aria-invalid', 'true')
    expect(calls).toEqual([])
    fireEvent.change(zone, { target: { value: 'Asia/Tokyo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toMatchObject({ timezone: 'Asia/Tokyo' })
  })

  it('names the zone next to the time of the next reminder and marks unsaved changes', async () => {
    stub({ ...base, linked: true, next: { date: '2031-10-04', hour: 10, minute: 0 }, settings: { ...base.settings, enabled: true, timezone: 'Europe/Moscow' } })
    renderBlock()
    expect(await screen.findByText(/Next: October 4 at 10:00 \(Europe\/Moscow\)/)).toBeInTheDocument()
    expect(screen.queryByText('The schedule has unsaved changes')).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'At' }), { target: { value: '12' } })
    expect(screen.getByText('The schedule has unsaved changes')).toBeInTheDocument()
  })

  it('survives a broken time zone stored in the database', async () => {
    stub({ ...base, linked: true, settings: { ...base.settings, enabled: true, timezone: 'Nowhere/Land', lastSentAt: '2031-10-03T07:05:00Z' } })
    renderBlock()
    expect(await screen.findByRole('combobox', { name: 'Time zone' })).toBeInTheDocument()
  })

  it('says so when the settings cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'boom' }, 500)))
    renderBlock()
    expect(await screen.findByText('Could not load the reminder settings')).toBeInTheDocument()
  })

  it('keeps the settings when a later read fails', async () => {
    stub({ ...base, linked: true })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderAdmin(<RemindersBlock />, { client })
    expect(await screen.findByRole('combobox', { name: 'Time zone' })).toBeInTheDocument()
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'boom' }, 500)))
    await act(() => client.refetchQueries())
    await waitFor(() => expect(client.getQueryState(['admin', 'reminders'])?.status).toBe('error'))
    await act(async () => {})
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toBeInTheDocument()
    expect(screen.queryByText('Could not load the reminder settings')).not.toBeInTheDocument()
  })

  it('a failed read does not show settings cached on an earlier visit', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['admin', 'reminders'], { ...base, linked: true }, { updatedAt: Date.now() - 60_000 })
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'boom' }, 500)))
    renderAdmin(<RemindersBlock />, { client })
    expect(await screen.findByText('Could not load the reminder settings')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('says that reminders are off', async () => {
    stub({ ...base, linked: true })
    renderBlock()
    expect(await screen.findByText('Reminders are off')).toBeInTheDocument()
  })
})

 it('allows preparing the schedule before connecting a bot and cancels a draft', async () => {
   const calls = stub({ ...base, configured: false })
   renderBlock()
   const day = await screen.findByRole('combobox', { name: 'From day' })
   expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
   fireEvent.change(day, { target: { value: '7' } })
   fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
   expect(day).toHaveValue('3')
   expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
   expect(calls).toEqual([])
 })
