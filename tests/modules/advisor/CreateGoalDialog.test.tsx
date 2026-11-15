import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { ProposalsSection } from '../../../src/modules/advisor/ProposalsSection'
import { loadLocaleChunk } from '../../../src/i18n/client'
import { jsonResponse as json } from '../../helpers/http'
import { renderAdmin } from '../../helpers/render'
import { acceptedGoal, pageOf, stubCouncil, versionOf, viewOf } from './proposalViews'

beforeAll(() => loadLocaleChunk('advisor'))
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2031-10-08T12:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

/** The Create goal form: it opens once the goals it picks a free key among have loaded, Cancel working from the start */
const goalForm = async () => {
  const dialog = await screen.findByRole('dialog', { name: 'Create a goal' })
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create' })).toBeEnabled())
  return dialog
}

/** The accepted proposal's history row: its goal action is there, without opening the card */
async function openKitchen() {
  return (await screen.findByRole('button', { name: 'A new kitchen' })).closest('li') as HTMLElement
}

const KITCHEN_ROW = { rowid: 1, id: 'new-kitchen', name: 'New kitchen', target: 5000, current: 0, target_date: '2031-12-31', currency: 'EUR', emoji: null }

describe('Advisor page: Create goal', () => {
  it('Create goal opens the prefilled form; Create posts the goal then links it; the proposal then links to its goal on Goals', async () => {
    const calls = stubCouncil(pageOf([acceptedGoal()]), {
      goals: [KITCHEN_ROW],
      onWrite: (call, state) => {
        if (call.url === '/api/admin/goals') return { ...call.body as object, rowid: 2 }
        return pageOf([{ ...state.proposals[0], goal: { id: 'new-kitchen-2', deleted: false } }])
      },
    })
    renderAdmin(<ProposalsSection />)
    const kitchen = await openKitchen()
    fireEvent.click(within(kitchen).getByRole('button', { name: 'Create goal' }))
    const dialog = await goalForm()
    expect(dialog).toHaveTextContent('Choose “Create” to save the goal')
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('New kitchen')
    expect(within(dialog).getByRole('textbox', { name: /^Amount/ })).toHaveValue('12,000')
    expect(within(dialog).getByRole('combobox', { name: 'Currency' })).toHaveValue('EUR')
    expect(within(dialog).getByRole('textbox', { name: 'Target month' })).toHaveValue('06/2032')
    // nothing is written before the press
    expect(calls).toEqual([])
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Amount/ }), { target: { value: '13000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(calls).toEqual([
      // the key is free among the goals: the name's slug is taken
      { url: '/api/admin/goals', method: 'POST', body: { id: 'new-kitchen-2', name: 'New kitchen', target: 13000, current: 0, target_date: '2032-06-30', currency: 'EUR', emoji: null } },
      { url: '/api/advisor/proposals/5/goal', method: 'PUT', body: { goalId: 'new-kitchen-2' } },
    ]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await screen.findAllByText('Goal created')).length).toBeGreaterThan(0)
    expect(await within(kitchen).findByRole('link', { name: 'Open the goal' })).toHaveAttribute('href', '/goals?goal=new-kitchen-2')
    expect(within(kitchen).queryByRole('button', { name: 'Create goal' })).toBeNull()
    expect(within(kitchen).queryByText('The goal is not created yet')).toBeNull()
  })

  it('a proposal linked to a goal elsewhere meanwhile: Create makes no second goal', async () => {
    const calls = stubCouncil(pageOf([acceptedGoal()]))
    renderAdmin(<ProposalsSection />)
    const kitchen = await openKitchen()
    fireEvent.click(within(kitchen).getByRole('button', { name: 'Create goal' }))
    const dialog = await goalForm()
    const council = fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => (String(input) === '/api/advisor/proposals' && !init?.method
      ? json(pageOf([{ ...acceptedGoal(), goal: { id: 'kitchen', deleted: false } }]))
      : council(input, init)))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('The proposal is already linked to a goal')).toBeInTheDocument()
    expect(calls).toEqual([])
  })

  it('a link refused because another goal was linked first deletes the goal just made', async () => {
    const calls = stubCouncil(pageOf([acceptedGoal()]), {
      onWrite: call => {
        if (call.url === '/api/admin/goals') return { ...call.body as object, rowid: 2 }
        if (call.method === 'DELETE') return { deleted: true }
        return json({ error: { code: 'advisor.goal_linked' } }, 409)
      },
    })
    renderAdmin(<ProposalsSection />)
    fireEvent.click(within(await openKitchen()).getByRole('button', { name: 'Create goal' }))
    fireEvent.click(within(await goalForm()).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(calls.map(c => `${c.method} ${c.url}`)).toEqual(['POST /api/admin/goals', 'PUT /api/advisor/proposals/5/goal', 'DELETE /api/admin/goals/2']))
  })

  it('the row says the goal is not created yet; after a failed link the next press links the same goal, never a second one', async () => {
    let linkFails = true
    const calls = stubCouncil(pageOf([acceptedGoal()]), {
      onWrite: (call, state) => {
        if (call.url === '/api/admin/goals') return { ...call.body as object, rowid: 2 }
        if (linkFails) return json({ error: { code: 'internal' } }, 500)
        return pageOf([{ ...state.proposals[0], goal: { id: 'new-kitchen', deleted: false } }])
      },
    })
    renderAdmin(<ProposalsSection />)
    const kitchen = await openKitchen()
    expect(within(kitchen).getByText('The goal is not created yet')).toBeInTheDocument()
    fireEvent.click(within(kitchen).getByRole('button', { name: 'Create goal' }))
    fireEvent.click(within(await goalForm()).getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('The goal is created, but could not be linked to the proposal')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    linkFails = false
    fireEvent.click(within(kitchen).getByRole('button', { name: 'Create goal' }))
    expect(await within(kitchen).findByRole('link', { name: 'Open the goal' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'POST /api/admin/goals', 'PUT /api/advisor/proposals/5/goal', 'PUT /api/advisor/proposals/5/goal',
    ])
    expect(calls[2].body).toEqual({ goalId: 'new-kitchen' })
  })

  it('Create goal shows it is loading until the goals are read, then opens the form; Cancel closes it', async () => {
    let release = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    stubCouncil(pageOf([acceptedGoal()]))
    const real = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/admin/goals') await gate
      return real(input, init)
    }))
    renderAdmin(<ProposalsSection />)
    const kitchen = await openKitchen()
    const button = within(kitchen).getByRole('button', { name: 'Create goal' })
    fireEvent.click(button)
    // the form waits for the rows: the press shows that it is on, a second one does nothing
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'))
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(within(kitchen).getByText('Loading…')).toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).toBeNull()
    release()
    const dialog = await goalForm()
    // one currency control: the select, no suffix on the amount (as the Goals form)
    expect(within(dialog).getByRole('textbox', { name: 'Amount' })).toBeInTheDocument()
    expect(dialog.querySelector('.input-unit__suffix')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a save-up proposal takes its title and target month; a failed create keeps the form and links nothing', async () => {
    const saveUp = acceptedGoal({
      type: 'save_up',
      current: versionOf({ id: 11, title: 'A new kitchen', scenario: { kind: 'save_up', amount: 9000, currency: 'USD', targetMonth: '2032-03' } }),
    })
    const calls = stubCouncil(pageOf([saveUp]), { onWrite: () => json({ error: { code: 'invalid_param', params: { param: 'target' } } }, 400) })
    renderAdmin(<ProposalsSection />)
    fireEvent.click(within(await openKitchen()).getByRole('button', { name: 'Create goal' }))
    const dialog = await goalForm()
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('A new kitchen')
    expect(within(dialog).getByRole('textbox', { name: 'Target month' })).toHaveValue('03/2032')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Could not create the goal')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(calls.map(c => c.url)).toEqual(['/api/admin/goals'])
  })

  it('an empty name is refused before anything is sent', async () => {
    const calls = stubCouncil(pageOf([acceptedGoal()]))
    renderAdmin(<ProposalsSection />)
    fireEvent.click(within(await openKitchen()).getByRole('button', { name: 'Create goal' }))
    const dialog = await goalForm()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: '  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Give the goal a name')).toBeInTheDocument()
    expect(calls).toEqual([])
  })

  it('a deleted goal says so; no Create goal without the right or for a credit; nothing before the decision', async () => {
    stubCouncil(pageOf([acceptedGoal({ goal: { id: 'new-kitchen', deleted: true } })]))
    const first = renderAdmin(<ProposalsSection />)
    const kitchen = await openKitchen()
    expect(within(kitchen).getByText('The goal made from this proposal was deleted')).toBeInTheDocument()
    expect(within(kitchen).queryByRole('link', { name: 'Open the goal' })).toBeNull()
    expect(within(kitchen).queryByRole('button', { name: 'Create goal' })).toBeNull()
    first.unmount()

    stubCouncil(pageOf([acceptedGoal()], { canCreateGoal: false }))
    const second = renderAdmin(<ProposalsSection />)
    expect(within(await openKitchen()).queryByRole('button', { name: 'Create goal' })).toBeNull()
    second.unmount()

    stubCouncil(pageOf([viewOf({ id: 4, status: 'accepted', decidedAt: '2031-10-05T10:00:00.000Z' }), acceptedGoal({ status: 'open', decidedAt: null })]))
    renderAdmin(<ProposalsSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'A car on credit' }))
    const car = await screen.findByRole('article', { name: /A car on credit/ })
    expect(within(car).queryByRole('button', { name: 'Create goal' })).toBeNull()
    const open = await screen.findByRole('article', { name: /A new kitchen/ })
    expect(within(open).queryByRole('button', { name: 'Create goal' })).toBeNull()
  })
})

it('failed goal read prevents creation until retry succeeds', async () => {
  const calls = stubCouncil(pageOf([acceptedGoal()]))
  const real = globalThis.fetch
  let fail = true
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/admin/goals' && fail ? json({}, 503) : real(input, init))
  renderAdmin(<ProposalsSection />)
  const kitchen = await openKitchen()
  fireEvent.click(within(kitchen).getByRole('button', { name: 'Create goal' }))
  expect(await within(kitchen).findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: 'Create a goal' })).toBeNull()
  expect(calls).toEqual([])
  fail = false
  fireEvent.click(within(kitchen).getByRole('button', { name: 'Retry' }))
  expect(await goalForm()).toBeInTheDocument()
  expect(calls).toEqual([])
})
