import { screen } from '@testing-library/react'
import { Goals } from '../../src/pages/Goals'
import { setAuth, resetAuth } from '../../src/lib/authState'
import { goalsSnapshot } from '../helpers/goals'
import { renderWithSnapshot, stubSnapshotFetch } from '../helpers/render'
vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))
afterEach(resetAuth)
import { fireEvent, waitFor } from '@testing-library/react'
import { GoalsScreen } from '../../src/modules/goals/GoalsScreen'
import { renderAdmin } from '../helpers/render'
import { stubApi, sent, WRITES } from '../helpers/http'
const trip = { rowid: 4, id: 'trip', name: 'Trip', target: 5000, current: 1000, target_date: '2033-06-30', currency: 'EUR' }
afterEach(() => window.history.replaceState(null, '', '/'))
it('opens the selected goal editor with stored values and makes no writes', async () => {
  setAuth({ mode: 'password', authenticated: true, me: null })
  window.history.replaceState(null, '', '/goals/edit?edit=trip')
  const api = stubApi({ goals: [trip], currencies: [{ code: 'EUR' }, { code: 'USD' }] })
  renderAdmin(<GoalsScreen />)
  expect(await screen.findByDisplayValue('Trip')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveValue('EUR')
  fireEvent.change(screen.getByDisplayValue('Trip'), { target: { value: 'Holiday' } })
  expect(screen.getByDisplayValue('Holiday')).toBeInTheDocument()
  expect(sent(api, WRITES)).toEqual([])
})
it('opens create with the family currency and cancel does not reopen it', async () => {
  setAuth({ mode: 'password', authenticated: true, me: null })
  window.history.replaceState(null, '', '/goals/edit?create=1')
  stubApi({ goals: [trip], currencies: [{ code: 'EUR' }, { code: 'USD' }] })
  renderAdmin(<GoalsScreen />)
  expect(await screen.findByRole('combobox', { name: 'Currency' })).toHaveValue('USD')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull())
})
it('never opens a deep-linked editor for a viewer', async () => {
  setAuth({ mode: 'telegram', authenticated: true, me: { name: 'Reader', rights: { edit: false, vote: false, manage: false } } })
  window.history.replaceState(null, '', '/goals/edit?edit=trip')
  const api = stubApi({ goals: [trip] })
  renderAdmin(<GoalsScreen />)
  expect(await screen.findByText('Trip')).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(sent(api, WRITES)).toEqual([])
})
it('sorts mobile goal rows without discarding an open draft', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} }))
  window.history.replaceState(null, '', '/goals/edit?edit=trip')
  stubApi({ goals: [trip, { ...trip, rowid: 5, id: 'home', name: 'Home' }], currencies: [{ code: 'EUR' }] })
  renderAdmin(<GoalsScreen />)
  const draft = await screen.findByDisplayValue('Trip')
  fireEvent.change(draft, { target: { value: 'Holiday' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), { target: { value: 'name' } })
  expect(screen.getByDisplayValue('Holiday')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Descending' })).toBeInTheDocument()
  vi.unstubAllGlobals()
})

it('keeps a long goal name whole in the list, the head and the shares table', () => {
  stubSnapshotFetch()
  const name = 'LongGoal'.repeat(35)
  renderWithSnapshot(<Goals />, goalsSnapshot({ goals: [{ ...trip, name, currency: 'USD', emoji: null }] }))
  expect(screen.getAllByText(name)).toHaveLength(3)
})

it('identifies the first missing goal field and keeps the editor open', async () => {
  setAuth({ mode: 'password', authenticated: true, me: null })
  window.history.replaceState(null, '', '/goals/edit?create=1')
  const api = stubApi({ goals: [trip], currencies: [{ code: 'USD' }] })
  renderAdmin(<GoalsScreen />)
  const name = await screen.findByRole('textbox', { name: 'Name' })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(name).toHaveAttribute('aria-invalid', 'true')
  expect(name).toHaveAccessibleDescription(/name/i)
  expect(name).toHaveFocus()
  expect(sent(api, WRITES)).toEqual([])
})

it('marks an impossible goal month with the month error after submit', async () => {
  window.history.replaceState(null, '', '/goals/edit?create=1')
  const api = stubApi({ goals: [trip], currencies: [{ code: 'USD' }] })
  renderAdmin(<GoalsScreen />)
  const date = await screen.findByRole('textbox', { name: 'By month' })
  fireEvent.change(date, { target: { value: '13/2026' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(date).toHaveAttribute('aria-invalid', 'true')
  expect(date).toHaveAccessibleDescription(/no such month/i)
  expect(date).toHaveFocus()
  expect(sent(api, WRITES)).toEqual([])
})

it('tells an incomplete goal month from an impossible one', async () => {
  window.history.replaceState(null, '', '/goals/edit?create=1')
  stubApi({ goals: [trip], currencies: [{ code: 'USD' }] })
  renderAdmin(<GoalsScreen />)
  const date = await screen.findByRole('textbox', { name: 'By month' })
  fireEvent.change(date, { target: { value: '12/2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(date).toHaveAccessibleDescription(/finish/i)
  expect(date).toHaveFocus()
})

it('does not carry create errors to an existing goal editor', async () => {
  window.history.replaceState(null, '', '/goals/edit?create=1')
  stubApi({ goals: [trip], currencies: [{ code: 'USD' }] })
  renderAdmin(<GoalsScreen />)
  const first = await screen.findByRole('textbox', { name: 'Name' })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(first).toHaveAttribute('aria-invalid', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Actions: Trip' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
  expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('aria-invalid')
})
it('focuses the edited goal month when the create editor is also open', async () => {
  window.history.replaceState(null, '', '/goals/edit?create=1')
  stubApi({ goals: [trip], currencies: [{ code: 'USD' }] })
  renderAdmin(<GoalsScreen />)
  await screen.findByRole('textbox', { name: 'Name' })
  fireEvent.click(screen.getByRole('button', { name: 'Actions: Trip' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
  const dates = screen.getAllByRole('textbox', { name: 'By month' })
  fireEvent.change(dates[1], { target: { value: '13/2026' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1])
  expect(dates[1]).toHaveFocus()
})

it('guards an edit opened from a deep link: leaving with a change asks first', async () => {
  setAuth({ mode: 'password', authenticated: true, me: null })
  window.history.replaceState(null, '', '/goals/edit?edit=trip')
  stubApi({ goals: [trip], currencies: [{ code: 'EUR' }] })
  renderAdmin(<GoalsScreen />)
  fireEvent.change(await screen.findByDisplayValue('Trip'), { target: { value: 'Holiday' } })
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
})

it('does not save a goal whose name is only spaces', async () => {
  setAuth({ mode: 'password', authenticated: true, me: null })
  window.history.replaceState(null, '', '/goals/edit?create=1')
  const api = stubApi({ goals: [trip], currencies: [{ code: 'USD' }] })
  renderAdmin(<GoalsScreen />)
  const name = await screen.findByRole('textbox', { name: 'Name' })
  fireEvent.change(name, { target: { value: '   ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(name).toHaveAttribute('aria-invalid', 'true')
  expect(sent(api, WRITES)).toEqual([])
})
