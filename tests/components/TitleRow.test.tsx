import { createRef, type ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TitleRow } from '../../src/components/layout/TitleRow'
import { Freshness } from '../../src/components/layout/Freshness'
import { CurrencySwitch } from '../../src/components/layout/CurrencySwitch'
import { WarningsMenu } from '../../src/components/layout/WarningsMenu'
import { PACKAGE_URL } from '../../src/lib/imageRepo'
import { resetAuth, setAuth } from '../../src/lib/authState'
import type { FinanceSnapshot } from '../../src/domain/types'
import { emptySnapshot, makeSnapshot } from '../helpers/snapshot'
import { renderWithSnapshot } from '../helpers/render'
import { ru, withLanguage } from '../helpers/i18n'
import { monthTitle } from '../../src/i18n/dates'
import { VIEW_STORAGE_KEY } from '../../src/lib/currencyState'

type Props = Partial<ComponentProps<typeof TitleRow>>

/** The row as AppShell draws it: the data line as the subtitle; no snapshot in the cache is the loading state */
const renderRow = (snapshot?: FinanceSnapshot, props: Props = {}) =>
  renderWithSnapshot(<TitleRow title="Overview" subtitle={<Freshness />} drawerOpen={false} onMenu={() => {}} menuButtonRef={createRef()} {...props} />, snapshot)
