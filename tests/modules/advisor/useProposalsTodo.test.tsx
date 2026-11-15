import { screen, waitFor } from '@testing-library/react'
import { advisorClient } from '../../../src/modules/advisor/client'
import { useProposalsTodo } from '../../../src/modules/advisor/useProposalsTodo'
import type { ProposalsView } from '../../../src/domain/api'
import { ru, withLanguage } from '../../helpers/i18n'
import { jsonResponse as json } from '../../helpers/http'
import { renderWithClient } from '../../helpers/render'
import { acceptedGoal, pageOf, versionOf, viewOf } from './proposalViews'

/** /api/advisor/proposals answers `view` (a Response — that answer); returns how many times it was asked */
function stub(view: ProposalsView | Response) {
  const asked = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== '/api/advisor/proposals') return json({ error: { code: 'not_found' } }, 404)
    asked()
    return view instanceof Response ? view : json(view)
  }))
  return asked
}

/** The hook's rows as a list, to read them from the DOM */
function Probe() {
  const items = useProposalsTodo()
  return <ul>{items.map(i => <li key={i.key} data-to={i.to}>{i.label}</li>)}</ul>
}

afterEach(() => vi.unstubAllGlobals())

describe('the advisor on the second floor: proposals waiting for your vote', () => {
  it('is the advisor\'s to-do hook', () => {
    expect(advisorClient.overview?.todoHook).toBe(useProposalsTodo)
    expect(advisorClient.overview?.todo).toBeUndefined()
  })

  it('one row per open proposal the person has not voted on yet, by its title, to /advisor', async () => {
    const waiting = viewOf()
    const second = viewOf({ id: 4, current: versionOf({ id: 8, title: 'A bigger flat' }) })
    const votedProvisionally = viewOf({ id: 6, current: versionOf({ id: 9, title: 'A boat' }), you: { voter: true, vote: 'agree', settled: false, author: false } })
    const settled = viewOf({ id: 7, current: versionOf({ id: 10, title: 'Skis' }), you: { voter: true, vote: 'agree', settled: true, author: false } })
    const notAVoter = viewOf({ id: 8, current: versionOf({ id: 11, title: 'A dog' }), you: { voter: false, vote: null, settled: false, author: true } })
    stub(pageOf([waiting, second, votedProvisionally, settled, notAVoter, acceptedGoal()]))
    renderWithClient(<Probe />)
    await screen.findByText('Vote: A car on credit')
    const rows = screen.getAllByRole('listitem')
    // a provisional vote is still waiting to be counted, as the server counts it
    expect(rows.map(r => r.textContent)).toEqual(['Vote: A car on credit', 'Vote: A bigger flat', 'Vote: A boat'])
    for (const row of rows) expect(row).toHaveAttribute('data-to', '/advisor')
  })

  it('speaks Russian', async () => {
    stub(pageOf([viewOf()]))
    await withLanguage('ru-RU', async () => {
      renderWithClient(<Probe />)
      expect(await screen.findByText(ru('modules.advisor.todoProposal', { title: 'A car on credit' }))).toBeInTheDocument()
    })
  })

  it('nothing without the council, nothing on an error', async () => {
    const asked = stub(pageOf([], { available: false }))
    const { unmount } = renderWithClient(<Probe />)
    await waitFor(() => expect(asked).toHaveBeenCalled())
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    unmount()
    const failed = stub(json({ error: { code: 'internal' } }, 500))
    renderWithClient(<Probe />)
    await waitFor(() => expect(failed).toHaveBeenCalled())
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
