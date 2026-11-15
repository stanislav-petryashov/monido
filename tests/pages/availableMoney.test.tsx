import { screen } from '@testing-library/react'
import { AvailableMoney } from '../../src/pages/AvailableMoney'
import { jsonResponse } from '../helpers/http'
import { renderAdmin, snapshotClient } from '../helpers/render'
import { makeSnapshot } from '../helpers/snapshot'

describe('Available money', () => {
  it('waits for the month\'s confirmations and lists the accounts to confirm', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => String(url).startsWith('/api/availability') ? Promise.resolve(jsonResponse({ assessments: [] })) : new Promise<Response>(() => {})))
    renderAdmin(<AvailableMoney />, { client: snapshotClient(makeSnapshot()), dashboard: true })
    expect(await screen.findByRole('heading', { name: 'Accounts for June 2031' })).toBeInTheDocument()
    expect(screen.getByText(/0 of 2 confirmed\./)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
