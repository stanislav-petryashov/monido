import { fireEvent, screen, waitFor } from '@testing-library/react'
import { jsonResponse } from '../helpers/http'
import { renderAdmin, testClient } from '../helpers/render'
import { useSaveFamilySetting } from '../../src/lib/familySettings'

vi.mock('../../src/i18n/client', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/i18n/client')>()),
  applyFamilyLanguage: vi.fn(async () => { throw new Error('locale chunk failed') }),
}))

function SaveButton() {
  const save = useSaveFamilySetting()
  return <button onClick={() => save.mutate({ language: 'ru-RU' })}>save</button>
}

describe('useSaveFamilySetting', () => {
  it('a locale that fails to load does not fail the save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ language: 'ru-RU', currency: 'USD' })))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const client = testClient()
    client.setQueryData(['admin', 'settings'], { language: 'en-US', currency: 'USD' })
    renderAdmin(<SaveButton />, { client })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(client.getQueryState(['admin', 'settings'])?.isInvalidated).toBe(true)
  })
})
