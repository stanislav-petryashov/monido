import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { deferred, jsonResponse } from '../../helpers/http'
import { calls, renderWizard, stubSetupApi } from '../../helpers/setup'

const heading = () => screen.getByRole('heading', {})
const next = () => screen.getByRole('button', { name: 'Next' })
/** The step's own text (the toasts, which repeat an added name, stand outside its form) */
const step = () => within(heading().closest('form')!)

beforeEach(() => sessionStorage.clear())
afterEach(() => { sessionStorage.clear() })

async function add(name: string) {
  fireEvent.change(await screen.findByRole('textbox', { name: /Owner name/ }), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
}

describe('MembersStep', () => {
  it('has no remove control and disables Next with the reason until a member exists', async () => {
    stubSetupApi({ members: [] })
    renderWizard({ step: 'members' })
    await screen.findByRole('heading', { name: 'Who owns the accounts?' })
    expect(screen.queryAllByRole('button', { name: /Remove/ })).toEqual([])
    expect(next()).toBeDisabled()
    await waitFor(() => expect(next()).toHaveAccessibleDescription('Add at least one account owner'))
  })

  it('adding writes at once and enables Next', async () => {
    const members: { rowid: number; name: string }[] = []
    const fetchMock = stubSetupApi({
      members: [],
      answer: {
        'GET /api/admin/members': () => jsonResponse({ rows: members, columns: ['name'] }),
        'POST /api/admin/members': () => { members.push({ rowid: 1, name: 'Robin' }); return jsonResponse({ ok: true }) },
      },
    })
    renderWizard({ step: 'members' })
    await screen.findByRole('heading', { name: 'Who owns the accounts?' })
    await add(' Robin ')
    expect(await step().findByText('Robin')).toBeInTheDocument()
    expect(calls(fetchMock, 'POST')).toEqual([['POST', '/api/admin/members', { name: 'Robin' }]])
    await waitFor(() => expect(next()).toBeEnabled())
    fireEvent.click(next())
    await waitFor(() => expect(heading()).toHaveTextContent('Which currencies do you use?'))
    expect(calls(fetchMock, 'POST')).toHaveLength(1)
    expect(calls(fetchMock, 'PUT')).toEqual([])
  })

  it('a duplicate name is shown as already added', async () => {
    const fetchMock = stubSetupApi({
      members: ['Robin'],
      answer: { 'POST /api/admin/members': () => jsonResponse({ error: { code: 'duplicate' } }, 409) },
    })
    renderWizard({ step: 'members' })
    await screen.findByText('Robin')
    await add('Robin')
    await waitFor(() => expect(calls(fetchMock, 'POST')).toHaveLength(1))
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Owner name/ })).toHaveValue(''))
    expect(step().getAllByText('Robin')).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/Could not save/)).toBeNull()
    expect(next()).toBeEnabled()
  })

  it('a duplicate missing from a stale list reads the list again and shows the name', async () => {
    let members: { rowid: number; name: string }[] = []
    const fetchMock = stubSetupApi({
      members: [],
      answer: {
        'GET /api/admin/members': () => jsonResponse({ rows: members, columns: ['name'] }),
        'POST /api/admin/members': () => jsonResponse({ error: { code: 'duplicate' } }, 409),
      },
    })
    renderWizard({ step: 'members' })
    await screen.findByRole('heading', { name: 'Who owns the accounts?' })
    expect(step().queryByText('Noa')).toBeNull()
    // added meanwhile in another tab
    members = [{ rowid: 1, name: 'Noa' }]
    await add('Noa')
    expect(await step().findByText('Noa')).toBeInTheDocument()
    expect(step().getAllByText('Noa')).toHaveLength(1)
    expect(calls(fetchMock, 'GET').filter(([, u]) => u === '/api/admin/members').length).toBeGreaterThan(1)
    expect(screen.queryByText(/Could not save/)).toBeNull()
    await waitFor(() => expect(next()).toBeEnabled())
  })

  it('after a wipe lists the kept members', async () => {
    stubSetupApi({ members: ['Noa'] })
    renderWizard({ step: 'members' })
    expect(await screen.findByText('Noa')).toBeInTheDocument()
    await waitFor(() => expect(next()).toBeEnabled())
  })

  it('Enter in the add field with a name adds it and stays on the step', async () => {
    const fetchMock = stubSetupApi({ members: ['Robin'] })
    renderWizard({ step: 'members' })
    await screen.findByText('Robin')
    const field = screen.getByRole('textbox', { name: /Owner name/ })
    fireEvent.change(field, { target: { value: 'Noa' } })
    // fireEvent returns false when the default (the form's implicit submit) was prevented
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false)
    await waitFor(() => expect(calls(fetchMock, 'POST')).toEqual([['POST', '/api/admin/members', { name: 'Noa' }]]))
    expect(heading()).toHaveTextContent('Who owns the accounts?')
  })

  it('Enter in the empty add field submits the step', async () => {
    const fetchMock = stubSetupApi({ members: ['Robin'] })
    renderWizard({ step: 'members' })
    await screen.findByText('Robin')
    await waitFor(() => expect(next()).toBeEnabled())
    const field = screen.getByRole('textbox', { name: /Owner name/ })
    // the default is left to the browser, whose implicit submission jsdom does not perform: the test submits as it would
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(true)
    field.closest('form')!.requestSubmit()
    await waitFor(() => expect(heading()).toHaveTextContent('Which currencies do you use?'))
    expect(calls(fetchMock, 'POST')).toEqual([])
  })
})

