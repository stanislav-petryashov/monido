import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { AvailabilityPanel } from '../../src/components/finance/AvailabilityPanel'
import { PrivacyContext } from '../../src/lib/privacy'
import { renderAdmin, testClient } from '../helpers/render'
import { jsonResponse } from '../helpers/http'
import { makeSnapshot } from '../helpers/snapshot'
import type { AccountValue, FinanceSnapshot } from '../../src/domain/types'
import type { AvailabilityAssessment } from '../../src/domain/availability'

const state = vi.hoisted(() => ({ canEdit: true, baseline: { perMonth: 2000, months: ['2031-04', '2031-05', '2031-06'] } as { perMonth: number; months: string[] } | null }))
vi.mock('../../src/lib/rights', () => ({ useCan: () => state.canEdit }))
vi.mock('../../src/domain/availability', async original => ({ ...await original<typeof import('../../src/domain/availability')>(), reserveSpendingBaseline: () => state.baseline }))

const MONTH = '2031-06'
const checking: AccountValue = { name: 'Checking', member: 'Robin', class: 'bank', currency: 'USD', value: 10000, valueBase: 10000 }
const savings: AccountValue = { name: 'Savings', member: 'Noa', class: 'bank', currency: 'EUR', value: 5000, valueBase: 5500 }
const pension: AccountValue = { name: 'Pension', member: 'Robin', class: 'other', currency: 'USD', value: 20000, valueBase: 20000 }
const of = (a: AccountValue, over: Partial<AvailabilityAssessment> = {}): AvailabilityAssessment =>
  ({ month: MONTH, name: a.name, member: a.member, currency: a.currency, balance: a.value, available: true, reserve: 0, goals: 0, commitments: 0, ...over })
const confirmed = () => [of(checking, { commitments: 2000 }), of(savings, { reserve: 4000, goals: 1000 }), of(pension, { available: false })]

let stored: AvailabilityAssessment[] = []
let failPut: string | null = null
const writes: { method: string; body: AvailabilityAssessment }[] = []
function serve() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).startsWith('/api/availability')) return new Promise<Response>(() => {})
    const method = init?.method ?? 'GET'
    if (method === 'GET') return jsonResponse({ assessments: stored })
    const body = JSON.parse(String(init!.body)) as AvailabilityAssessment
    writes.push({ method, body })
    if (failPut) return jsonResponse({ error: failPut }, 409)
    const same = (a: AvailabilityAssessment) => a.month === body.month && a.name === body.name && a.member === body.member
    stored = method === 'PUT' ? [...stored.filter(a => !same(a)), body] : stored.filter(a => !same(a))
    return jsonResponse({ ok: true })
  }))
}

function snap(accounts: AccountValue[] = [checking, savings, pension], over: Partial<FinanceSnapshot> = {}): FinanceSnapshot {
  const base = makeSnapshot(over)
  return { ...base, members: ['Robin', 'Noa'], capital: { ...base.capital!, accounts }, warnings: [], analysisMonths: undefined, capitalCoverage: [{ month: MONTH, assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] }] }
}
const draw = async (snapshot = snap(), { hidden = false } = {}) => {
  const client = testClient()
  const view = renderAdmin(<PrivacyContext.Provider value={{ hidden, toggle() {} }}><AvailabilityPanel snapshot={snapshot} /></PrivacyContext.Provider>, { client })
  await screen.findByRole('heading', { name: /Accounts for/ })
  await waitFor(() => expect(client.isFetching()).toBe(0))
  return { ...view, client }
}
const hero = () => screen.getByRole('region', { name: 'How much you can spend' })
const row = (name: string) => screen.getByRole('listitem', { name })

beforeEach(() => { state.canEdit = true; state.baseline = { perMonth: 2000, months: ['2031-04', '2031-05', '2031-06'] }; stored = confirmed(); failPut = null; writes.length = 0; serve() })

