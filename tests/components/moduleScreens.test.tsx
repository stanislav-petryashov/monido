// Screens that modules own (goals, real estate) inside the Data page.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DataPage } from '../../src/pages/admin/DataPage'
import { isFireGoal } from '../../src/domain/goals'
import { GoalsScreen } from '../../src/modules/goals/GoalsScreen'
import { RealEstateScreen } from '../../src/modules/real-estate/RealEstateScreen'
import { deferred, jsonResponse, sent, stubApi, WRITES } from '../helpers/http'
import { renderAdmin as renderPage, settled, stubPrivacyOn, testClient } from '../helpers/render'
import { enterValuation, header, headerAction, propertyMenu, typeText } from '../helpers/adminScreens'

// The charts draw on a canvas that jsdom does not have: these tests do not look at them

/** The body of the first POST that went out, if one did */
const postBody = (fetchMock: ReturnType<typeof stubApi>) => sent<{ id: string; name: string }>(fetchMock, 'POST')[0]?.body

afterEach(() => { window.history.replaceState(null, '', '/') })

describe('Real estate screen', () => {
  const valuation = (rowid: number, valuation_year: number, member: string | null = null) => ({ rowid, name: 'City apartment', valuation_year, value: 84300, currency: 'USD', purchase_date: '2025-01-01', purchase_price: 61000, purchase_currency: 'USD', notes: null, member })
  const stubProperty = () => stubApi({ real_estate: [valuation(1, 2031)] })
  /** The bodies of the writes that went out, by method and path. */
  const writes = (fetchMock: ReturnType<typeof stubApi>) => sent<Record<string, unknown>>(fetchMock, WRITES)

  it('follows the list–detail pattern: header action, list, properties, row menu', async () => {
    stubProperty()
    renderPage(<DataPage screen={RealEstateScreen} />)
    expect(await headerAction('+ Property')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /^City apartment/ }))
    expect(screen.getAllByRole('term').map(t => t.textContent)).toEqual(['Value', 'Since purchase', 'Average per year', 'Share of assets'])
    // the purchase date is written as every other date, not as the stored ISO text
    expect(screen.getByText('bought 01/01/2025')).toBeInTheDocument()
    expect(screen.queryByText('2025-01-01')).toBeNull()
    expect(screen.getByRole('button', { name: 'Actions: 2031' })).toBeInTheDocument()
  })

  it('opens with the property the address names (a link from Net worth); an unknown name opens none', async () => {
    stubProperty()
    window.history.replaceState(null, '', `/real-estate#${encodeURIComponent('City apartment')}`)
    const { unmount } = renderPage(<DataPage screen={RealEstateScreen} />)
    expect(await screen.findByRole('button', { name: /^City apartment/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getAllByRole('term').map(t => t.textContent)).toEqual(['Value', 'Since purchase', 'Average per year', 'Share of assets'])
    unmount()

    stubProperty()
    window.history.replaceState(null, '', `/real-estate#${encodeURIComponent('Sold house')}`)
    renderPage(<DataPage screen={RealEstateScreen} />)
    expect(await screen.findByRole('button', { name: /^City apartment/ })).not.toHaveAttribute('aria-current')
    expect(screen.queryAllByRole('term')).toEqual([])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('leaves task navigation to the shell instead of duplicating a header link', async () => {
    stubProperty()
    renderPage(<DataPage screen={RealEstateScreen} />)
    expect(within(header()).queryByRole('link', { name: 'View on Net worth' })).toBeNull()
  })

  it('names every field of the new-property form', async () => {
    stubProperty()
    renderPage(<DataPage screen={RealEstateScreen} />)
    fireEvent.click(await headerAction('+ Property'))
    const dialog = screen.getByRole('dialog', { name: 'New property' })
    for (const name of ['Name', 'Purchase price', 'Valuation year', 'Value', 'Note']) {
      expect(within(dialog).getByRole('textbox', { name })).toBeInTheDocument()
    }
    expect(within(dialog).getByRole('radiogroup', { name: 'Purchase currency' })).toBeInTheDocument()
    // the first valuation is in the purchase currency: no second currency to choose
    expect(within(dialog).queryByRole('radiogroup', { name: 'Valuation currency' })).toBeNull()
    expect(within(dialog).getByRole('textbox', { name: 'Purchase date' })).toHaveAccessibleDescription('Digits only: MM/DD/YYYY')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Valuation year' })).toBeNull()
  })

  it('the new-property form uses the form system: grouped amounts, a date picker, the family currencies', async () => {
    const fetchMock = stubApi({ real_estate: [valuation(1, 2031)], currencies: [{ rowid: 1, code: 'USD' }, { rowid: 2, code: 'EUR' }] })
    renderPage(<DataPage screen={RealEstateScreen} />)
    fireEvent.click(await headerAction('+ Property'))
    const dialog = screen.getByRole('dialog', { name: 'New property' })
    const purchase = within(dialog).getByRole('radiogroup', { name: 'Purchase currency' })
    await waitFor(() => expect(within(purchase).getAllByRole('radio').map(o => o.parentElement?.textContent)).toEqual(['EUR', 'USD']))
    fireEvent.click(within(purchase).getByRole('radio', { name: 'USD' }))
    const price = within(dialog).getByRole('textbox', { name: 'Purchase price (USD)' })
    expect(price).toHaveClass('admin-input--num')
    fireEvent.change(price, { target: { value: '61000,5' } })
    expect(price).toHaveValue('61,000.5')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Lake cabin' } })
    fireEvent.change(within(dialog).getByLabelText('Purchase date'), { target: { value: '2030-04-01' } })
    // unreadable: a separator with no digits after it (a typed "1.000" is now "1.00", a readable one)
    typeText(within(dialog).getByRole('textbox', { name: 'Value (USD)' }), '1,')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a number')
    expect(writes(fetchMock)).toHaveLength(0)
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Value (USD)' }), { target: { value: '84 300' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(1))
    expect(writes(fetchMock)[0].body).toMatchObject({
      name: 'Lake cabin', purchase_date: '2030-04-01', purchase_price: '61000.5', purchase_currency: 'USD', value: '84300', currency: 'USD',
    })
  })

  it('a valuation row reads its value as an amount and refuses one it cannot read', async () => {
    const fetchMock = stubApi({ real_estate: [valuation(1, 2031)] })
    renderPage(<DataPage screen={RealEstateScreen} />)
    fireEvent.click(await screen.findByRole('button', { name: /^City apartment/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Actions: 2031' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const value = screen.getByRole('textbox', { name: 'Value (USD)' })
    expect(value).toHaveValue('84,300')
    expect(value).toHaveClass('admin-input--num')
    // unreadable: a separator with no digits after it (a typed "1.000" is now "1.00", a readable one)
    typeText(value, '1,')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a number')
    expect(writes(fetchMock)).toHaveLength(0)
    fireEvent.change(value, { target: { value: '90 000,5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(1))
    expect(writes(fetchMock)[0].body).toMatchObject({ value: '90000.5' })
  })

  it('a stored three-decimal value saves unchanged in the valuation row and the property form', async () => {
    const stored = { ...valuation(1, 2031), value: 1234.125, purchase_price: 4321.125 }
    const fetchMock = stubApi({ real_estate: [stored] })
    renderPage(<DataPage screen={RealEstateScreen} />)
    fireEvent.click(await screen.findByRole('button', { name: /^City apartment/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Actions: 2031' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(1))
    expect(writes(fetchMock)[0].body).toMatchObject({ value: '1234.125' })
    await propertyMenu('Edit property')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes(fetchMock).length).toBeGreaterThan(1))
    expect(writes(fetchMock)[1].body).toMatchObject({ name: 'City apartment', values: { purchase_price: 4321.125 } })
  })

  it('the property edit card is a form: Escape cancels, Enter saves, a half-typed purchase date is not written', async () => {
    const fetchMock = stubProperty()
    renderPage(<DataPage screen={RealEstateScreen} />)
    fireEvent.click(await screen.findByRole('button', { name: /^City apartment/ }))
    await propertyMenu('Edit property')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    await propertyMenu('Edit property')
    const date = screen.getByRole('textbox', { name: 'Purchase date' })
    fireEvent.change(date, { target: { value: '01/0' } })
    // Enter on the date itself is held by the field; Save is refused
    expect(fireEvent.keyDown(date, { key: 'Enter' })).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('A date is not finished: complete it as shown under the field')).toBeInTheDocument()
    expect(writes(fetchMock)).toHaveLength(0)
    fireEvent.change(date, { target: { value: '2025-02-01' } })
    const name = screen.getByRole('textbox', { name: 'Name' })
    if (fireEvent.keyDown(name, { key: 'Enter' })) fireEvent.submit(name.closest('form')!)
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(1))
    expect(writes(fetchMock)[0].body).toMatchObject({ name: 'City apartment', values: { purchase_date: '2025-02-01' } })
  })

  it('a note that looks like an amount is prefilled as it was written', async () => {
    stubApi({ real_estate: [{ ...valuation(1, 2031), notes: '1234.125' }] })
    renderPage(<DataPage screen={RealEstateScreen} />)
    fireEvent.click(await screen.findByRole('button', { name: /^City apartment/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Actions: 2031' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(screen.getByDisplayValue('1234.125')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('1234.1250')).toBeNull()
  })

  it('sends a shared owner change once for all valuations', async () => {
    const fetchMock = stubApi({ real_estate: [valuation(1, 2030), valuation(2, 2031)], members: [{ rowid: 1, name: 'Robin' }, { rowid: 2, name: 'Noa' }] })
    renderPage(<DataPage screen={RealEstateScreen} />)
    fireEvent.click(await screen.findByRole('button', { name: /^City apartment/ }))
    expect(within(screen.getByRole('list', { name: 'About the property' })).queryByText(/Robin|Noa/)).toBeNull()
    await propertyMenu('Edit property')
    const owner = await screen.findByRole('radiogroup', { name: 'Owner' })
    expect(within(owner).getByRole('radio', { name: 'No owner' })).toBeChecked()
    await waitFor(() => expect(within(owner).getAllByRole('radio').map(o => o.parentElement?.textContent)).toEqual(['Noa', 'Robin', 'No owner']))
    fireEvent.click(within(owner).getByRole('radio', { name: 'Noa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(1))
    expect(writes(fetchMock)[0]).toMatchObject({ method: 'POST', url: '/api/real-estate/update', body: { name: 'City apartment', values: { member: 'Noa' } } })
  })

  it('shows the owner and saves the empty choice as no owner', async () => {
    const fetchMock = stubApi({ real_estate: [valuation(1, 2031, 'Robin')], members: [{ rowid: 1, name: 'Robin' }] })
    renderPage(<DataPage screen={RealEstateScreen} />)
    fireEvent.click(await screen.findByRole('button', { name: /^City apartment/ }))
    expect(within(screen.getByRole('list', { name: 'About the property' })).getByText('Robin')).toBeInTheDocument()
    await propertyMenu('Edit property')
    const owner = screen.getByRole('radiogroup', { name: 'Owner' })
    expect(within(owner).getByRole('radio', { name: 'Robin' })).toBeChecked()
    fireEvent.click(within(owner).getByRole('radio', { name: 'No owner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(1))
    expect(writes(fetchMock)[0].body).toMatchObject({ name: 'City apartment', values: { member: null } })
  })

  it('a new property takes an optional owner, and a new valuation keeps it', async () => {
    const fetchMock = stubApi({ real_estate: [valuation(1, 2031, 'Robin')], members: [{ rowid: 1, name: 'Robin' }] })
    renderPage(<DataPage screen={RealEstateScreen} />)
    fireEvent.click(await headerAction('+ Property'))
    const owner = screen.getByRole('radiogroup', { name: 'Owner' })
    expect(within(owner).getByRole('radio', { name: 'No owner' })).toBeChecked()
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Lake cabin' } })
    typeText(screen.getByRole('textbox', { name: 'Purchase date' }), '01012020')
    typeText(screen.getByRole('textbox', { name: /^Purchase price/ }), '100')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(1))
    expect(writes(fetchMock)[0]).toMatchObject({ method: 'POST', url: '/api/admin/real_estate', body: { name: 'Lake cabin', member: null } })

    fireEvent.click(screen.getByRole('button', { name: /^City apartment/ }))
    await enterValuation()
    fireEvent.change(screen.getByRole('textbox', { name: 'Year' }), { target: { value: '2032' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save valuation' }))
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(2))
    expect(writes(fetchMock)[1].body).toMatchObject({ name: 'City apartment', member: 'Robin', valuation_year: '2032' })
  })

  it('edits a valuation in place with named fields', async () => {
    stubProperty()
    renderPage(<DataPage screen={RealEstateScreen} />)
    fireEvent.click(await screen.findByRole('button', { name: /^City apartment/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Actions: 2031' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(screen.getByRole('textbox', { name: 'Value (USD)' })).toHaveValue('84,300')
  })

  it('with no objects says so', async () => {
    stubApi()
    renderPage(<DataPage screen={RealEstateScreen} />)
    expect(await screen.findByText('No properties yet')).toBeInTheDocument()
    expect(screen.getByText('Add your first property: “+ Property”.')).toBeInTheDocument()
  })
})

describe('The header action is there while a screen is still loading', () => {
  it.each([
    ['real_estate', RealEstateScreen, '+ Property'],
    ['goals', GoalsScreen, '+ Goal'],
  ] as const)('%s', (_table, screenView, name) => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderPage(<DataPage screen={screenView} />)
    // the button's place is taken at once, so it does not jump into the header after loading; it cannot be pressed yet
    expect(within(header()).getByRole('button', { name })).toBeDisabled()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })
})

describe('Empty screens say what to do next', () => {
  it('goals', async () => {
    stubApi()
    renderPage(<DataPage screen={GoalsScreen} />)
    expect(await screen.findByText('Add your first goal: “+ Goal”.')).toBeInTheDocument()
  })
})

describe('Goals screen', () => {
  const goals = [{ rowid: 1, id: 'travel', name: 'Travel', target: 5000, current: 4000, target_date: '2031-12-31', emoji: '✈️', currency: 'USD' }]

  it('explains that Already saved is manually maintained goal capital', async () => {
    stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    expect(await screen.findByText(/Already saved.*entered manually/)).toHaveTextContent(/not updated from net worth/)
  })

  it('privacy mode masks the target and current amounts, not the name or date', async () => {
    stubPrivacyOn()
    stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />, { dashboard: true })
    const row = (await screen.findByText('Travel')).closest('tr')!
    expect(within(row).getAllByText('•••')).toHaveLength(2)
    expect(row).not.toHaveTextContent(/5,000|4,000/)
    expect(row).toHaveTextContent('December 2031')
    expect(row).toHaveTextContent('Still to save: •••')
    expect(row).not.toHaveTextContent('1,000')
  })

  it('adds from the header and hides the internal key and icon columns', async () => {
    stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    expect(await headerAction('+ Goal')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /ID|Icon/ })).toBeNull()
    expect(screen.queryByText('✈️')).toBeNull()
  })

  const completeGoal = () => {
    for (const [label, value] of [['Need to save', '100'], ['Already saved', '0'], ['By month', '06/2031']] as const) {
      const input = screen.getByRole('textbox', { name: label }) as HTMLInputElement
      if (!input.value) fireEvent.change(input, { target: { value } })
    }
  }

  it.each(['new', 'edit'])('a %s goal treats a blank saved amount as zero, like the Goals page', async mode => {
    const fetchMock = stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    if (mode === 'new') {
      fireEvent.click(await headerAction('+ Goal'))
      fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Trip' } })
      completeGoal()
    } else await editRow('Travel')
    fireEvent.change(screen.getByRole('textbox', { name: 'Already saved' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, mode === 'new' ? 'POST' : 'PUT')).toHaveLength(1))
    expect(sent(fetchMock, mode === 'new' ? 'POST' : 'PUT')[0].body).toMatchObject({ current: 0 })
  })

  it('a new goal gets a key from its name, free among the existing ones, and no form asks for it', async () => {
    const fetchMock = stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    fireEvent.click(await headerAction('+ Goal'))
    expect(screen.queryByRole('textbox', { name: /ID|Icon/ })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Travel' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Need to save' }), { target: { value: '100' } })
    completeGoal()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(postBody(fetchMock)).toBeDefined())
    expect(postBody(fetchMock)).toMatchObject({ id: 'travel-2', name: 'Travel' })
  })

  const addGoal = async (name: string, fire: boolean) => {
    fireEvent.click(await headerAction('+ Goal'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: name } })
    completeGoal()
    if (fire) fireEvent.click(screen.getByRole('switch', { name: 'This is the financial-independence goal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('the financial-independence switch gives a goal whose name lacks the word fire the key fire, which the domain finds', async () => {
    const fetchMock = stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    await addGoal('Financial independence', true)
    await waitFor(() => expect(postBody(fetchMock)).toBeDefined())
    expect(postBody(fetchMock)).toMatchObject({ id: 'fire' })
    expect(postBody(fetchMock)).not.toHaveProperty('fire')
    expect(isFireGoal(postBody(fetchMock))).toBe(true)
  })

  it('with the switch off the name gives its slug', async () => {
    const fetchMock = stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    await addGoal('Holiday in Japan!', false)
    await waitFor(() => expect(postBody(fetchMock)).toBeDefined())
    expect(postBody(fetchMock).id).toBe('holiday-in-japan')
  })

  it('the target date is a month with year chips, saved as the last day of that month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
    try {
      const fetchMock = stubApi({ goals })
      renderPage(<DataPage screen={GoalsScreen} />)
      fireEvent.click(await headerAction('+ Goal'))
      fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'House' } })
      const month = screen.getByRole('textbox', { name: 'By month' })
      for (const ch of '062031') fireEvent.change(month, { target: { value: (month as HTMLInputElement).value + ch } })
      expect(month).toHaveValue('06/2031')
      completeGoal()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(postBody(fetchMock)).toBeDefined())
      expect(postBody(fetchMock)).toMatchObject({ name: 'House', target_date: '2031-06-30' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a year chip under the target date fills it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
    try {
      stubApi({ goals })
      renderPage(<DataPage screen={GoalsScreen} />)
      fireEvent.click(await headerAction('+ Goal'))
      fireEvent.click(screen.getByRole('button', { name: 'In 10 years' }))
      expect(screen.getByRole('textbox', { name: 'By month' })).toHaveValue('10/2036')
    } finally {
      vi.useRealTimers()
    }
  })

  const putBody = (fetchMock: ReturnType<typeof stubApi>) => sent<Record<string, unknown>>(fetchMock, 'PUT')[0]?.body
  const editRow = async (name: string) => {
    fireEvent.click(await screen.findByRole('button', { name: `Actions: ${name}` }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
  }
  const fireSwitch = () => screen.getByRole('switch', { name: 'This is the financial-independence goal' })

  it('un-designates the FIRE goal on edit: the key becomes the slug of the current name', async () => {
    const fetchMock = stubApi({ goals: [{ ...goals[0], id: 'fire', name: 'Independence' }] })
    renderPage(<DataPage screen={GoalsScreen} />)
    await editRow('Independence')
    expect(fireSwitch()).toHaveAttribute('aria-checked', 'true')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'New car' } })
    fireEvent.click(fireSwitch())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(putBody(fetchMock)).toBeDefined())
    expect(putBody(fetchMock)).toMatchObject({ id: 'new-car', name: 'New car' })
    // the month field left untouched writes the stored day back, not the month's last day or ''
    expect(putBody(fetchMock).target_date).toBe('2031-12-31')
  })

  it('an edit names the row as it was opened, and a refused save opens the editor again with what was typed', async () => {
    const fetchMock = stubApi({ goals }, { answer: { 'PUT *': () => jsonResponse({ error: { code: 'row_changed' } }, 409) } })
    renderPage(<DataPage screen={GoalsScreen} />)
    await editRow('Travel')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Trip' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(putBody(fetchMock)).toBeDefined())
    expect(putBody(fetchMock)).toMatchObject({ name: 'Trip', expectedIdentity: { id: 'travel', name: 'Travel', target: 5000, current: 4000, target_date: '2031-12-31', emoji: '✈️', currency: 'USD' } })
    expect(putBody(fetchMock).expectedIdentity).not.toHaveProperty('rowid')
    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('Trip')
    // the refusal reads the rows again
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === '/api/admin/goals' && !(init as RequestInit | undefined)?.method).length).toBeGreaterThan(1))
  })

  it('an edited row or a half-typed new row holds the page: leaving it asks first', async () => {
    stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    const leave = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented }
    await editRow('Travel')
    expect(leave()).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Trip' } })
    expect(leave()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(leave()).toBe(false)
    fireEvent.click(await headerAction('+ Goal'))
    expect(leave()).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'House' } })
    expect(leave()).toBe(true)
  })

  it('an edit that leaves the switch alone keeps the key', async () => {
    const fetchMock = stubApi({ goals: [{ ...goals[0], id: 'fire', name: 'Independence' }] })
    renderPage(<DataPage screen={GoalsScreen} />)
    await editRow('Independence')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(putBody(fetchMock)).toBeDefined())
    expect(putBody(fetchMock).id).toBe('fire')
  })

  it('Enter in a row field saves the row, Escape cancels it (add and edit)', async () => {
    const fetchMock = stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    fireEvent.click(await headerAction('+ Goal'))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    fireEvent.click(await headerAction('+ Goal'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'House' } })
    completeGoal()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' })
    await waitFor(() => expect(postBody(fetchMock)).toMatchObject({ name: 'House' }))
    await editRow('Travel')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    await editRow('Travel')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' })
    await waitFor(() => expect(putBody(fetchMock)).toBeDefined())
  })

  it('a half-typed target date is not saved: Enter on it says how to finish it, Enter elsewhere and Save refuse', async () => {
    const fetchMock = stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    fireEvent.click(await headerAction('+ Goal'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'House' } })
    const month = screen.getByRole('textbox', { name: 'By month' })
    // a row of fields: its cells start at the top, the month with its hint and chips beside the others
    expect(month.closest('section')).toHaveClass('goal-edit-sheet')
    fireEvent.change(month, { target: { value: '06' } })
    fireEvent.keyDown(month, { key: 'Enter' })
    expect(screen.getByRole('alert')).toHaveTextContent('Finish the date: MM/YYYY')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(month).toHaveAccessibleDescription(/Finish the date/)
    expect(postBody(fetchMock)).toBeUndefined()
    // the edit row too: a stored date is not replaced by a half-typed one
    await editRow('Travel')
    const edited = screen.getAllByRole('textbox', { name: 'By month' }).at(-1)!
    fireEvent.change(edited, { target: { value: '1' } })
    fireEvent.keyDown(edited, { key: 'Enter' })
    expect(putBody(fetchMock)).toBeUndefined()
  })

  it('Enter on the independence switch is a choice, not a save', async () => {
    const fetchMock = stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    await editRow('Travel')
    fireEvent.keyDown(screen.getByRole('switch'), { key: 'Enter' })
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
    expect(putBody(fetchMock)).toBeUndefined()
  })

  it('two saves in a row write the row once', async () => {
    const fetchMock = stubApi({ goals })
    const client = testClient()
    renderPage(<DataPage screen={GoalsScreen} />, { client })
    fireEvent.click(await headerAction('+ Goal'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'House' } })
    completeGoal()
    const save = screen.getByRole('button', { name: 'Save' })
    act(() => { save.click(); save.click() })
    await waitFor(() => expect(postBody(fetchMock)).toBeDefined())
    await settled(client)
    expect(sent(fetchMock, 'POST')).toHaveLength(1)
  })

  it('designates a goal on edit while no FIRE goal exists, and hides the switch on others once one does', async () => {
    const fetchMock = stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    await editRow('Travel')
    expect(fireSwitch()).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(fireSwitch())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(putBody(fetchMock)).toBeDefined())
    expect(putBody(fetchMock).id).toBe('fire')
  })

  it('offers no switch on another goal while a FIRE goal exists', async () => {
    stubApi({ goals: [...goals, { ...goals[0], rowid: 2, id: 'fire', name: 'Independence' }] })
    renderPage(<DataPage screen={GoalsScreen} />)
    await editRow('Travel')
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('offers no switch once a FIRE goal exists', async () => {
    stubApi({ goals: [...goals, { ...goals[0], rowid: 2, id: 'fire', name: 'Independence' }] })
    renderPage(<DataPage screen={GoalsScreen} />)
    fireEvent.click(await headerAction('+ Goal'))
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('shows a goal deadline as a month and year', async () => {
    stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    expect(await screen.findByText('December 2031')).toBeInTheDocument()
    expect(screen.queryByText('2031-12-31')).toBeNull()
  })

  it('leaves goals navigation to the shell', async () => {
    stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    expect(within(header()).queryByRole('link', { name: 'View goals' })).toBeNull()
  })

  it('a stored three-decimal target is not marked as unreadable and saves unchanged', async () => {
    const fetchMock = stubApi({ goals: [{ ...goals[0], target: 1234.125 }] })
    renderPage(<DataPage screen={GoalsScreen} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Travel' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(screen.getByRole('textbox', { name: 'Need to save' })).not.toHaveAttribute('aria-invalid')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'PUT')).not.toHaveLength(0))
    expect(sent(fetchMock, 'PUT')[0].body).toMatchObject({ target: 1234.125 })
  })

  it('amount columns are amount fields: grouped, read before they are written', async () => {
    const fetchMock = stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Travel' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const target = screen.getByRole('textbox', { name: 'Need to save' })
    expect(target).toHaveValue('5,000')
    expect(target).toHaveClass('admin-input--num')
    // typed, a third decimal is dropped: "1.000" is one, never a thousand
    typeText(target, '1.000')
    expect(target).toHaveValue('1.00')
    // unreadable: a separator with no digits after it (a typed "1.000" is now "1.00", a readable one)
    typeText(target, '1,')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a number')
    const puts = () => sent(fetchMock, 'PUT')
    expect(puts()).toHaveLength(0)
    fireEvent.change(target, { target: { value: '12 000,5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(puts()[0].body).toMatchObject({ target: 12000.5, current: 4000 })
  })

  it('shows saved progress and remaining money without bulk selection', async () => {
    stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    expect(await screen.findByRole('progressbar', { name: 'Savings progress' })).toHaveAttribute('aria-valuenow', '80')
    expect(screen.getByText('Still to save: $1,000.00')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Actions: Travel' })).toBeInTheDocument()
  })

  it('caps a funded goal bar and does not show a negative remaining amount', async () => {
    stubApi({ goals: [{ ...goals[0], current: 6000 }] })
    renderPage(<DataPage screen={GoalsScreen} />)
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText('120%')).toBeInTheDocument()
    expect(screen.getByText('Goal funded')).toBeInTheDocument()
    expect(screen.queryByText(/Still to save/)).toBeNull()
  })

  it('does not invent progress for a zero target', async () => {
    stubApi({ goals: [{ ...goals[0], target: 0 }] })
    renderPage(<DataPage screen={GoalsScreen} />)
    await screen.findByText('Travel')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('announces the sort order of a column', async () => {
    stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    const th = await screen.findByRole('columnheader', { name: /Name/ })
    expect(th).toHaveAttribute('aria-sort', 'none')
    fireEvent.click(within(th).getByRole('button'))
    expect(th).toHaveAttribute('aria-sort', 'ascending')
  })

  it('tells apart rows that share a name', async () => {
    stubApi({ goals: [goals[0], { ...goals[0], rowid: 2, id: 'travel-2' }] })
    renderPage(<DataPage screen={GoalsScreen} />)
    expect(await screen.findByRole('button', { name: 'Actions: Travel (travel)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actions: Travel (travel-2)' })).toBeInTheDocument()
  })

  it('counts rows with a correct plural', async () => {
    stubApi({ goals })
    renderPage(<DataPage screen={GoalsScreen} />)
    expect(await screen.findByText('1 row')).toBeInTheDocument()
  })

  it('deleting a goal row confirms with a toast', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      jsonResponse(init?.method === 'DELETE' ? { ok: true } : { rows: [{ rowid: 1, id: 'fire', name: 'FIRE' }], columns: ['id', 'name'] })))
    renderPage(<DataPage screen={GoalsScreen} />)
    await screen.findByText('FIRE')
    fireEvent.click(screen.getByRole('button', { name: 'Actions: FIRE' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Row deleted'))
  })

  it('the goal currency is picked from the family currencies, not typed; a new goal starts with the family currency', async () => {
    const fetchMock = stubApi({ goals, currencies: [{ rowid: 1, code: 'USD' }, { rowid: 2, code: 'EUR' }] })
    renderPage(<DataPage screen={GoalsScreen} />)
    fireEvent.click(await headerAction('+ Goal'))
    expect(screen.queryByRole('textbox', { name: 'Currency' })).toBeNull()
    const currency = screen.getByRole('combobox', { name: 'Currency' })
    expect(within(currency).getAllByRole('option').map(o => o.textContent)).toEqual(['EUR', 'USD'])
    expect(currency).toHaveValue('USD')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Car' } })
    completeGoal()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(postBody(fetchMock)).toBeDefined())
    expect(postBody(fetchMock)).toMatchObject({ name: 'Car', currency: 'USD' })
  })

  it('editing a goal whose stored currency is not in the list still shows it, and another can be picked', async () => {
    stubApi({ goals: [{ ...goals[0], currency: 'usd ' }], currencies: [{ rowid: 1, code: 'USD' }] })
    renderPage(<DataPage screen={GoalsScreen} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Travel' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const currency = screen.getByRole('combobox', { name: 'Currency' })
    expect(currency).toHaveValue('usd ')
    fireEvent.change(currency, { target: { value: 'USD' } })
    expect(currency).toHaveValue('USD')
  })

  it('“+ Goal” waits for the currency list: a goal added before it would get no currency of the family’s', async () => {
    const currencies = deferred()
    const base = stubApi({ goals, currencies: [{ rowid: 1, code: 'EUR' }] }, {
      answer: { '/api/admin/currencies': (_init, fallback) => currencies.promise.then(fallback) },
    })
    renderPage(<DataPage screen={GoalsScreen} />)
    await screen.findByText('Travel')
    expect(within(header()).getByRole('button', { name: '+ Goal' })).toBeDisabled()
    currencies.resolve()
    fireEvent.click(await headerAction('+ Goal'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Car' } })
    completeGoal()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(postBody(base)).toBeDefined())
    expect(postBody(base)).toMatchObject({ currency: 'EUR' })
  })

  it('a failed add opens the form again with what was typed', async () => {
    stubApi({ goals, currencies: [{ rowid: 1, code: 'EUR' }] }, { answer: { 'POST *': () => jsonResponse({ error: 'boom' }, 500) } })
    renderPage(<DataPage screen={GoalsScreen} />)
    fireEvent.click(await headerAction('+ Goal'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Car' } })
    completeGoal()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('Car')
  })
})
