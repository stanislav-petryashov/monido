import type { ReactElement } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AppShell } from '../../src/components/layout/AppShell'
import { Login } from '../../src/pages/Login'
import { DataPage } from '../../src/pages/admin/DataPage'
import { AccountsView } from '../../src/pages/admin/AccountsView'
import { MonthCloseView } from '../../src/pages/admin/MonthCloseView'
import { ParametersView } from '../../src/pages/admin/ParametersView'
import { UsersView } from '../../src/pages/settings/UsersView'
import { NotificationsPage } from '../../src/modules/reminders/NotificationsPage'
import { GoalsScreen } from '../../src/modules/goals/GoalsScreen'
import { NotifyProvider } from '../../src/components/NotifyProvider'
import { Catalog } from '../../design/Catalog'
import { useConfirm } from '../../src/lib/notifyState'
import { resetAuth, setAuth } from '../../src/lib/authState'
import type { CatchUpState, RemindersView } from '../../src/domain/api'
import { renderAdmin, renderWithSnapshot, stubSnapshotFetch, expandDisclosures } from '../helpers/render'
import { demoFamilyData } from '../helpers/demoFamily'
import { makeSnapshot } from '../helpers/snapshot'
import { jsonResponse, stubApi } from '../helpers/http'
import { authSettingsView, BOT_READY } from '../helpers/authSettings'
import { base, stubState } from '../helpers/monthClose'
import { axeViolations } from '../helpers/axe'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

const { snapshot } = await demoFamilyData()

// a screen or dialog alone, without the shell that gives the page its landmarks, its heading and its title
const SCREEN_ONLY = ['region', 'landmark-one-main', 'page-has-heading-one', 'document-title']

// a title left by an earlier test would hide a page that sets none
beforeEach(() => { document.title = ''; vi.stubGlobal('scrollTo', vi.fn()) })
afterEach(() => { act(() => resetAuth()); window.history.replaceState(null, '', '/') })

it('the helper reports a violation (axe runs in this environment)', async () => {
  render(<button />)
  expect(await axeViolations(document, SCREEN_ONLY)).toEqual([expect.stringMatching(/^button-name \(critical\)/)])
})

describe('dashboard pages in the shell', () => {
  beforeEach(stubSnapshotFetch)

  const shell = async (path: string, marker: string, data = snapshot) => {
    window.history.replaceState(null, '', path)
    renderWithSnapshot(<AppShell />, data, { notify: true })
    await screen.findAllByText(marker)
    expandDisclosures()
    // the expandable rows of Income and expenses (the capital bridge and an expense category)
    for (const row of document.querySelectorAll<HTMLElement>('main :is(.cc-row, .cf-row)[aria-expanded="false"]')) fireEvent.click(row)
  }

  it.each([
    ['/', 'Whose assets'],
    ['/assets', 'Accounts and property'],
    ['/cashflow', 'Where the money went'],
    ['/goals', 'Saved'],
    ['/health', 'Current stability'],
  ])('%s', async (path, marker) => {
    await shell(path, marker)
    expect(await axeViolations()).toEqual([])
  })

  it('a page with data warnings', async () => {
    await shell('/assets', 'Accounts and property', makeSnapshot())
    expect(screen.getByText(/^Data warnings/)).toBeInTheDocument()
    expect(await axeViolations()).toEqual([])
  })

  it('the account menu open', async () => {
    setAuth({ mode: 'telegram', authenticated: true, me: { name: 'Anna', rights: { edit: true, vote: true, manage: true } } })
    await shell('/', 'Whose assets')
    const trigger = screen.getByRole('button', { name: /, account menu$/ })
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(await axeViolations()).toEqual([])
  })
})

describe('Login', () => {
  it.each([
    ['password', { mode: 'password', authenticated: false }],
    ['Telegram', { mode: 'telegram', authenticated: false }],
    ['provider', { mode: 'oidc', authenticated: false, provider: 'auth.example.org' }],
  ] as const)('%s mode', async (_, auth) => {
    setAuth(auth)
    render(<Login />)
    expect(await axeViolations()).toEqual([])
  })
})

const screenOnly = async (ui: ReactElement, ready: () => Promise<unknown>) => {
  renderAdmin(ui)
  await ready()
  expandDisclosures()
  return axeViolations(document, SCREEN_ONLY)
}

