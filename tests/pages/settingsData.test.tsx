import { onTestFinished } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { DataView } from '../../src/pages/settings/DataView'
import { renderAdmin } from '../helpers/render'

describe('Settings → Data', () => {
  it('holds the backup and the maintenance on one page, the danger zone last', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const { container } = renderAdmin(<DataView />)
    const text = container.textContent!
    expect(text).toContain('Export CSV')
    expect(text.indexOf('Export CSV')).toBeLessThan(text.indexOf('Setup wizard'))
    expect(text.indexOf('Setup wizard')).toBeLessThan(text.indexOf('Replace or delete data'))
  })

  it('keeps destructive actions folded until requested, without sending a mutation', () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    renderAdmin(<DataView />)
    expect(screen.queryByRole('button', { name: 'Delete all family data' })).toBeNull()
    const details = screen.getByText('Replace or delete data').closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(screen.getByRole('button', { name: 'Delete all family data' })).toBeVisible()
    expect(screen.getByText('Download a backup before replacing or deleting data.')).toBeVisible()
    expect(fetchMock.mock.calls.flat().join(' ')).not.toContain('/api/wipe')
  })

  it('tells someone without the manage right once that this is view only', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    setAuth({ mode: 'telegram', me: { name: 'Robin', rights: { edit: true, vote: true, manage: false } } })
    onTestFinished(resetAuth)
    renderAdmin(<DataView />)
    expect(screen.getAllByText('Only family members who manage users and settings can change this')).toHaveLength(1)
  })
})
