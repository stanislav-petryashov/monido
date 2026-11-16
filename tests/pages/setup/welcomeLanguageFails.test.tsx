import { fireEvent, screen, waitFor } from '@testing-library/react'
import * as client from '../../../src/i18n/client'
import { calls, renderWizard, stubSetupApi } from '../../helpers/setup'

// the real switch for everything but the one pick below, which fails as a locale file that cannot be loaded would
vi.mock('../../../src/i18n/client', async importOriginal => {
  const original = await importOriginal<typeof import('../../../src/i18n/client')>()
  return { ...original, applyFamilyLanguage: vi.fn(original.applyFamilyLanguage) }
})

beforeEach(() => sessionStorage.clear())
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

describe('WelcomeStep when the language switch fails', () => {
  it('puts the pick back, says so, and Start saves nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(client.applyFamilyLanguage).mockRejectedValueOnce(new Error('chunk load failed'))
    const fetchMock = stubSetupApi()
    renderWizard()
    const start = await screen.findByRole('button', { name: 'Start' })
    await waitFor(() => expect(start).toBeEnabled())
    const language = document.querySelector<HTMLOptionElement>('option[value="ru-RU"]')!.closest('select')!
    fireEvent.change(language, { target: { value: 'ru-RU' } })
    expect(await screen.findByText('Could not switch the language. Check the connection and try again.')).toBeInTheDocument()
    expect(language).toHaveValue('en-US')
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('heading', {})).toHaveTextContent('Where shall we start?'))
    expect(calls(fetchMock, 'PUT')).toEqual([])
  })
})
