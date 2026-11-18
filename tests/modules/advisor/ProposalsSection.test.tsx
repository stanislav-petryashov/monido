import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { PrivacyContext } from '../../../src/lib/privacy'
import { ProposalsSection } from '../../../src/modules/advisor/ProposalsSection'
import { loadLocaleChunk } from '../../../src/i18n/client'
import { jsonResponse as json } from '../../helpers/http'
import { renderAdmin } from '../../helpers/render'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { CREDIT, MILA, R7_EVALUATION, R7_SCENARIO, R7_VERDICT, acceptedGoal, impactOf, pageOf, stubCouncil, versionOf, viewOf, votes } from './proposalViews'

beforeAll(() => loadLocaleChunk('advisor'))
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2031-10-08T12:00:00Z'))
})
afterEach(() => {
  resetAuth()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

const card = (title: string) => screen.findByRole('article', { name: new RegExp(title) })
const row = (list: HTMLElement, label: string) => within(list).getByText(label).closest('tr, dl') as HTMLElement

describe('Advisor page: proposals', () => {
  it('keeps voting and impact visible while details are collapsed', async () => {
    stubCouncil(pageOf([viewOf()]))
    renderAdmin(<ProposalsSection />)
    const car = await card('A car on credit')
    expect(within(car).getByRole('button', { name: 'Agree' })).toBeInTheDocument()
    expect(within(car).getByRole('group', { name: 'Consequences of the decision' })).toBeInTheDocument()
    expect(within(car).queryByText(/Claude’s assessment/)).toBeNull()
    fireEvent.click(within(car).getByText('Reasoning and details'))
    expect(await within(car).findByText(/Claude’s assessment/)).toBeInTheDocument()
  })

  it('lists open proposals with their numbers, assessment, votes and deadline; history below with who agreed', async () => {
    const open = viewOf({ current: versionOf({ votes: votes({ vote: 'agree', settled: true, comment: 'Fine by me' }, null) }) })
    stubCouncil(pageOf([open, acceptedGoal(), viewOf({ id: 4, status: 'withdrawn', decidedAt: '2031-10-04T08:00:00.000Z', current: versionOf({ id: 9, title: 'A boat' }) })]))
    renderAdmin(<ProposalsSection />)

    const car = await card('A car on credit')
    expect(car).toHaveAttribute('id', 'proposal-3')
    expect(within(car).getByText('Waiting for votes')).toBeInTheDocument()
    expect(within(car).getByText(/From Ryan/)).toBeInTheDocument()
    expect(within(car).getByText('Shall we buy the car?')).toBeInTheDocument()
    const numbers = within(car).getByRole('group', { name: 'Consequences of the decision' })
    expect(row(numbers, 'Monthly payment')).toHaveTextContent('518.96 USD')
    expect(within(row(numbers, 'Loan payments of income')).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Now12.3%', 'After21.5%'])
    expect(row(numbers, 'Loan payments of income')).toHaveTextContent('norm under 30%')
    expect(within(row(numbers, 'Left for living')).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Now2,400.50 USD', 'After1,881.54 USD'])
    expect(within(row(numbers, 'Emergency fund')).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Now6.2 mo', 'After5.0 mo'])
    expect(row(numbers, 'Goals that move')).toHaveTextContent('Vacation +3 mo')
    fireEvent.click(within(car).getByText('Reasoning and details'))
    expect(await within(car).findByText('Claude’s assessment: moderate risk. The payment fits, but the fund gets thin')).toBeInTheDocument()
    expect(within(car).getByText(/^Suggests: borrow less, 24,000.00 USD/)).toBeInTheDocument()
    const people = within(car).getByRole('list', { name: 'Votes' })
    const [ryan, annika, mila] = within(people).getAllByRole('listitem')
    expect(ryan).toHaveTextContent('Ryan')
    expect(ryan).toHaveTextContent('agrees')
    expect(annika).toHaveTextContent('Annika')
    expect(annika).toHaveTextContent('“Fine by me”')
    expect(mila).toHaveTextContent('has not voted')
    expect(within(car).getByText('Decide by 10/16/2031')).toBeInTheDocument()

    // the decided ones only in the history, latest decision first, accepted with who agreed
    const history = screen.getByRole('region', { name: 'History' })
    const items = within(history).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Accepted')
    expect(items[0]).toHaveTextContent('A new kitchen')
    expect(items[0]).toHaveTextContent('Annika · Accepted 10/05/2031')
    expect(items[0]).toHaveTextContent('agreed: Ryan, Annika, Mila')
    expect(items[1]).toHaveTextContent('Withdrawn')
    expect(items[1]).not.toHaveTextContent('agreed')
    // expandable to its card
    expect(screen.queryByRole('article', { name: /A new kitchen/ })).toBeNull()
    fireEvent.click(within(items[0]).getByRole('button', { name: 'A new kitchen' }))
    expect(await card('A new kitchen')).toBeInTheDocument()
    expect(within(items[0]).getByRole('button', { name: 'A new kitchen' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('says so when there is nothing open and nothing decided', async () => {
    stubCouncil(pageOf([]))
    renderAdmin(<ProposalsSection />)
    expect(await screen.findByText(/No open proposals/)).toBeInTheDocument()
    expect(screen.getByText('No decided proposals yet.')).toBeInTheDocument()
  })

  it('a voter sees Agree / Against, votes with a comment through the dialog and the list updates from the answer', async () => {
    const calls = stubCouncil(pageOf([viewOf()]), {
      onWrite: (_call, state) => pageOf([{ ...state.proposals[0], you: { voter: true, vote: 'agree', settled: true, author: false }, current: versionOf({ votes: votes({ vote: 'agree', settled: true, comment: 'Go for it' }, null) }) }]),
    })
    renderAdmin(<ProposalsSection />)
    const car = await card('A car on credit')
    fireEvent.click(within(car).getByRole('button', { name: 'Agree' }))
    const dialog = await screen.findByRole('dialog', { name: 'Agree with “A car on credit”' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Comment/ }), { target: { value: 'Go for it' } })
    expect(within(dialog).getByRole('textbox', { name: /Comment/ })).toHaveAttribute('maxLength', '500')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agree' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/advisor/proposals/3/votes', method: 'POST', body: { vote: 'agree', versionId: 7, comment: 'Go for it' } }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await within(car).findByText('“Go for it”')).toBeInTheDocument()
    // the Agree button is gone: the focus is on the card
    await waitFor(() => expect(document.activeElement).toBe(car))
    // after an agree: change to against, or add a comment; no second agree
    expect(within(car).queryByRole('button', { name: 'Agree' })).toBeNull()
    expect(within(car).getByRole('button', { name: 'Change vote to Against' })).toBeInTheDocument()
    expect(within(car).getByRole('button', { name: 'Add a comment' })).toBeInTheDocument()
  })

  it('against without a comment sends no comment; a refusal is told and the dialog stays', async () => {
    let refuse = true
    const calls = stubCouncil(pageOf([viewOf()]), {
      onWrite: (_call, state) => (refuse
        ? json({ error: { code: 'advisor.proposal_closed' } }, 409)
        : pageOf([{ ...state.proposals[0], status: 'revising' }])),
    })
    renderAdmin(<ProposalsSection />)
    fireEvent.click(within(await card('A car on credit')).getByRole('button', { name: 'Against' }))
    const dialog = await screen.findByRole('dialog', { name: 'Vote against “A car on credit”' })
    expect(dialog).toHaveTextContent('goes back to Ryan for revision')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Against' }))
    expect(await screen.findByText('Could not record the vote')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    refuse = false
    fireEvent.click(within(dialog).getByRole('button', { name: 'Against' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls[1]).toEqual({ url: '/api/advisor/proposals/3/votes', method: 'POST', body: { vote: 'against', versionId: 7 } })
    expect(await screen.findByText('Back for revision')).toBeInTheDocument()
  })

  it('"Add a comment" posts to /comment', async () => {
    const agreed = viewOf({ you: { voter: true, vote: 'agree', settled: true, author: false }, current: versionOf({ votes: votes({ vote: 'agree', settled: true }, null) }) })
    const calls = stubCouncil(pageOf([agreed]))
    renderAdmin(<ProposalsSection />)
    fireEvent.click(within(await card('A car on credit')).getByRole('button', { name: 'Add a comment' }))
    const dialog = await screen.findByRole('dialog', { name: 'Comment on “A car on credit”' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save comment' }))
    expect(await screen.findByText('Write the comment first')).toBeInTheDocument()
    expect(calls).toEqual([])
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Comment' }), { target: { value: 'After the bonus' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save comment' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/advisor/proposals/3/comment', method: 'POST', body: { comment: 'After the bonus', versionId: 7 } }]))
  })

  it('"Change vote to Against" opens the against dialog', async () => {
    const agreed = viewOf({ you: { voter: true, vote: 'agree', settled: true, author: false } })
    stubCouncil(pageOf([agreed]))
    renderAdmin(<ProposalsSection />)
    fireEvent.click(within(await card('A car on credit')).getByRole('button', { name: 'Change vote to Against' }))
    expect(await screen.findByRole('dialog', { name: 'Vote against “A car on credit”' })).toBeInTheDocument()
  })

  it('the author sees Withdraw behind a confirm; others do not; nobody votes on a revising or closed proposal', async () => {
    const mine = viewOf({ you: { voter: true, vote: 'agree', settled: true, author: true } })
    const revisingMine = viewOf({ id: 6, status: 'revising', you: { voter: true, vote: 'agree', settled: true, author: true }, current: versionOf({ id: 12, title: 'A bike' }) })
    const revisingTheirs = viewOf({ id: 8, status: 'revising', you: { voter: true, vote: 'against', settled: true, author: false }, current: versionOf({ id: 14, title: 'A sofa', votes: votes({ vote: 'against', settled: true }, null) }) })
    const notVoter = viewOf({ id: 9, you: { voter: false, vote: null, settled: false, author: false }, current: versionOf({ id: 15, title: 'A tent' }) })
    const calls = stubCouncil(pageOf([mine, revisingMine, revisingTheirs, notVoter, acceptedGoal()]), {
      onWrite: (_call, state) => pageOf(state.proposals.map(p => (p.id === 3 ? { ...p, status: 'withdrawn' as const, decidedAt: '2031-10-08T12:00:00.000Z' } : p))),
    })
    renderAdmin(<ProposalsSection />)

    const car = await card('A car on credit')
    expect(within(car).queryByRole('button', { name: 'Agree' })).toBeNull()
    expect(within(car).queryByRole('button', { name: 'Against' })).toBeNull()
    expect(within(car).queryByRole('button', { name: 'Add a comment' })).toBeNull()
    const bike = await card('A bike')
    expect(within(bike).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
    expect(within(bike).queryByRole('button', { name: 'Agree' })).toBeNull()
    const sofa = await card('A sofa')
    expect(within(sofa).queryByRole('button')).toBeNull()
    expect(within(sofa).getByText('Back with Ryan for revision')).toBeInTheDocument()
    expect(within(await card('A tent')).queryByRole('button')).toBeNull()
    fireEvent.click(within(screen.getByRole('region', { name: 'History' })).getByRole('button', { name: 'A new kitchen' }))
    const kitchen = await card('A new kitchen')
    expect(within(kitchen).queryByRole('button', { name: /Agree|Against|Withdraw|comment/ })).toBeNull()

    fireEvent.click(within(car).getByRole('button', { name: 'Withdraw' }))
    const confirm = await screen.findByRole('dialog', { name: 'Withdraw “A car on credit”?' })
    expect(calls).toEqual([])
    fireEvent.click(within(confirm).getByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/advisor/proposals/3/withdraw', method: 'POST' }]))
    // decided now: it moves to the history
    await waitFor(() => expect(screen.queryByRole('article', { name: /A car on credit/ })).toBeNull())
    const row = within(screen.getByRole('region', { name: 'History' })).getByRole('button', { name: 'A car on credit' })
    // the card left with the button: the focus is on its history row
    await waitFor(() => expect(document.activeElement).toBe(row))
    expect(row).toHaveAttribute('aria-controls')
    expect(document.getElementById(row.getAttribute('aria-controls')!)).not.toBeNull()
  })

  it('version 2 shows the was → now list and the previous version behind a toggle', async () => {
    const v1 = versionOf({ votes: votes({ vote: 'against', settled: true, comment: 'Too long a loan' }, null) })
    const v2 = versionOf({
      id: 8, number: 2, scenario: { ...CREDIT, termMonths: 48 }, question: 'A shorter loan then?',
      evaluation: { impact: impactOf({ scenario: { ...CREDIT, termMonths: 48 }, after: { ...impactOf().after, savingsPerMonth: 300 } }), alternatives: [] },
      changes: {
        scenario: [{ field: 'termMonths', before: 60, after: 48 }],
        numbers: [{ key: 'savingsPerMonth', before: 381, after: 300 }, { key: 'debtPaymentPct', before: 21.5, after: 23 }],
      },
    })
    stubCouncil(pageOf([viewOf({ current: v2, previous: [v1] })]))
    renderAdmin(<ProposalsSection />)
    const car = await card('A car on credit')
    expect(within(car).getByText('Version 2')).toBeInTheDocument()
    fireEvent.click(within(car).getByText('Reasoning and details'))
    const changes = await within(car).findByRole('list', { name: 'Compared with version 1:' })
    expect(within(changes).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Term: 60 mo → 48 mo',
      // the numbers block shows the payment share itself
      'Savings a month: 381.00 USD → 300.00 USD',
    ])
    expect(within(car).queryByText('Too long a loan', { exact: false })).toBeNull()
    const toggle = within(car).getByRole('button', { name: 'Show earlier versions' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(within(car).getByRole('button', { name: 'Hide earlier versions' })).toHaveAttribute('aria-expanded', 'true')
    const earlier = within(car).getByRole('region', { name: 'Version 1' })
    expect(within(earlier).getByText('Shall we buy the car?')).toBeInTheDocument()
    expect(within(earlier).getByText('“Too long a loan”')).toBeInTheDocument()
    expect(within(earlier).queryByRole('button', { name: 'Agree' })).toBeNull()
  })

  it('a link to #proposal-<id> opens that proposal once the data loads and focuses its card, also in the history', async () => {
    window.history.replaceState(null, '', '/advisor#proposal-5')
    stubCouncil(pageOf([viewOf(), acceptedGoal()]))
    renderAdmin(<ProposalsSection />)
    const kitchen = await card('A new kitchen')
    expect(kitchen).toHaveAttribute('tabindex', '-1')
    await waitFor(() => expect(document.activeElement).toBe(kitchen))
  })

  it('an open proposal named by the link takes the focus too', async () => {
    window.history.replaceState(null, '', '/advisor#proposal-3')
    stubCouncil(pageOf([viewOf(), acceptedGoal()]))
    renderAdmin(<ProposalsSection />)
    const car = await card('A car on credit')
    await waitFor(() => expect(document.activeElement).toBe(car))
  })

  it('an agree still in the bot\'s comment window offers no comment here, only the change to against', async () => {
    const pending = viewOf({ you: { voter: true, vote: 'agree', settled: false, author: false } })
    stubCouncil(pageOf([pending]))
    renderAdmin(<ProposalsSection />)
    const car = await card('A car on credit')
    expect(within(car).getByRole('button', { name: 'Change vote to Against' })).toBeInTheDocument()
    expect(within(car).queryByRole('button', { name: 'Add a comment' })).toBeNull()
    expect(within(car).queryByRole('button', { name: 'Agree' })).toBeNull()
  })

  it('the votes are marked with icons and a word for screen readers', async () => {
    stubCouncil(pageOf([viewOf()]))
    renderAdmin(<ProposalsSection />)
    const people = within(await card('A car on credit')).getByRole('list', { name: 'Votes' })
    for (const li of within(people).getAllByRole('listitem')) {
      expect(li.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
      expect(li.textContent).not.toMatch(/[✓✗⏳]/u)
    }
  })

  it('a deleted voter is left out of the votes', async () => {
    const view = viewOf({ current: versionOf({ votes: votes(null, null).map(v => (v.userId === MILA ? { ...v, member: '' } : v)) }) })
    stubCouncil(pageOf([view]))
    renderAdmin(<ProposalsSection />)
    const people = within(await card('A car on credit')).getByRole('list', { name: 'Votes' })
    const items = within(people).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent(/^Ryan/)
    expect(items[1]).toHaveTextContent(/^Annika/)
    expect(screen.getByText('Answered 1 of 2')).toBeInTheDocument()
  })

  it('the date line says what the status means: decide by, waiting for a new version, accepted, withdrawn, expired', async () => {
    const deadline = '2031-10-16T09:00:00.000Z'
    const decided = '2031-10-05T10:00:00.000Z'
    stubCouncil(pageOf([
      viewOf(),
      viewOf({ id: 6, status: 'revising', current: versionOf({ id: 12, title: 'A bike' }) }),
      acceptedGoal(),
      viewOf({ id: 4, status: 'withdrawn', decidedAt: decided, current: versionOf({ id: 9, title: 'A boat' }) }),
      viewOf({ id: 8, status: 'expired', decidedAt: decided, deadlineAt: decided, current: versionOf({ id: 14, title: 'A sofa' }) }),
    ]))
    renderAdmin(<ProposalsSection />)
    expect(within(await card('A car on credit')).getByText('Decide by 10/16/2031')).toBeInTheDocument()
    expect(within(await card('A bike')).getByText('Waiting for a new version until 10/16/2031, then it expires')).toBeInTheDocument()
    expect(deadline).toBe(viewOf().deadlineAt)
    const items = within(screen.getByRole('region', { name: 'History' })).getAllByRole('listitem')
    expect(items.map(li => li.querySelector('.proposal__meta')?.textContent)).toEqual([
      'Annika · Accepted 10/05/2031', 'Ryan · Withdrawn 10/05/2031', 'Ryan · Expired 10/05/2031',
    ])
    fireEvent.click(within(items[2]).getByRole('button', { name: 'A sofa' }))
    expect(within(await card('A sofa')).getByText('Expired 10/05/2031')).toBeInTheDocument()
    expect(within(await card('A sofa')).queryByText(/Decided/)).toBeNull()
  })

  it('a refused write (a version replaced or closed meanwhile) reloads the proposals', async () => {
    stubCouncil(pageOf([viewOf()]), { onWrite: () => json({ error: { code: 'advisor.proposal_replaced', params: { number: 2 } } }, 409) })
    const fetch = vi.mocked(globalThis.fetch)
    const reads = () => fetch.mock.calls.filter(([url, init]) => url === '/api/advisor/proposals' && (init?.method ?? 'GET') === 'GET').length
    renderAdmin(<ProposalsSection />)
    fireEvent.click(within(await card('A car on credit')).getByRole('button', { name: 'Agree' }))
    const dialog = await screen.findByRole('dialog', { name: 'Agree with “A car on credit”' })
    const before = reads()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agree' }))
    expect(await screen.findByText('Could not record the vote')).toBeInTheDocument()
    await waitFor(() => expect(reads()).toBeGreaterThan(before))
  })

  it('the author of a proposal back for revision sees the next step: revise it with Claude', async () => {
    const revisingMine = viewOf({ id: 6, status: 'revising', you: { voter: true, vote: 'agree', settled: true, author: true }, current: versionOf({ id: 12, title: 'A bike' }) })
    const revisingTheirs = viewOf({ id: 8, status: 'revising', current: versionOf({ id: 14, title: 'A sofa' }) })
    stubCouncil(pageOf([revisingMine, revisingTheirs]))
    renderAdmin(<ProposalsSection />)
    const bike = await card('A bike')
    expect(within(bike).getByText('The proposal is back with you. To recalculate, tell Claude: “revise the proposal about A bike”; it will see the comment.')).toBeInTheDocument()
    expect(within(bike).queryByText('Back with Ryan for revision')).toBeNull()
    const sofa = await card('A sofa')
    expect(within(sofa).getByText('Back with Ryan for revision')).toBeInTheDocument()
    expect(within(sofa).queryByText(/tell Claude/)).toBeNull()
  })

  it('one\'s own vote still in the bot\'s comment window reads not counted yet; another\'s reads has not voted', async () => {
    setAuth({ mode: 'telegram', me: { name: 'Annika', rights: { edit: true, vote: true, manage: false } } })
    const pending = viewOf({
      you: { voter: true, vote: 'agree', settled: false, author: false },
      current: versionOf({ votes: votes({ vote: 'agree', settled: false }, { vote: 'against', settled: false }) }),
    })
    stubCouncil(pageOf([pending]))
    renderAdmin(<ProposalsSection />)
    const people = within(await card('A car on credit')).getByRole('list', { name: 'Votes' })
    const [, annika, mila] = within(people).getAllByRole('listitem')
    expect(annika).toHaveTextContent('not counted yet')
    expect(annika).not.toHaveTextContent('has not voted')
    expect(mila).toHaveTextContent('has not voted')
    expect(mila).not.toHaveTextContent('not counted yet')
  })

  it('a provisional vote left on a frozen proposal (another member was against) is not "not counted yet": it will never settle', async () => {
    setAuth({ mode: 'telegram', me: { name: 'Annika', rights: { edit: true, vote: true, manage: false } } })
    const frozen = viewOf({
      status: 'revising',
      you: { voter: true, vote: 'agree', settled: false, author: false },
      current: versionOf({ votes: votes({ vote: 'agree', settled: false }, { vote: 'against', settled: true }) }),
    })
    stubCouncil(pageOf([frozen]))
    renderAdmin(<ProposalsSection />)
    const people = within(await card('A car on credit')).getByRole('list', { name: 'Votes' })
    const [, annika] = within(people).getAllByRole('listitem')
    expect(annika).not.toHaveTextContent('not counted yet')
    expect(annika).toHaveTextContent('has not voted')
  })

  it('a member who does not vote on an open proposal is told why there are no buttons', async () => {
    const notVoter = viewOf({ you: { voter: false, vote: null, settled: false, author: false } })
    const voter = viewOf({ id: 9, current: versionOf({ id: 15, title: 'A tent' }) })
    stubCouncil(pageOf([notVoter, voter]))
    renderAdmin(<ProposalsSection />)
    expect(within(await card('A car on credit')).getByText('You do not vote on this proposal')).toBeInTheDocument()
    expect(within(await card('A tent')).queryByText('You do not vote on this proposal')).toBeNull()
  })

  it('a goal move keeps its unit with its number; a save-up or goal proposal has no loan-payment share row', async () => {
    const reached = impactOf({ goals: [{ goalId: 'g2', name: 'Boat', before: null, after: '2032-06', shiftMonths: null, statusBefore: 'unreachable', statusAfter: 'on_track' }] })
    stubCouncil(pageOf([viewOf(), acceptedGoal(), viewOf({ id: 9, current: versionOf({ id: 15, title: 'A tent', evaluation: { impact: reached, alternatives: [] } }) })]))
    renderAdmin(<ProposalsSection />)
    const numbers = within(await card('A car on credit')).getByRole('group', { name: 'Consequences of the decision' })
    expect(row(numbers, 'Goals that move').querySelector('dd')?.textContent).toBe('Vacation +3\u00a0mo')
    // a goal out of reach before is reached in a month of a year
    const tent = within(await card('A tent')).getByRole('group', { name: 'Consequences of the decision' })
    expect(row(tent, 'Goals that move').querySelector('dd')?.textContent).toBe('Boat reached in June\u00a02032')
    fireEvent.click(within(screen.getByRole('region', { name: 'History' })).getByRole('button', { name: 'A new kitchen' }))
    const kitchen = within(await card('A new kitchen')).getByRole('group', { name: 'Consequences of the decision' })
    expect(within(kitchen).queryByText('Loan payments of income')).toBeNull()
    expect(row(kitchen, 'Left for living')).toBeInTheDocument()
    expect(row(kitchen, 'Emergency fund')).toBeInTheDocument()
    expect(row(kitchen, 'Goals that move')).toBeInTheDocument()
  })

  it('R7: a goal proposal shows the goal\'s own line, no unchanged numbers and the later date with its contribution, as the Telegram card', async () => {
    const renovation = viewOf({
      id: 12, type: 'goal',
      current: versionOf({ id: 21, title: 'New goal: save for a renovation', question: 'Shall we start a renovation goal?', scenario: R7_SCENARIO, evaluation: R7_EVALUATION, verdict: R7_VERDICT }),
    })
    stubCouncil(pageOf([renovation]))
    renderAdmin(<ProposalsSection />)
    const goal = within(await card('New goal: save for a renovation'))
    fireEvent.click(goal.getByText('Reasoning and details'))
    expect(await goal.findByText('Renovation: by January 2029 instead of December 2027; the money goes to it from April 2028, 2,137.74 USD a month')).toBeInTheDocument()
    const numbers = goal.getByRole('group', { name: 'Consequences of the decision' })
    for (const label of ['Loan payments of income', 'Left for living', 'Emergency fund']) expect(within(numbers).queryByText(label)).toBeNull()
    expect(row(numbers, 'Goals that move')).toHaveTextContent('Financial independence (FIRE) by 55 +10 mo')
    expect(goal.getByText('Suggests: a later date, January 2029 (the money goes to it from April 2028, 2,013.41 USD a month)')).toBeInTheDocument()
  })

  it('drops the same lines as the Telegram card: amounts equal in whole units, a was-line that reads the same there', async () => {
    const impact = impactOf({ after: { ...impactOf().after, leftForLiving: 2400.9, debtPaymentPct: 12.31 } })
    const v2 = versionOf({
      id: 8, number: 2, evaluation: { impact, alternatives: [] },
      changes: { scenario: [{ field: 'termMonths', before: 60, after: 72 }], numbers: [{ key: 'savingsPerMonth', before: 381.2, after: 380.9 }] },
    })
    stubCouncil(pageOf([viewOf({ current: v2, previous: [versionOf()] })]))
    renderAdmin(<ProposalsSection />)
    const car = within(await card('A car on credit'))
    const numbers = car.getByRole('group', { name: 'Consequences of the decision' })
    // 2,400.50 → 2,400.90 is $2,401 on both sides in Telegram: the site leaves it out too
    expect(within(numbers).queryByText('Left for living')).toBeNull()
    expect(within(numbers).queryByText('Loan payments of income')).toBeNull()
    expect(row(numbers, 'Emergency fund')).toBeInTheDocument()
    fireEvent.click(car.getByText('Reasoning and details'))
    expect(await car.findByText('Term: 60 mo → 72 mo')).toBeInTheDocument()
    expect(car.queryByText(/Savings a month/)).toBeNull()
  })
})

it('masks both comparison amounts while retaining percentage and month comparisons', async () => {
  stubCouncil(pageOf([viewOf()]))
  renderAdmin(<PrivacyContext.Provider value={{ hidden: true, toggle: () => {} }}><ProposalsSection /></PrivacyContext.Provider>)
  const numbers = within(await card('A car on credit')).getByRole('group', { name: 'Consequences of the decision' })
  const money = within(row(numbers, 'Left for living')).getAllByRole('cell')
  expect(money.map(cell => cell.textContent)).toEqual(['Now•••', 'After•••'])
  expect(numbers).not.toHaveTextContent('2,400.50')
  expect(row(numbers, 'Monthly payment')).toHaveTextContent('•••')
  expect(row(numbers, 'Emergency fund')).toHaveTextContent('6.2 mo')
  expect(within(numbers).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Indicator', 'Now', 'After'])
})

it('an open vote dialog keeps the version it was opened on: after a revision it is refused again, never cast on the unread one', async () => {
  const v1 = pageOf([viewOf()])
  const v2 = pageOf([viewOf({ current: versionOf({ id: 8, number: 2, scenario: { ...CREDIT, amount: 90000 } }), previous: [versionOf()] })])
  let state = v1
  const writes: { versionId: number }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET'
    if (method === 'GET') return url === '/api/advisor/proposals' ? json(state) : json({ error: { code: 'not_found' } }, 404)
    const body = JSON.parse(String(init?.body)) as { versionId: number }
    writes.push(body)
    if (body.versionId !== 8) { state = v2; return json({ error: { code: 'advisor.version_changed', params: { number: 2 } } }, 409) }
    return json(state)
  }))
  renderAdmin(<ProposalsSection />)
  fireEvent.click(within(await card('A car on credit')).getByRole('button', { name: 'Agree' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Agree' }))
  await screen.findByText('Could not record the vote')
  await waitFor(() => expect(screen.getAllByText(/Version 2/).length).toBeGreaterThan(0))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Agree' }))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes.map(w => w.versionId)).toEqual([writes[0].versionId, writes[0].versionId])
  expect(writes[0].versionId).not.toBe(8)
})
