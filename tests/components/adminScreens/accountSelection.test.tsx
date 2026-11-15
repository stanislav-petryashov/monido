import { fireEvent, screen, waitFor } from '@testing-library/react'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { AccountsView } from '../../../src/pages/admin/AccountsView'
import { jsonResponse, NO_SPENDING } from '../../helpers/http'
import { renderAdmin as renderPage } from '../../helpers/render'
import { accountMenu } from '../../helpers/adminScreens'

// The charts draw on a canvas that jsdom does not have: these tests do not look at them

describe('Accounts screen: the selection follows the refreshed list', () => {
  it('after an atomic rename succeeds, selection follows the refreshed account', async () => {
    const assets = [{ rowid: 1, date: '2031-05-31', class: 'bank', name: 'Quillmark Bank', value: 100, currency: 'RUB', member: 'Robin' }]
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/accounts/update' && init?.method === 'POST') { Object.assign(assets[0], JSON.parse(String(init.body)).values); return jsonResponse({ saved: true }) }
      if (init?.method && init.method !== 'GET') return jsonResponse({ ok: true })
      if (url === '/api/month-close') return jsonResponse({ lastClosed: { month: '2031-05', reopenable: false } })
      if (url === '/api/spending') return jsonResponse(NO_SPENDING)
      if (url === '/api/admin/assets') return jsonResponse({ rows: assets, columns: [] })
      if (url === '/api/admin/currencies') return jsonResponse({ rows: [{ rowid: 1, code: 'RUB' }] })
      if (url === '/api/admin/members') return jsonResponse({ rows: [{ rowid: 1, name: 'Robin' }] })
      return jsonResponse({ rows: [], columns: [] })
    }))
    renderPage(<DataPage screen={AccountsView} />)
    await screen.findByRole('button', { name: /Quillmark Bank/ })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search accounts' }), { target: { value: '  ROBIN  ' } })
    expect(screen.getByRole('button', { name: /Quillmark Bank/ })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search accounts' }), { target: { value: 'no match' } })
    expect(screen.getByText('Selected account is outside the results')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search accounts' }), { target: { value: '' } })
    await accountMenu('Account settings')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Pine Bank' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Account saved'))
    await waitFor(() => expect(document.querySelector('.acc-head__name')).toHaveTextContent('Pine Bank'))
    expect(screen.queryByRole('button', { name: /Quillmark Bank/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Pine Bank/ })).toHaveAttribute('aria-current', 'true')
  })
})

it('switches the account pane to list and detail views when its container narrows', async () => {
  let resize: ResizeObserverCallback = () => {}
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback } observe() {} disconnect() {} })
  const { useRecordPane } = await import('../../../src/pages/admin/useRecordPane')
  const { act, render } = await import('@testing-library/react')
  function Pane() {
    const pane = useRecordPane(true)
    return <div ref={pane.containerRef}><span>{pane.visible ? 'Detail visible' : 'List only'}</span><button onClick={pane.open}>Open</button><button onClick={pane.back}>Back</button></div>
  }
  render(<Pane />)
  act(() => resize([{ contentRect: { width: 700 } } as ResizeObserverEntry], {} as ResizeObserver))
  expect(screen.getByText('List only')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
  expect(screen.getByText('Detail visible')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByText('List only')).toBeInTheDocument()
  vi.unstubAllGlobals()
})
