import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { AccountsView } from '../../../src/pages/admin/AccountsView'
import { GoalsScreen } from '../../../src/modules/goals/GoalsScreen'
import { journalUndoEffect } from '../../../src/pages/admin/journal'
import { JournalView } from '../../../src/pages/admin/JournalView'
import { LoansView } from '../../../src/pages/admin/LoansView'
import { ru, withLanguage } from '../../helpers/i18n'
import { applyFamilyLanguage, currentLanguage } from '../../../src/i18n/client'
import { jsonResponse, stubApi } from '../../helpers/http'
import { fmtMonthYear } from '../../../src/lib/formatters'
import { renderAdmin as renderPage, stubPrivacyOn } from '../../helpers/render'
import { header } from '../../helpers/adminScreens'

// The charts draw on a canvas that jsdom does not have: these tests do not look at them

afterEach(() => { window.history.replaceState(null, '', '/') })

async function expandEntries() {
  await waitFor(() => expect(document.querySelector('.journal-entry > summary')).not.toBeNull())
  for (const el of document.querySelectorAll('.journal-entry:not([open]) > summary')) fireEvent.click(el)
  await waitFor(() => expect(document.querySelector('.journal-entry .disclosure__body')).not.toBeNull())
}

describe('Journal screen', () => {
  const entry = { id: 12, ts: '2031-05-01T10:00:00Z', actor: 'me@example.com', source: 'web', table_name: 'goals', row_id: 1, op: 'update', before_json: '{"name":"A"}', after_json: '{"name":"B"}', reverts_id: null }
  /** A journal with one entry; POST (revert) answers ok. */
  const stubRevert = () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      jsonResponse(init?.method === 'POST' ? { ok: true } : { rows: [entry], columns: [] }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('says it is loading rather than empty until the entries arrive', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderPage(<DataPage screen={JournalView} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('The change history is empty')).toBeNull()
  })

  it('says the journal is empty once it has loaded with no entries', async () => {
    stubApi()
    renderPage(<DataPage screen={JournalView} />)
    expect(await screen.findByText('The change history is empty')).toBeInTheDocument()
    // what appears here, in a line
    expect(screen.getByText(/Every edit of your data appears here: what changed, who did it and when/)).toBeInTheDocument()
  })

  it('privacy mode hides the amounts in the change lines', async () => {
    stubPrivacyOn()
    stubApi({ change_log: [{ id: 3, ts: '2031-10-05T08:00:00Z', actor: 'me', source: 'admin', table_name: 'assets', row_id: 5, op: 'update', before_json: '{"value":5600}', after_json: '{"value":5800}', reverts_id: null }] })
    renderPage(<DataPage screen={JournalView} />, { dashboard: true })
    expect(await screen.findByText('Accounts · Value: ••• → •••')).toBeInTheDocument()
    expect(screen.queryByText(/5600|5800/)).toBeNull()
  })

  it('tells each change in one line and keeps the revert button', async () => {
    // midday UTC: the same calendar day in every zone from UTC-12 to UTC+11
    stubApi({ change_log: [{ id: 3, ts: '2031-10-05T12:00:00Z', actor: 'me', source: 'admin', table_name: 'assets', row_id: 5, op: 'update', before_json: '{"value":5600}', after_json: '{"value":5800}', reverts_id: null }] })
    renderPage(<DataPage screen={JournalView} />)
    expect(await screen.findByText('Accounts · Value: 5,600 → 5,800')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'October 5, 2031' })).toBeInTheDocument()
    expect(screen.getByText('12:00')).toHaveAttribute('dateTime', '2031-10-05T12:00:00Z')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    await expandEntries()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('filters by object and author while preserving revert eligibility from the full history', async () => {
    stubApi({ change_log: [
      { ...entry, id: 12, actor: 'Anna' },
      { ...entry, id: 13, actor: 'Boris', table_name: 'assets' },
      { ...entry, id: 14, actor: 'Boris', op: 'revert', reverts_id: 12 },
    ] })
    renderPage(<DataPage screen={JournalView} />)
    const object = await screen.findByRole('combobox', { name: 'Object' })
    const author = screen.getByRole('combobox', { name: 'Who' })
    fireEvent.change(author, { target: { value: 'Anna' } })
    expect(document.querySelectorAll('.journal-entry')).toHaveLength(1)
    await expandEntries()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    fireEvent.change(object, { target: { value: 'assets' } })
    expect(screen.getByText('No changes match these filters.')).toHaveAttribute('role', 'status')
    fireEvent.change(author, { target: { value: 'Boris' } })
    expect(document.querySelectorAll('.journal-entry')).toHaveLength(1)
    await expandEntries()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    fireEvent.change(object, { target: { value: '' } })
    fireEvent.change(author, { target: { value: '' } })
    expect(document.querySelectorAll('.journal-entry')).toHaveLength(3)
  })

  it('a revert asks in a dialog: “Cancel” sends nothing, “Revert” sends the revert', async () => {
    const fetchMock = stubRevert()
    renderPage(<DataPage screen={JournalView} />)
    await expandEntries()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('dialog', { name: 'Undo this change?' })).toHaveAccessibleDescription(journalUndoEffect(entry))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    const dialog = screen.getByRole('dialog', { name: 'Undo this change?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/change_log/12/revert', expect.objectContaining({ method: 'POST' })))
  })

  it('never falls back to the browser confirm()', async () => {
    const browserConfirm = vi.fn(() => true)
    vi.stubGlobal('confirm', browserConfirm)
    stubApi({ change_log: [{ rowid: 1, ...entry, actor: 'me', before_json: '{}', after_json: '{}' }] })
    renderPage(<DataPage screen={JournalView} />)
    await expandEntries()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(browserConfirm).not.toHaveBeenCalled()
  })

  it('reverting a family language change switches the interface at once', async () => {
    const settingsEntry = { ...entry, table_name: 'app_settings', before_json: '{"key":"language","value":"ru-RU"}', after_json: '{"key":"language","value":"en-US"}' }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ ok: true })
      if (String(input) === '/api/settings') return jsonResponse({ language: 'ru-RU', currency: 'USD' })
      return jsonResponse({ rows: [settingsEntry], columns: [] })
    }))
    try {
      renderPage(<DataPage screen={JournalView} />)
      await expandEntries()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo' }))
      await waitFor(() => expect(currentLanguage()).toBe('ru-RU'))
    } finally {
      await applyFamilyLanguage('en-US')
    }
  })

  it('a successful revert says so', async () => {
    stubRevert()
    renderPage(<DataPage screen={JournalView} />)
    await expandEntries()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Change undone: B'))
  })
})