describe('the hero, confirmed', () => {
  it('shows the free amount, its months of usual expenses and the two minis', async () => {
    await draw()
    const h = within(hero())
    expect(h.getByText('Free · June 2031')).toBeInTheDocument()
    expect(hero().querySelector('.avail-hero__big')).toHaveTextContent('$8,000')
    expect(h.getByText(/committed payments: 4 mo of usual expenses/)).toBeInTheDocument()
    expect(hero().querySelector('.avail-mini')).toHaveTextContent('Cushion$4,400')
    expect(h.getByText('2.2 mo of expenses · goal 6 mo')).toBeInTheDocument()
    expect(hero().querySelector('.avail-mini')).toHaveTextContent('Available at once$15,500')
    expect(h.getByText('43.7% of the money on the accounts')).toBeInTheDocument()
  })
  it('leaves the months out without a spending baseline', async () => {
    state.baseline = null
    await draw(snap())
    const h = within(hero())
    expect(h.getByText('What you can spend without touching the cushion, goals and committed payments.')).toBeInTheDocument()
    expect(h.queryByText(/mo of usual expenses/)).toBeNull()
    expect(h.getByText(/Months of usual expenses need three consecutive closed months/)).toHaveClass('note')
  })
  it('draws the five parts in order, wide by amount, and a legend that sums to the total', async () => {
    await draw()
    expect(within(hero()).getByText('$35,500 in all')).toBeInTheDocument()
    const segments = [...document.querySelectorAll<HTMLElement>('.avail-flow__bar > i')]
    expect(segments.map(s => s.dataset.part)).toEqual(['unavailable', 'reserve', 'goals', 'commitments', 'free'])
    expect(segments.map(s => s.style.flexGrow)).toEqual(['20000', '4400', '1100', '2000', '8000'])
    const amounts = [...document.querySelectorAll('.avail-legend td.num:not(.avail-legend__share)')].map(td => Number(td.textContent!.replace(/[$,]/g, '')))
    expect(amounts.reduce((s, a) => s + a, 0)).toBe(35500)
    expect([...document.querySelectorAll('.avail-legend__why')].map(e => e.textContent)).toEqual([
      'Other: invested or locked', 'on Savings · compare in Financial health', 'on Savings · goal progress is entered separately', 'on Checking'])
  })
  it('masks every amount and drops the proportions in privacy mode', async () => {
    await draw(undefined, { hidden: true })
    expect(screen.queryByText('$8,000')).toBeNull()
    expect(screen.queryByText(/\$|%| mo /)).toBeNull()
    expect(document.querySelector('.avail-flow__bar > i')).toBeNull()
    expect(screen.getAllByText('•••').length).toBeGreaterThan(5)
  })
})

describe('the hero, waiting', () => {
  beforeEach(() => { stored = confirmed().filter(a => a.name !== 'Savings') })
  it('shows a dash, how many are confirmed and a segment per account', async () => {
    await draw()
    const h = within(hero())
    expect(h.getByText('—')).toBeInTheDocument()
    expect(h.getByText(/Confirm all accounts to calculate the total\. 2 of 3 confirmed\./)).toBeInTheDocument()
    expect([...hero().querySelectorAll('.avail-wait__segs > i')].map(i => i.classList.contains('is-on'))).toEqual([true, true, false])
    expect(h.getByRole('button', { name: 'Confirm June · 1 account' })).toHaveClass('btn--primary')
  })
  it('the button opens the first unconfirmed account, focuses its editor and steps back from primary', async () => {
    await draw()
    fireEvent.click(within(hero()).getByRole('button', { name: /Confirm June ·/ }))
    const editor = within(row('Savings')).getByRole('form', { name: 'Confirm Savings' })
    expect(editor.contains(document.activeElement)).toBe(true)
    expect(within(hero()).getByRole('button', { name: /Confirm June ·/ })).toHaveClass('btn--ghost')
  })
  it('viewers get no button', async () => {
    state.canEdit = false
    await draw()
    expect(within(hero()).queryByRole('button')).toBeNull()
  })
})

