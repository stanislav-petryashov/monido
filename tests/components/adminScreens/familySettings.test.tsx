import { languageName } from '../../../src/i18n/languages'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { setAuth } from '../../../src/lib/authState'
import { FamilySettings } from '../../../src/pages/admin/FamilySettings'
import { jsonResponse, sent, stubApi } from '../../helpers/http'
import { renderAdmin, testClient } from '../../helpers/render'

/**
 * The Language and currency block alone, its settings already in the cache; each language is shown by its own name
 * (from Intl) from the first render.
 */
function renderBlock(settings: { language: string; currency: string } | null, currencies = ['USD', 'EUR']) {
  // the server holds the same settings: a refetch changes nothing
  const fetchMock = stubApi({}, { answer: settings ? { 'GET /api/settings': () => jsonResponse(settings) } : {} })
  const client = testClient()
  if (settings) client.setQueryData(['admin', 'settings'], settings)
  renderAdmin(<FamilySettings currencies={currencies} />, { client })
  return fetchMock
}

const VIEWER = { edit: true, vote: true, manage: false }
const russian = languageName('ru-RU')

describe('FamilySettings', () => {
  it('a manager picks among the languages, each by its own name', async () => {
    const fetchMock = renderBlock({ language: 'en-US', currency: 'USD' })
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked()
    expect(screen.getByRole('radio', { name: russian })).not.toBeChecked()
    // the currency beside it saves on change (a language change would switch the whole test run's language)
    fireEvent.change(screen.getByRole('combobox', { name: 'Currency for totals' }), { target: { value: 'EUR' } })
    await waitFor(() => expect(sent(fetchMock, 'PUT')).toEqual([{ method: 'PUT', url: '/api/settings', body: { currency: 'EUR' } }]))
  })

  it('a viewer sees the family language as text, by its own name', () => {
    setAuth({ mode: 'telegram', authenticated: true, me: { name: 'Anna', rights: VIEWER } })
    renderBlock({ language: 'en-US', currency: 'USD' })
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText('USD')).toBeInTheDocument()
  })

  it('shows date order as a choice instead of a separate example', () => {
    renderBlock({ language: 'en-US', currency: 'USD' })
    expect(screen.getByRole('combobox', { name: 'Date format' })).toHaveValue('dmy')
  })

  it('a family currency no longer among the project currencies is still offered, first', () => {
    renderBlock({ language: 'en-US', currency: 'GBP' })
    expect(Array.from(screen.getByRole('combobox', { name: 'Currency for totals' }).querySelectorAll('option')).map(r => (r as HTMLOptionElement).value)).toEqual(['GBP', 'USD', 'EUR'])
    expect(screen.getByRole('combobox', { name: 'Currency for totals' })).toHaveValue('GBP')
  })

  it('before the settings are read there is no language, currency, picker or preview', () => {
    renderBlock(null)
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByText(/USD|EUR/)).toBeNull()
  })
})