describe('The Data section in Russian', () => {
  it('journal: table, operation and column words come from the Russian locale', async () => {
    await withLanguage('ru-RU', async () => {
      stubApi({ change_log: [{ id: 3, ts: '2031-10-05T08:00:00Z', actor: 'me', source: 'admin', table_name: 'assets', row_id: 5, op: 'update', before_json: '{"value":5600}', after_json: '{"value":5800}', reverts_id: null }] })
      renderPage(<DataPage screen={JournalView} />)
      expect(await screen.findByText(`${ru('data.journal.table.assets')} · ${ru('data.journal.human.value')}: 5 600 → 5 800`)).toBeInTheDocument()
      await expandEntries()
      expect(screen.getByRole('button', { name: ru('data.journal.revert') })).toBeInTheDocument()
    })
  })

  it('accounts: the header action, the account menu and the row\'s «Correct» follow the language', async () => {
    await withLanguage('ru-RU', async () => {
      stubApi({
        assets: [{ rowid: 1, date: '2031-05-31', class: 'bank', name: 'Brisaluna Bank', value: 5800, currency: 'EUR', member: 'Robin' }],
        currencies: [{ rowid: 1, code: 'EUR' }], members: [{ rowid: 1, name: 'Robin' }],
      })
      renderPage(<DataPage screen={AccountsView} />)
      expect(await within(header()).findByRole('button', { name: ru('data.accounts.add') })).toBeInTheDocument()
      await screen.findByRole('button', { name: /Brisaluna Bank/ })
      expect(screen.getByRole('button', { name: ru('data.accounts.menu') })).toBeInTheDocument()
      expect(await screen.findAllByRole('button', { name: ru('data.accounts.correctMonth', { month: fmtMonthYear('2031-05') }) })).toHaveLength(2)
    })
  })

  it('generic table: the row counter takes the Russian plural forms', async () => {
    await withLanguage('ru-RU', async () => {
      stubApi({ goals: [{ rowid: 1, id: 'a', name: 'A', target: 1 }, { rowid: 2, id: 'b', name: 'B', target: 1 }] })
      renderPage(<DataPage screen={GoalsScreen} />)
      expect(await screen.findByText(ru('data.table.rows', { count: 2 }))).toBeInTheDocument()
    })
    expect(new Set([1, 2, 5].map(count => ru('data.table.rows', { count }))).size).toBe(3)
  })

  it('loans: a closed loan is captioned in Russian, its dates follow the language', async () => {
    await withLanguage('ru-RU', async () => {
      stubApi({ loans: [{ rowid: 1, name: 'Car loan', principal: 24000, rate: 7.5, term_months: 24, monthly_payment: 1079.99, issue_date: '2023-06-01', payment_day: null, currency: 'RUB', member: 'Noa', type: 'consumer', status: 'closed', closed_date: '2025-06-02' }] })
      renderPage(<DataPage screen={LoansView} />)
      expect(await screen.findByText(ru('data.loans.closedOn', { date: '02.06.2025' }))).toBeInTheDocument()
      expect(screen.getByText(ru('data.loans.listing.closed', { date: '02.06.2025' }))).toBeInTheDocument()
      expect(screen.getByText(ru('data.loans.head.issued', { date: '01.06.2023' }))).toBeInTheDocument()
    })
  })
})