describe('the account rows', () => {
  const chip = (name: string) => row(name).querySelector('.chip')!
  const bar = (name: string) => [...row(name).querySelectorAll<HTMLElement>('.avail-mb > i')].map(i => i.className.replace('avail-part--', ''))
  const caption = (name: string) => row(name).querySelector('.avail-row__caption')!.textContent
  it('draws each account in its currency with its own bar, caption and chip', async () => {
    await draw()
    expect(within(row('Checking')).getByText('Robin · Bank · USD')).toBeInTheDocument()
    expect(row('Checking').querySelector('.lane__avatar')).toHaveTextContent('R')
    expect(bar('Checking')).toEqual(['commitments', 'free'])
    expect(caption('Checking')).toBe('free $8,000 · set aside $2,000: commitments')
    expect(chip('Checking')).toHaveTextContent('Confirmed')
    expect(chip('Checking')).toHaveAttribute('data-color', 'success')
    expect(within(row('Savings')).getByText('€5,000')).toBeInTheDocument()
    expect(caption('Savings')).toBe('free €0 · set aside €5,000: cushion, goals')
    expect(bar('Pension')).toEqual(['unavailable'])
    expect(caption('Pension')).toBe('not available at once')
    expect(chip('Pension')).toHaveTextContent('Not available')
    expect(chip('Pension')).toHaveAttribute('data-color', 'secondary')
    expect(screen.getByText('confirmed 3 of 3 · amounts in the account\'s currency')).toBeInTheDocument()
    expect(within(row('Pension')).getByRole('button', { name: 'Change Pension' })).toHaveClass('btn--quiet')
  })
  it('a negative account is left out of the total and says why; a confirmed one without a rate blocks the totals', async () => {
    const overdraft: AccountValue = { name: 'Overdraft', member: 'Noa', class: 'bank', currency: 'USD', value: -300, valueBase: -300 }
    const view = await draw(snap([checking, savings, pension, overdraft]))
    expect(within(hero()).getByText('$35,500 in all')).toBeInTheDocument()
    expect(hero().querySelector('.avail-hero__big')).toHaveTextContent('$8,000')
    expect(chip('Overdraft')).toHaveTextContent('Negative balance')
    expect(caption('Overdraft')).toBe('a debt: not counted in the money to spend')
    expect(within(row('Overdraft')).queryByRole('button')).toBeNull()
    view.unmount()
    await draw(snap([checking, { ...savings, valueBase: null }, pension]))
    expect(hero().querySelector('.avail-hero__big')).toHaveTextContent('—')
    expect(within(hero()).getByRole('status')).toHaveTextContent('The calculation needs the account currency’s exchange rate')
    expect(chip('Savings')).toHaveTextContent('No exchange rate')
    expect(caption('Savings')).toBe('not counted until the month\'s exchange rate is known')
    expect(document.querySelector('.avail-flow')).toBeNull()
  })
  it('base EUR with USD accounts: the bar and minis in EUR, the rows in each account\'s currency', async () => {
    const usd = (a: AccountValue): AccountValue => ({ ...a, valueBase: a.valueBase === null ? null : a.value * (a.currency === 'USD' ? 0.9 : 1) })
    await draw(snap([checking, { ...savings, valueBase: 5000 }, pension].map(usd), { baseCurrency: 'EUR' }))
    expect(hero().querySelector('.avail-hero__big')).toHaveTextContent('€7,200')
    expect(within(hero()).getByText('€32,000 in all')).toBeInTheDocument()
    expect(within(row('Checking')).getByText('$10,000')).toBeInTheDocument()
    expect(caption('Checking')).toBe('free $8,000 · set aside $2,000: commitments')
  })
  it('last month\'s answer: "needs confirmation", its values as placeholders when the balance changed, prefilled when not', async () => {
    stored = [...confirmed().filter(a => a.name !== 'Savings'), of(savings, { month: '2031-05', balance: 4800, reserve: 4000, goals: 800 })]
    const view = await draw()
    expect(chip('Savings')).toHaveTextContent('Needs confirmation')
    expect(caption('Savings')).toBe('in May: available, set aside €4,800')
    expect(bar('Savings')).toEqual([])
    fireEvent.click(within(row('Savings')).getByRole('button', { name: 'Confirm Savings' }))
    const cushion = within(row('Savings')).getByRole('textbox', { name: 'Cushion (EUR)' })
    expect(cushion).toHaveValue('')
    expect(cushion).toHaveAttribute('placeholder', '4,000')
    expect(within(row('Savings')).getByText(/in May it was €4,800/)).toBeInTheDocument()
    view.unmount()
    stored = [...confirmed().filter(a => a.name !== 'Savings'), of(savings, { month: '2031-05', reserve: 4000, goals: 1000 })]
    await draw()
    fireEvent.click(within(row('Savings')).getByRole('button', { name: 'Confirm Savings' }))
    expect(within(row('Savings')).getByRole('textbox', { name: 'Cushion (EUR)' })).toHaveValue('4,000')
    expect(within(row('Savings')).getByText(/the same in May/)).toBeInTheDocument()
  })
  it('this month\'s answer that no longer fits says so in its own caption', async () => {
    stored = [...confirmed().filter(a => a.name !== 'Savings'), of(savings, { reserve: 6000 })]
    await draw()
    expect(row('Savings').querySelector('.avail-row__caption')).toHaveTextContent("this month's amounts do not fit the balance: confirm again")
  })
  it('a balance changed after this month\'s confirmation says so', async () => {
    stored = [...confirmed().filter(a => a.name !== 'Savings'), of(savings, { balance: 4000, reserve: 4000 })]
    await draw()
    expect(chip('Savings')).toHaveTextContent('Balance changed')
    expect(chip('Savings')).toHaveAttribute('data-color', 'warning')
  })
})

