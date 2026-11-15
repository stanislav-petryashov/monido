import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../../src/App'
import { reloadAuth, setAuth } from '../../src/lib/authState'
import { makeSnapshot } from '../helpers/snapshot'
import { snapshotQueryKey } from '../../src/lib/useFinanceData'
import { queryClient } from '../../src/lib/queryClient'
import { AppShell } from '../../src/components/layout/AppShell'
import { applyFamilyLanguage, initClientI18n } from '../../src/i18n/client'
import recordsEn from '../../src/locales/records/en-US.json'
import recordsRu from '../../src/locales/records/ru-RU.json'
import { jsonResponse, stubApi } from '../helpers/http'
import { ru } from '../helpers/i18n'
import { renderWithSnapshot, testClient } from '../helpers/render'
import { correctButton, typeText } from '../helpers/adminScreens'

// The Records and Settings screens as the app draws them: inside DataPage, whose loader brings the `records` chunk.
// The language switch after the chunk is loaded; the first load is in recordsChunk.test.tsx, alone in its file.

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

beforeAll(() => initClientI18n('en-US'))
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/admin/')) return jsonResponse({ rows: [], columns: [] })
    return jsonResponse({ error: 'unavailable' }, 503)
  }))
  vi.stubGlobal('scrollTo', vi.fn())
  window.history.replaceState(null, '', '/accounts')
})

const renderApp = () => renderWithSnapshot(<AppShell />, undefined, { client: testClient(), notify: true })

describe('the records chunk', () => {
  it('the full App redraws formatted dashboard amounts when language changes', async () => {
    window.history.replaceState(null, '', '/')
    queryClient.clear()
    queryClient.setQueryData(snapshotQueryKey(null), makeSnapshot())
    setAuth({ mode: 'password', authenticated: true, setup: 'done', me: null })
    stubApi()
    const view = render(<App />)
    try {
      await screen.findAllByText('$136,673')
      await act(async () => { await applyFamilyLanguage('ru-RU') })
      await screen.findAllByText(text => text.replace(/\s/g, ' ') === '136 673 $')
    } finally {
      view.unmount()
      queryClient.clear()
      await act(async () => { await applyFamilyLanguage('en-US') })
    }
  })

  it('the full App preserves its editor when an auth reload adopts another family language', async () => {
    queryClient.clear()
    setAuth({ mode: 'password', authenticated: true, setup: 'done', me: null })
    stubApi({ assets: [{ rowid: 1, date: '2031-05-31', class: 'bank', name: 'Checking', member: 'Robin', currency: 'USD', value: 1234.5 }] }, {
      answer: { '/api/auth': () => jsonResponse({ mode: 'password', authenticated: true, setup: 'done', language: 'ru-RU' }) },
    })
    const view = render(<App />)
    try {
      fireEvent.click(await correctButton('May 2031'))
      const input = screen.getByLabelText('Balance')
      typeText(input, '12.')
      expect(input).toHaveValue('12.')
      await act(async () => { await reloadAuth() })
      expect(await screen.findByLabelText(ru('data.field.balance'))).toBe(input)
      expect(input).toHaveValue('12,')
      await act(async () => { await applyFamilyLanguage('en-US') })
      expect(screen.getByLabelText('Balance')).toBe(input)
      expect(input).toHaveValue('12.')
    } finally {
      view.unmount()
      queryClient.clear()
      await act(async () => { await applyFamilyLanguage('en-US') })
    }
  })

  it('keeps incomplete month values and the same editor through refetch and a language switch', async () => {
    const tables = { assets: [{ rowid: 1, date: '2031-05-31', class: 'bank', name: 'Checking', member: 'Robin', currency: 'USD', value: 100 }] }
    stubApi(tables)
    const client = testClient()
    renderWithSnapshot(<AppShell />, undefined, { client, notify: true })
    fireEvent.click(await correctButton('May 2031'))
    const input = screen.getByLabelText('Balance')
    typeText(input, '1,')
    expect(input).toHaveValue('1.')
    tables.assets[0].value = 999
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'assets'] }) })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    await act(async () => { await applyFamilyLanguage('ru-RU') })
    try {
      const translated = await screen.findByLabelText(ru('data.field.balance'))
      expect(translated).toBe(input)
      expect(translated).toHaveValue('1,')
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      await act(async () => { await applyFamilyLanguage('en-US') })
    }
    expect(screen.getByLabelText('Balance')).toBe(input)
    expect(input).toHaveValue('1.')
  })
  it('switching the family language after opening a Records screen shows it in the new language', async () => {
    renderApp()
    expect(await screen.findByText(recordsEn.data.accounts.empty)).toBeInTheDocument()
    await act(async () => { await applyFamilyLanguage('ru-RU') })
    try {
      expect(await screen.findByText(recordsRu.data.accounts.empty)).toBeInTheDocument()
    } finally {
      await act(async () => { await applyFamilyLanguage('en-US') })
    }
  })
})
