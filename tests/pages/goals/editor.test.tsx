// The Goals editors: «Update saved» and the editor in place, «move the deadline», the new-goal dialog, the live preview
// from planPreview, a draft without a rate, a failed save, viewers and the advisor link. The demo family on 12.11.2026.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Goals } from '../../../src/pages/Goals'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { DEMO_GOALS, goalsSnapshot, GOALS_TODAY } from '../../helpers/goals'
import { jsonResponse, sent, stubApi, WRITES } from '../../helpers/http'
import { renderWithSnapshot } from '../../helpers/render'

const ROWS = DEMO_GOALS.map((g, i) => ({ rowid: i + 1, ...g }))

function render(answer = {}) {
  const api = stubApi({ goals: ROWS, currencies: [{ rowid: 1, code: 'USD' }, { rowid: 2, code: 'EUR' }], members: [] },
    { answer: { '/api/snapshot': () => jsonResponse(goalsSnapshot()), ...answer } })
  const view = renderWithSnapshot(<Goals />, goalsSnapshot(), { notify: true })
  return { api, ...view }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(GOALS_TODAY)
  setAuth({ mode: 'password', authenticated: true, me: null })
  window.history.replaceState(null, '', '/goals')
})
afterEach(() => {
  vi.useRealTimers()
  act(() => resetAuth())
  window.history.replaceState(null, '', '/')
})

const form = () => document.querySelector<HTMLFormElement>('form.gl-form')!
const preview = () => document.querySelector<HTMLElement>('.gl-preview')!

describe('the editor in place', () => {
  it('«Update saved» opens it on «Already saved»; Save writes the change with the row it opened', async () => {
    const { api } = render()
    fireEvent.click(screen.getByRole('button', { name: 'Update saved' }))
    const saved = await screen.findByRole('textbox', { name: /^Already saved/ })
    await waitFor(() => expect(saved).toHaveFocus())
    expect(document.querySelector('.gl-head:not(form)')).toBeNull()
    fireEvent.change(saved, { target: { value: '33000' } })
    fireEvent.submit(form())
    await waitFor(() => expect(sent(api, WRITES)).toEqual([{
      method: 'PUT', url: '/api/admin/goals/2',
      body: { current: 33000, expectedIdentity: { id: 'emergency', name: 'Emergency fund (6 months)', target: 63000, current: 32000, target_date: '2027-12-31', emoji: null, currency: 'USD' } },
    }]))
    await waitFor(() => expect(document.querySelector('form.gl-form')).toBeNull())
  })

  it('«move the deadline to 05/2028»: the cushion needs $1,722 and makes it; independence starts in 06/2027, still 05/2046', async () => {
    render()
    fireEvent.click(screen.getByRole('button', { name: 'move the deadline to 05/2028' }))
    expect(await screen.findByRole('textbox', { name: 'By month' })).toHaveValue('05/2028')
    expect(preview()).toHaveTextContent('Needs $1,722 a month (was $2,385). Gets $1,207 now and $1,980 from 06/2027. On time for 05/2028.')
    expect(preview()).toHaveTextContent('Financial independence by 55: starts getting money in 06/2027 instead of 05/2028, reached 05/2046.')
  })

  it('a draft in a currency without a rate: no preview figures, and Save still writes', async () => {
    const { api } = render()
    fireEvent.click(screen.getByRole('button', { name: 'Update saved' }))
    await screen.findByRole('textbox', { name: /^Already saved/ })
    fireEvent.click(await within(form()).findByRole('radio', { name: 'EUR' }))
    expect(preview()).toHaveTextContent('EUR has no rate: what changes in the plan cannot be computed. You can still save.')
    fireEvent.submit(form())
    await waitFor(() => expect(sent(api, WRITES)[0]).toMatchObject({ method: 'PUT', body: { currency: 'EUR' } }))
  })

  it('a failed save keeps the form with what was typed', async () => {
    render({ 'PUT /api/admin/goals/2': () => jsonResponse({ error: 'boom' }, 500) })
    fireEvent.click(screen.getByRole('button', { name: 'Update saved' }))
    const saved = await screen.findByRole('textbox', { name: /^Already saved/ })
    fireEvent.change(saved, { target: { value: '33000' } })
    fireEvent.submit(form())
    expect(await screen.findAllByText('Could not save')).not.toHaveLength(0)
    expect(screen.getByRole('textbox', { name: /^Already saved/ })).toHaveValue('33,000')
  })
})

describe('the new-goal dialog', () => {
  it('25 000 $ by 12/2029: third in the queue, $676 a month, on time; independence 12/2046 instead of 05/2046; Create posts it', async () => {
    window.history.replaceState(null, '', '/goals?new=1')
    const { api } = render()
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'New car' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Amount to save/ }), { target: { value: '25000' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'By month' }), { target: { value: '12/2029' } })
    const what = within(dialog).getByText('What happens').closest('.gl-preview')!
    expect(what).toHaveTextContent('#3 in the queue. Needs $676 a month.')
    expect(what).toHaveTextContent('On time for 12/2029.')
    expect(what).toHaveTextContent('Financial independence by 55: 12/2046 instead of 05/2046.')
    expect(within(dialog).getByRole('link', { name: 'ask the Advisor' })).toHaveAttribute('href', '/advisor/ask')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(sent(api, WRITES)).toEqual([{
      method: 'POST', url: '/api/admin/goals',
      body: { id: 'new-car', name: 'New car', target: 25000, current: 0, target_date: '2029-12-31', currency: 'USD', emoji: null },
    }]))
    await waitFor(() => expect(window.location.search).toBe('?goal=new-car'))
  })

  it('has no advisor link in the demo, where the advisor is absent', async () => {
    setAuth({ mode: 'demo', authenticated: true, me: null })
    window.history.replaceState(null, '', '/goals?new=1')
    render()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('link', { name: 'ask the Advisor' })).toBeNull()
  })

  it('a viewer gets no dialog', () => {
    setAuth({ mode: 'telegram', authenticated: true, me: { name: 'Reader', rights: { edit: false, vote: false, manage: false } } })
    window.history.replaceState(null, '', '/goals?new=1')
    render()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