describe('the editor in the row', () => {
  beforeEach(() => { stored = confirmed().filter(a => a.name === 'Checking') })
  const open = (name: string) => fireEvent.click(within(row(name)).getByRole('button', { name: `Confirm ${name}` }))
  const field = (name: string, label: string) => within(row(name)).getByRole('textbox', { name: label })
  const availableNow = (name: string) => fireEvent.click(within(row(name)).getByRole('button', { name: 'Available at once' }))
  it('hides the fields when the money is not available at once', async () => {
    await draw()
    open('Pension')
    fireEvent.click(within(row('Pension')).getByRole('button', { name: 'Not available: invested, locked' }))
    expect(within(row('Pension')).queryByRole('textbox')).toBeNull()
    fireEvent.click(within(row('Pension')).getByRole('button', { name: 'Confirm June' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual({ method: 'PUT', body: of(pension, { available: false }) })
  })
  it('counts the free rest live and refuses more set aside than the balance', async () => {
    await draw()
    open('Savings')
    availableNow('Savings')
    fireEvent.change(field('Savings', 'Cushion (EUR)'), { target: { value: '4000' } })
    expect(row('Savings').querySelector('.avail-ed__left')).toHaveTextContent('Free on the account€1,000of €5,000')
    fireEvent.change(field('Savings', 'Goals (EUR)'), { target: { value: '2000' } })
    expect(row('Savings').querySelector('.avail-ed__left')).toHaveClass('is-bad')
    expect(row('Savings').querySelector('.avail-ed__left')).toHaveTextContent('−€1,000more set aside than the balance')
    expect(within(row('Savings')).getByRole('button', { name: 'Confirm June' })).toBeDisabled()
  })
  it('saves, keeps the server\'s answer and opens the next unconfirmed account; a failed save keeps the editor open', async () => {
    await draw()
    open('Savings')
    availableNow('Savings')
    fireEvent.change(field('Savings', 'Cushion (EUR)'), { target: { value: '4000' } })
    failPut = 'Balance changed on another device'
    fireEvent.click(within(row('Savings')).getByRole('button', { name: 'Confirm June' }))
    expect(await within(row('Savings')).findByRole('alert')).toHaveTextContent('Balance changed on another device')
    expect(within(row('Savings')).getByRole('form')).toBeInTheDocument()
    failPut = null
    fireEvent.click(within(row('Savings')).getByRole('button', { name: 'Confirm June' }))
    await waitFor(() => expect(within(row('Pension')).getByRole('form', { name: 'Confirm Pension' })).toBeInTheDocument())
    expect(within(row('Savings')).queryByRole('form')).toBeNull()
    expect(writes.at(-1)!.body).toEqual(of(savings, { reserve: 4000 }))
    await waitFor(() => expect(row('Savings').querySelector('.chip')).toHaveTextContent('Confirmed'))
    expect(row('Savings').querySelector('.avail-row__caption')).toHaveTextContent('free €1,000 · set aside €4,000: cushion')
  })
  it('a new account starts as not available: a bare confirm counts nothing as free', async () => {
    await draw()
    open('Savings')
    expect(within(row('Savings')).queryByRole('textbox')).toBeNull()
    fireEvent.click(within(row('Savings')).getByRole('button', { name: 'Confirm June' }))
    await waitFor(() => expect(writes).toEqual([{ method: 'PUT', body: of(savings, { available: false }) }]))
  })
  it('a changed balance never confirms last month\'s earmarks away by a bare confirm; "Use May 2031\'s values" fills them', async () => {
    stored = [...confirmed().filter(a => a.name !== 'Savings'), of(savings, { month: '2031-05', balance: 33000, reserve: 29639, goals: 3400 })]
    await draw()
    open('Savings')
    const cushion = field('Savings', 'Cushion (EUR)')
    expect(cushion).toHaveAttribute('placeholder', '29,639')
    expect(cushion).toHaveAttribute('aria-invalid', 'true')
    expect(within(row('Savings')).getAllByText('Enter an amount or 0')).toHaveLength(2)
    const confirm = within(row('Savings')).getByRole('button', { name: 'Confirm June' })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(writes).toEqual([])
    fireEvent.click(within(row('Savings')).getByRole('button', { name: "Use May 2031's values" }))
    expect(field('Savings', 'Cushion (EUR)')).toHaveValue('29,639')
    expect(field('Savings', 'Commitments (EUR)')).not.toHaveAttribute('aria-invalid')
    fireEvent.change(field('Savings', 'Cushion (EUR)'), { target: { value: '1600' } })
    fireEvent.click(within(row('Savings')).getByRole('button', { name: 'Confirm June' }))
    await waitFor(() => expect(writes).toEqual([{ method: 'PUT', body: of(savings, { reserve: 1600, goals: 3400 }) }]))
  })
  it('the previous values go as they were: the button alone then Confirm sends them', async () => {
    stored = [...confirmed().filter(a => a.name !== 'Savings'), of(savings, { month: '2031-05', balance: 4800, reserve: 4000, goals: 800 })]
    await draw()
    open('Savings')
    fireEvent.click(within(row('Savings')).getByRole('button', { name: "Use May 2031's values" }))
    fireEvent.click(within(row('Savings')).getByRole('button', { name: 'Confirm June' }))
    await waitFor(() => expect(writes).toEqual([{ method: 'PUT', body: of(savings, { reserve: 4000, goals: 800 }) }]))
  })
  it('an untouched editor follows another device\'s save; typed input stays', async () => {
    stored = confirmed()
    const { client } = await draw()
    fireEvent.click(within(row('Checking')).getByRole('button', { name: 'Change Checking' }))
    expect(field('Checking', 'Commitments (USD)')).toHaveValue('2,000')
    stored = [...stored.filter(a => a.name !== 'Checking'), of(checking, { commitments: 2500 })]
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'availability'] }) })
    await waitFor(() => expect(field('Checking', 'Commitments (USD)')).toHaveValue('2,500'))
    fireEvent.change(field('Checking', 'Cushion (USD)'), { target: { value: '100' } })
    stored = [...stored.filter(a => a.name !== 'Checking'), of(checking, { commitments: 3000 })]
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'availability'] }) })
    await waitFor(() => expect(row('Checking').querySelector('.avail-row__caption')).toHaveTextContent('set aside $3,000'))
    expect(field('Checking', 'Cushion (USD)')).toHaveValue('100')
    expect(field('Checking', 'Commitments (USD)')).toHaveValue('2,500')
  })
  it('cancel closes; viewers and privacy mode get no actions or editors', async () => {
    const view = await draw()
    open('Savings')
    fireEvent.click(within(row('Savings')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(within(row('Savings')).queryByRole('form')).toBeNull())
    view.unmount()
    state.canEdit = false
    const viewer = await draw()
    expect(within(row('Savings')).queryByRole('button')).toBeNull()
    viewer.unmount()
    state.canEdit = true
    await draw(undefined, { hidden: true })
    expect(screen.queryByRole('button', { name: /^Confirm|^Change/ })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('the stored confirmations', () => {
  it.each([true, false])('editors clear old ones, also of an account gone or negative (gone=%s)', async gone => {
    const old = of({ ...checking, name: 'Disappeared' }, { month: '2031-01', member: 'Owner' })
    stored = [...confirmed(), old]
    const view = await draw(snap(gone ? [checking, savings, pension] : [checking, savings, pension, { ...checking, name: 'Disappeared', member: 'Owner', value: -100, valueBase: -100 }]))
    fireEvent.click(screen.getByRole('button', { name: 'Clear Disappeared / Owner confirmation for January 2031' }))
    await waitFor(() => expect(writes).toEqual([{ method: 'DELETE', body: old }]))
    await act(async () => { await view.client.invalidateQueries() })
    view.unmount()
    state.canEdit = false
    await draw()
    expect(screen.queryByRole('button', { name: /Clear / })).toBeNull()
  })
  it('are hidden in privacy mode', async () => {
    await draw(undefined, { hidden: true })
    expect(screen.queryByText(/Review stored confirmations/)).toBeNull()
  })
})

it('withholds household totals when capital coverage is incomplete', async () => {
  const snapshot = snap()
  snapshot.capitalCoverage![0].capitalKnown = false
  await draw(snapshot)
  expect(hero().querySelector('.avail-hero__big')).toHaveTextContent('—')
  expect(hero()).not.toHaveTextContent('$8,000')
})
