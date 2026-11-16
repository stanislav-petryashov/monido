import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { AccountsView } from '../../../src/pages/admin/AccountsView'
import { JournalView } from '../../../src/pages/admin/JournalView'
import { ParametersView } from '../../../src/pages/admin/ParametersView'
import { stubApi } from '../../helpers/http'
import { renderAdmin as renderPage } from '../../helpers/render'
import { resetAuth, setAuth } from '../../../src/lib/authState'

// The charts draw on a canvas that jsdom does not have: these tests do not look at them

afterEach(() => { window.history.replaceState(null, '', '/') })

describe('Rights in the screens', () => {
  const me = (edit: boolean, manage: boolean) => ({ name: 'Robin', rights: { edit, vote: true, manage } })
  afterEach(() => resetAuth())
  const assets = [{ rowid: 1, date: '2031-05-31', class: 'bank', name: 'Brisaluna Bank', value: 5800, currency: 'EUR', member: 'Robin' }]

  it('a viewer sees Accounts without add/edit/delete and with the view-only note', async () => {
    stubApi({ assets, monthly_cashflow: [], currencies: [{ rowid: 1, code: 'EUR' }], members: [{ rowid: 1, name: 'Robin' }] })
    setAuth({ me: me(false, false) })
    renderPage(<DataPage screen={AccountsView} />)
    expect(await screen.findByText('View only: editing is unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Account' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Correct/ })).toBeNull()
    expect((await screen.findAllByText('Brisaluna Bank')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Account actions' })).toBeNull()
  })

  it('a viewer has no Revert in the journal', async () => {
    stubApi({ change_log: [{ id: 3, ts: '2031-10-05T08:00:00Z', actor: 'me', source: 'admin', table_name: 'assets', row_id: 5, op: 'update', before_json: '{"value":5600}', after_json: '{"value":5800}', reverts_id: null }] })
    setAuth({ me: me(false, false) })
    renderPage(<DataPage screen={JournalView} />)
    expect(await screen.findByText('Accounts · Value: 5,600 → 5,800')).toBeInTheDocument()
    fireEvent.click(document.querySelector('.journal-entry > summary')!)
    await screen.findByText('Technical details')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.getByText('View only: editing is unavailable')).toBeInTheDocument()
  })

  it('an editor without manage has no Revert for a family setting, and keeps it for the rest', async () => {
    const line = { ts: '2031-10-05T08:00:00Z', actor: 'me', source: 'admin', op: 'update', reverts_id: null }
    stubApi({ change_log: [
      { ...line, id: 4, table_name: 'app_settings', row_id: 1, before_json: '{"key":"currency","value":"USD"}', after_json: '{"key":"currency","value":"EUR"}' },
      { ...line, id: 3, table_name: 'assets', row_id: 5, before_json: '{"value":5600}', after_json: '{"value":5800}' },
    ] })
    setAuth({ me: me(true, false) })
    renderPage(<DataPage screen={JournalView} />)
    await screen.findByText('Accounts · Value: 5,600 → 5,800')
    const rows = [...document.querySelectorAll<HTMLElement>('.journal-entry')]
    rows.forEach(row => fireEvent.click(row.querySelector('summary')!))
    await waitFor(() => expect(within(rows[1]).getByRole('button', { name: 'Undo' })).toBeInTheDocument())
    expect(within(rows[0]).queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(within(rows[1]).getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('a manager without edit sees family settings but no row edits', async () => {
    stubApi({ currencies: [{ rowid: 1, code: 'EUR' }], members: [{ rowid: 1, name: 'Robin' }] })
    setAuth({ me: me(false, true) })
    renderPage(<ParametersView />)
    expect(await screen.findByText('View only: editing is unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Only family members who manage users and settings can change this')).toBeNull()
    expect(await screen.findByRole('combobox', { name: 'Language' })).toBeEnabled()
    await screen.findByText('EUR', { selector: '.tag' })
    expect(screen.queryByRole('button', { name: /^Remove:/ })).toBeNull()
    // the danger zone lives on the Backup page now (it needs manage, not edit)
    expect(screen.queryByRole('button', { name: 'Delete all family data' })).toBeNull()
  })

  it('an editor on Parameters sees the manage note, no danger zone, and still edits currencies', async () => {
    stubApi({ currencies: [{ rowid: 1, code: 'EUR' }], members: [{ rowid: 1, name: 'Robin' }] })
    setAuth({ me: me(true, false) })
    renderPage(<ParametersView />)
    expect(await screen.findByText('Only family members who manage users and settings can change this')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete all family data' })).toBeNull()
    expect(await screen.findByRole('button', { name: 'Remove: EUR' })).toBeInTheDocument()
  })
})
