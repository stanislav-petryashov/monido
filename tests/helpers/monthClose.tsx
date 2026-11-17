import { DataPage } from '../../src/pages/admin/DataPage'
import { MonthCloseView } from '../../src/pages/admin/MonthCloseView'
import type { MonthCloseState, SpendingRecords } from '../../src/domain/api'
import { jsonResponse } from './http'
import { renderAdmin } from './render'

// the month-close wizard's fixture, shared by tests/components/monthClose/*

export const account = (name: string) => ({
  name, member: 'Robin', currency: 'RUB', class: 'bank' as const,
  balance: null, active: null, passive: null, expense: null, closing: false, added: false,
})
export const base: MonthCloseState = {
  queue: ['2031-06', '2031-07'], month: '2031-06',
  rows: [account('Quillmark Bank'), account('Deposit')],
  loanPayments: [],
  hints: { '["Quillmark Bank","Robin"]': 5800, '["Deposit","Robin"]': 500 },
  flowHints: {},
  totals: [],
  problems: [
    { key: '["Quillmark Bank","Robin"]', name: 'Quillmark Bank', member: 'Robin', problem: { code: 'missing' as const, fields: ['balance' as const] } },
    { key: '["Deposit","Robin"]', name: 'Deposit', member: 'Robin', problem: { code: 'missing' as const, fields: ['balance' as const] } },
  ],
  draftRevision: 'revision-1', draftSavedAt: null, lastClosed: { month: '2031-05', reopenable: false }, nextOpensOn: null,
  incomplete: [], suggested: [], strayRows: 0, members: ['Robin'], currencies: ['RUB'], flows: true,
  history: { endsAt: '2031-04', until: '2031-07', imported: null, accounts: [{ name: 'Quillmark Bank', member: 'Robin', class: 'bank', currency: 'RUB' }] },
}

/** The Cash flow module's records with nothing in them: what the wizard's breakdown reads by default */
export const noSpending: SpendingRecords = { categories: [], accounts: [], sources: [], manual: null }

/** GET /api/month-close returns state (GET /api/spending — `spending`); other requests go to onRequest (returns a new state or throws). */
export function stubState(state: MonthCloseState, onRequest?: (url: string, init: RequestInit) => MonthCloseState, spending: SpendingRecords = noSpending) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/spending' && (!init?.method || init.method === 'GET')) return jsonResponse(spending)
    if (!init?.method || init.method === 'GET') return jsonResponse(state)
    try { return jsonResponse(onRequest ? onRequest(url, init) : state) } catch (e) { return jsonResponse({ error: (e as Error).message }, 500) }
  }))
}

export const renderScreen = () => renderAdmin(<DataPage screen={MonthCloseView} />)

/** “Close <month>” can be pressed: not disabled (a write running) and not blocked (aria-disabled: it keeps the focus, so its reason is read out) */
export const closable = (button: HTMLElement) => !button.matches(':disabled') && button.getAttribute('aria-disabled') !== 'true'

/** The floating bar's figure as one string: "1 of 2" and its label, run together ("1 of 2accounts filled") */
export const barFigure = () => document.querySelector('.close-bar .close-bar__fig')?.textContent ?? null

/** The lines of the obstacles card, each as its whole text (an account's name in it is a link) */
export const obstacleLines = (list: HTMLElement) => [...list.querySelectorAll('li')].map(li => li.textContent)