const subtitle = () => document.querySelector('.title-row__subtitle')

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2031-11-05T09:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('TitleRow', () => {
  it('draws the title as the h1 with the subtitle under it, and the controls in the end cluster', () => {
    renderRow(makeSnapshot())
    const h1 = screen.getByRole('heading', { level: 1, name: 'Overview' })
    expect(h1).toHaveAttribute('id', 'page-title')
    expect(h1).toHaveClass('title-row__title')
    expect(h1.compareDocumentPosition(subtitle()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide amounts' }).closest('.title-row__tools')).not.toBeNull()
  })

  it('does not reserve a page-action cluster when there are no actions', () => {
    renderRow(makeSnapshot())
    expect(document.querySelector('.title-row__end')).toBeNull()
  })

  it('has the hamburger that opens the drawer, before the title', () => {
    const onMenu = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    renderRow(makeSnapshot(), { onMenu, menuButtonRef: ref, drawerOpen: true })
    const menu = screen.getByRole('button', { name: 'Open menu' })
    expect(menu).toBe(ref.current)
    expect(menu).toHaveClass('title-row__menu')
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    expect(menu).toHaveAttribute('aria-controls', 'app-sidebar')
    expect(menu.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(menu)
    expect(onMenu).toHaveBeenCalledTimes(1)
  })

  it('renders the primary action before the currency pills, after the eye; no period pills', () => {
    renderRow(makeSnapshot(), { primary: <button>Close month</button>, actions: <CurrencySwitch /> })
    const end = document.querySelector('.title-row__end')!
    const eye = screen.getByRole('button', { name: 'Hide amounts' })
    const primary = screen.getByRole('button', { name: 'Close month' })
    const pills = screen.getByRole('group', { name: 'Currency' })
    expect(end).toContainElement(primary)
    expect(end).toContainElement(pills)
    expect(eye.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(primary.compareDocumentPosition(pills) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Period' })).toBeNull()
  })

  it('keeps ordinary short history out of the data-warning counter', () => {
    renderRow(makeSnapshot({ warnings: [{ code: 'short_history' }] }))
    expect(screen.queryByRole('button', { name: /Data warnings/ })).toBeNull()
  })

  it('still counts actual data warnings alongside a short history', () => {
    renderRow(makeSnapshot({ warnings: [{ code: 'short_history' }, { code: 'missing_balance', params: { name: 'Savings', month: '2031-06' } }] }))
    expect(screen.getByRole('button', { name: 'Data warnings: 1' })).toBeInTheDocument()
  })

  it('has no theme, language or account controls: they live in the side menu', () => {
    setAuth({ mode: 'password', authenticated: true })
    try {
      renderRow(makeSnapshot())
      expect(screen.queryByRole('button', { name: /^(Dark|Light) theme$/ })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Language' })).toBeNull()
      expect(screen.queryByRole('button', { name: /account menu/ })).toBeNull()
    } finally {
      resetAuth()
    }
  })

  it('says in the subtitle how fresh the data is and links to data entry when it is stale', () => {
    renderRow(makeSnapshot())
    const link = screen.getByRole('link', { name: /June 2031/ })
    expect(subtitle()).toContainElement(link)
    expect(link).toHaveTextContent('Data for June 2031 · 5 mo ago')
    expect(link).toHaveAttribute('href', '/close')
    // the age is the warning, not the whole line
    expect(link.querySelector('.title-row__stale')).toHaveTextContent('5 mo ago')
    expect(link.querySelector('.title-row__stale')).not.toHaveTextContent('Data for')
  })

  it('one finished month waiting to be closed is routine, not stale: no age, no warning', () => {
    const base = makeSnapshot()
    // today is in November 2031 (5 months after June): October is finished and open, September is closed
    renderRow(makeSnapshot({ asOf: { ...base.asOf, closedMonth: '2031-09' } }))
    expect(subtitle()).toHaveTextContent('Data for September 2031')
    expect(subtitle()?.querySelector('.title-row__stale')).toBeNull()
    expect(screen.queryByRole('link', { name: /September 2031/ })).toBeNull()
  })

  it('builds the freshness line from one key in Russian', async () => {
    await withLanguage('ru-RU', () => {
      const base = makeSnapshot()
      renderRow(makeSnapshot({ asOf: { ...base.asOf, closedMonth: '2031-10' } }))
      const line = ru('nav.dataFor').replace('<month/>', monthTitle(ru, '2031-10')).replace(/<\/?lead>/g, '')
      expect(subtitle()?.textContent).toBe(line)
    })
  })

  it('does not nag when last month is closed', () => {
    const base = makeSnapshot()
    renderRow(makeSnapshot({ asOf: { ...base.asOf, closedMonth: '2031-10' } }))
    expect(subtitle()).toHaveTextContent('Data for October 2031')
    expect(screen.queryByRole('link', { name: /October 2031/ })).toBeNull()
    expect(screen.queryByText(/ago/)).toBeNull()
  })

  it('names the month of the balances when no month has flows (Cash flow off)', () => {
    const base = makeSnapshot()
    renderRow(makeSnapshot({ asOf: { ...base.asOf, closedMonth: null, capitalDate: '2031-10-31' } }))
    expect(subtitle()).toHaveTextContent('Data for October 2031')
    expect(screen.queryByText('No data yet')).toBeNull()
  })

  it('invites to enter data when there is none', () => {
    renderRow(emptySnapshot())
    expect(screen.getByRole('link', { name: 'No data yet' })).toHaveAttribute('href', '/close')
  })

  it("shows the base currency's rate to the dollar after the month, and nothing for dollars", () => {
    const base = makeSnapshot()
    const { unmount } = renderRow(makeSnapshot({ asOf: { ...base.asOf, closedMonth: '2031-10' }, baseCurrency: 'RUB', rates: { date: '2031-06-30', perUsd: 83.99 } }))
    expect(subtitle()?.textContent).toBe('Data for October 2031 · 1 USD = 83.99 RUB')
    unmount()
    renderRow(makeSnapshot({ asOf: { ...base.asOf, closedMonth: '2031-10' } }))
    expect(subtitle()?.textContent).toBe('Data for October 2031')
  })

  it('shows no rate placeholder while a dollar snapshot loads, and one for another currency', () => {
    // nothing in the cache: the snapshot is loading (fetch never answers)
    const { unmount } = renderRow()
    expect(subtitle()?.textContent ?? '').toBe('')
    unmount()
    sessionStorage.setItem(VIEW_STORAGE_KEY, 'RUB')
    try {
      renderRow()
      expect(subtitle()).toHaveTextContent('Rate…')
    } finally {
      sessionStorage.removeItem(VIEW_STORAGE_KEY)
    }
  })
})

describe('WarningsMenu', () => {
  const warnings = [
    { code: 'missing_balance' as const, ref: 'Quillmark Bank|Robin', params: { name: 'Quillmark Bank', member: 'Robin', month: '2031-05' } },
    { code: 'short_history' as const },
  ]

  it('hides behind a counter and opens on demand', () => {
    render(<WarningsMenu warnings={warnings} />)
    const button = screen.getByRole('button', { name: 'Data warnings: 2' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('No balance for “Quillmark Bank” (Robin) in 2031-05')).toBeNull()
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('closes on Escape and gives the focus back', () => {
    render(<WarningsMenu warnings={warnings} />)
    const button = screen.getByRole('button', { name: 'Data warnings: 2' })
    fireEvent.click(button)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listitem')).toBeNull()
    expect(button).toHaveFocus()
  })

  it('renders nothing without warnings', () => {
    const { container } = render(<WarningsMenu warnings={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('WarningsMenu notices', () => {
  it('shows an update notice with the package link and the command', () => {
    render(<WarningsMenu warnings={[]} notices={[{ key: 'update', content: <span>Version 0.11.0 is available</span> }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Notices: 1' }))
    expect(screen.getByText('Version 0.11.0 is available')).toBeInTheDocument()
  })

  it('with a notice the counter is named neutrally, warnings included', async () => {
    const notices = [{ key: 'update', content: <span>Version 0.11.0 is available</span> }]
    render(<WarningsMenu warnings={[{ code: 'short_history' as const }]} notices={notices} />)
    expect(screen.getByRole('button', { name: 'Notices: 2' })).toBeInTheDocument()
    await withLanguage('ru-RU', () => waitFor(() => expect(screen.getByRole('button', { name: ru('common.notices', { value: 2 }) })).toBeInTheDocument()))
  })
})

describe('TitleRow update notice', () => {
  it('links to the package page and gives the update command', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/version'
      ? new Response(JSON.stringify({ version: '0.9.0', latest: '0.10.0', behind: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Promise(() => {})))
    renderRow(makeSnapshot())
    fireEvent.click(await screen.findByRole('button', { name: 'Notices: 1' }))
    expect(screen.getByText(/Version 0\.10\.0 is available/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /package/i })).toHaveClass('link-accent')
    expect(screen.getByRole('link', { name: /ghcr|package/i })).toHaveAttribute('href', PACKAGE_URL)
    expect(screen.getByText('docker compose pull && docker compose up -d').tagName).toBe('CODE')
  })
})