describe('MembersStep with a failed read', () => {
  it('says so instead of "Add at least one account owner", and Try again reads the list', async () => {
    let up = false
    stubSetupApi({
      members: ['Robin'],
      answer: { 'GET /api/admin/members': () => up ? jsonResponse({ rows: [{ rowid: 1, name: 'Robin' }], columns: ['name'] }) : jsonResponse({ error: { code: 'boom' } }, 500) },
    })
    renderWizard({ step: 'members' })
    expect(await screen.findByText('Failed to load')).toBeInTheDocument()
    expect(screen.queryByText('Add at least one account owner')).toBeNull()
    expect(next()).toBeDisabled()
    up = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await step().findByText('Robin')).toBeInTheDocument()
    expect(screen.queryByText('Failed to load')).toBeNull()
    await waitFor(() => expect(next()).toBeEnabled())
  })
})

it('cached members read failure keeps the draft and offers retry', async () => {
  let fail = false
  stubSetupApi({ members: ['Robin'], answer: { 'GET /api/admin/members': () => fail ? jsonResponse({}, 503) : jsonResponse({ rows: [{ rowid: 1, name: 'Robin' }], columns: ['name'] }) } })
  const { testClient } = await import('../../helpers/render')
  const { act } = await import('@testing-library/react')
  const client = testClient()
  renderWizard({ step: 'members', client })
  const input = await screen.findByRole('textbox', { name: /Owner name/ })
  fireEvent.change(input, { target: { value: 'Draft' } })
  fail = true
  await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'members'] }) })
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: /Owner name/ })).toBe(input)
  expect(input).toHaveValue('Draft')
})


it('waits for owner removal and blocks Next after the last owner is removed', async () => {
  const gate = deferred<Response>()
  let members = [{ rowid: 1, name: 'Robin' }]
  stubSetupApi({ answer: {
    'GET /api/admin/members': () => jsonResponse({ rows: members, columns: ['name'] }),
    'DELETE /api/admin/members/1': () => gate.promise,
  } })
  renderWizard({ step: 'members' })
  fireEvent.click(await screen.findByRole('button', { name: 'Remove: Robin' }))
  await waitFor(() => expect(next()).toBeDisabled())
  members = []
  gate.resolve(jsonResponse({ ok: true }))
  await waitFor(() => expect(step().queryByText('Robin')).toBeNull())
  expect(next()).toBeDisabled()
})

it('keeps an owner when the server refuses removal', async () => {
  stubSetupApi({ members: ['Robin'], answer: {
    'DELETE /api/admin/members/1': () => jsonResponse({ error: { code: 'conflict' } }, 409),
  } })
  renderWizard({ step: 'members' })
  fireEvent.click(await screen.findByRole('button', { name: 'Remove: Robin' }))
  await screen.findByRole('alert')
  expect(step().getByText('Robin')).toBeInTheDocument()
  await waitFor(() => expect(next()).toBeEnabled())
})