it('keeps raw payload behind technical details and explains removal of an added property valuation', async () => {
  stubApi({ change_log: [{ id: 30, ts: '2031-10-05T12:00:00Z', actor: 'Anna', source: 'admin', table_name: 'real_estate', row_id: 5, op: 'insert', before_json: null, after_json: '{"name":"Home","valuation_year":2026,"value":10000000,"currency":"RUB"}', reverts_id: null }] })
  renderPage(<DataPage screen={JournalView} />)
  const summary = await screen.findByText(/Home · 2026/)
  expect(summary).toHaveTextContent('Valuation')
  await expandEntries()
  const details = screen.getByText('Technical details').closest('details')!
  expect(details).not.toHaveAttribute('open')
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(screen.getByRole('dialog')).toHaveAccessibleDescription(expect.stringContaining('Remove this valuation. The remaining valuations stay unchanged.'))
})

it('names the known original change in a journal undo entry', async () => {
  const original = { id: 31, ts: '2031-10-05T12:00:00Z', actor: 'Anna', source: 'admin', table_name: 'real_estate', row_id: 5, op: 'insert', before_json: null, after_json: '{"name":"Home","valuation_year":2026,"value":10000000,"currency":"RUB"}', reverts_id: null }
  stubApi({ change_log: [{ ...original, id: 32, op: 'revert', before_json: null, after_json: null, reverts_id: 31 }, original] })
  renderPage(<DataPage screen={JournalView} />)
  expect(await screen.findByText(/Change undone: Home · 2026/)).toBeInTheDocument()
})

it('shows denomination-correct money and keeps unsupported private payloads hidden in details', async () => {
  stubPrivacyOn()
  const base = { id: 50, ts: '2031-10-05T12:00:00Z', actor: 'Anna', source: 'admin', table_name: 'assets', row_id: 5, op: 'update', before_json: '{"value":100,"currency":"USD"}', after_json: '{"value":200,"currency":"EUR"}', reverts_id: null }
  stubApi({ change_log: [base, { ...base, id: 51, table_name: 'availability_assessments', op: 'insert', before_json: null, after_json: '[123456]' }] })
  renderPage(<DataPage screen={JournalView} />, { dashboard: true })
  expect(await screen.findByText(/Accounts · Value: ••• → •••/)).toBeInTheDocument()
  await expandEntries()
  for (const details of screen.getAllByText('Technical details')) fireEvent.click(details)
  expect(document.body).not.toHaveTextContent('123456')
})

it('labels family settings and shows each recorded currency in visible summaries', async () => {
  const base = { id: 60, ts: '2031-10-05T12:00:00Z', actor: 'Anna', source: 'admin', table_name: 'assets', row_id: 5, op: 'update', before_json: '{"value":100,"currency":"USD"}', after_json: '{"value":200,"currency":"EUR"}', reverts_id: null }
  stubApi({ change_log: [base, { ...base, id: 61, table_name: 'app_settings', before_json: '{"key":"language","value":"en-US"}', after_json: '{"key":"language","value":"ru-RU"}' }, { ...base, id: 62, table_name: 'app_settings', before_json: '{"key":"auth_epoch","value":3}', after_json: '{"key":"auth_epoch","value":4}' }] })
  renderPage(<DataPage screen={JournalView} />)
  expect(await screen.findByText(/Accounts · Value: 100 USD → 200 EUR/)).toBeInTheDocument()
  expect(screen.getByText('Language: en-US → ru-RU')).toBeInTheDocument()
  expect(screen.getByText('Internal setting updated; see technical details')).toBeInTheDocument()
})


it('offers retry after a load error and recovers without an endless spinner', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(jsonResponse({ rows: [], columns: [] }))
  vi.stubGlobal('fetch', request)
  renderPage(<DataPage screen={JournalView} />)
  const retry = await screen.findByRole('button', { name: 'Retry' })
  expect(screen.queryByText('Loading…')).toBeNull()
  fireEvent.click(retry)
  expect(await screen.findByText('The change history is empty')).toBeInTheDocument()
})