describe('Records and Settings screens', () => {
  it('Accounts', async () => {
    stubApi({
      assets: [
        { rowid: 1, date: '2031-05-31', class: 'bank', name: 'Brisaluna Bank', value: 5800, currency: 'EUR', member: 'Robin' },
        { rowid: 2, date: '2031-05-31', class: 'bank', name: 'Quillmark Bank', value: 100, currency: 'RUB', member: 'Robin' },
      ],
      monthly_cashflow: [{ rowid: 1, date: '2031-05-01', bank: 'Brisaluna Bank', member: 'Robin', active_income: 0, passive_income: 500, expense: 1350, currency: 'EUR' }],
      currencies: [{ rowid: 1, code: 'EUR' }],
      members: [{ rowid: 1, name: 'Robin' }],
    })
    expect(await screenOnly(<DataPage screen={AccountsView} />, () => screen.findByRole('heading', { name: 'Income and expenses by month' }))).toEqual([])
  })

  it('Close month: the wizard', async () => {
    stubState(base)
    expect(await screenOnly(<DataPage screen={MonthCloseView} />, () => screen.findByRole('list', { name: 'Month queue' }))).toEqual([])
  })

  it('Close month: the catch-up grid', async () => {
    const grid: CatchUpState = {
      months: ['2031-06'], leftOut: null, newest: '2031-07',
      rows: [
        { name: 'Quillmark Bank', member: 'Robin', currency: 'RUB', class: 'bank', cells: [null] },
        { name: 'Deposit', member: 'Robin', currency: 'RUB', class: 'bank', cells: [null] },
      ],
      lastKnown: { '["Quillmark Bank","Robin"]': 5800, '["Deposit","Robin"]': 500 },
      revision: 'grid-1',
    }
    stubState({ ...base, catchUp: true }, undefined, undefined, grid)
    const ready = async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Catch up 2 months' }))
      await screen.findByRole('region', { name: /Catch up/ })
    }
    expect(await screenOnly(<DataPage screen={MonthCloseView} />, ready)).toEqual([])
  })

  it('Settings, General', async () => {
    stubApi({
      parameters: [{ rowid: 1, key: 'inflation_rate', value: 10, description: 'Current' }],
      currencies: [{ rowid: 1, code: 'EUR' }, { rowid: 2, code: 'ARS' }],
      fx_manual_rates: [{ rowid: 1, currency: 'ARS', date: '2026-01-01', per_usd: 1500 }],
      members: [{ rowid: 1, name: 'Robin' }],
    })
    expect(await screenOnly(<DataPage screen={ParametersView} />, () => screen.findByRole('combobox', { name: 'Language' }))).toEqual([])
  })

  it('Goals records', async () => {
    stubApi({ goals: [{ rowid: 1, id: 'fire', name: 'FIRE', target: 640000 }] })
    expect(await screenOnly(<DataPage screen={GoalsScreen} />, () => screen.findByText('FIRE'))).toEqual([])
  })

  it('Settings, Family and access', async () => {
    const rights = { edit: true, vote: true, manage: true }
    setAuth({ mode: 'telegram', authenticated: true, me: { name: 'Anna', rights } })
    const users = {
      mode: 'telegram', bot: { configured: true, username: 'family_bot', problem: null }, meId: 1, provider: null,
      users: [
        { id: 1, member: 'Anna', telegram: '@anna', invitePending: false, rights, identity: false },
        { id: 2, member: 'Boris', telegram: null, invitePending: false, rights: { ...rights, manage: false }, identity: false },
      ],
    }
    stubApi({ members: [{ rowid: 1, name: 'Anna' }, { rowid: 2, name: 'Boris' }] }).answer({
      'GET /api/users': () => jsonResponse(users),
      'GET /api/family-telegram': () => jsonResponse({ users: users.users.map(u => ({ userId: u.id, signIn: true, reminders: false, proposals: true, conversation: true })), groups: [] }),
      'GET /api/auth-settings': () => jsonResponse(authSettingsView({ ...BOT_READY, mode: 'telegram', stored: 'telegram' })),
      'GET /api/reminders': () => jsonResponse(REMINDERS),
    })
    expect(await screenOnly(<UsersView />, () => screen.findByRole('region', { name: 'Members' }))).toEqual([])
  })

  it('Notifications', async () => {
    stubApi().answer({
      'GET /api/users': () => jsonResponse({ users: [], mode: 'password', meId: null, bot: { configured: true, username: 'family_bot', problem: null } }),
      'GET /api/family-telegram': () => jsonResponse({ users: [], groups: [] }),
      'GET /api/reminders': () => jsonResponse(REMINDERS),
      'GET /api/auth-settings': () => jsonResponse(authSettingsView({ ...BOT_READY, mode: 'password', stored: 'password' })),
    })
    expect(await screenOnly(<NotificationsPage />, () => screen.findByRole('button', { name: 'Check delivery' }))).toEqual([])
  })
})

const REMINDERS: RemindersView = {
  configured: true, linked: true, openMonths: ['2031-09'], next: null,
  settings: { enabled: true, startDay: 3, hour: 10, timezone: 'UTC', chatTitle: null, lastSentAt: null, lastError: null },
  recipients: [{ id: 'user:1', title: 'Anna', kind: 'user', enabled: true }, { id: 'group:-100', title: 'Family', kind: 'group', enabled: true }],
}

describe('dialogs and the catalog', () => {
  it('a confirmation dialog', async () => {
    function Ask() {
      const confirm = useConfirm()
      return <button onClick={() => void confirm({ title: 'Delete the account?', text: 'The whole month history will be deleted.', confirmLabel: 'Delete', tone: 'danger' })}>Ask</button>
    }
    render(<NotifyProvider><main><h1>Accounts</h1><Ask /></main></NotifyProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByRole('dialog', { name: 'Delete the account?' })
    expect(await axeViolations(document, SCREEN_ONLY)).toEqual([])
  })

  it('the design catalog', async () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<Catalog />)
    screen.getByRole('main')
    // the title is static in design/index.html
    expect(await axeViolations(document, ['document-title'])).toEqual([])
  })
})
