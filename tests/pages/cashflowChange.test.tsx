import { fireEvent, screen, within } from '@testing-library/react'
import { CashFlow } from '../../src/pages/CashFlow'
import { demoFamilyData } from '../helpers/demoFamily'
import { renderWithSnapshot, stubPrivacyOn, stubSnapshotFetch } from '../helpers/render'

const { snapshot, rows, build } = await demoFamilyData()
const untracked = build({ ...rows, trackFlows: false })

beforeEach(() => { stubSnapshotFetch(); window.history.replaceState({}, '', '/cashflow') })
afterEach(() => window.history.replaceState({}, '', '/'))

const card = () => within(screen.getByRole('region', { name: 'What changed our net worth' }))
const open = (search: string, s = snapshot) => { window.history.replaceState({}, '', `/cashflow${search}`); return renderWithSnapshot(<CashFlow />, s) }

// "What changed our net worth" closes Income and expenses: the change by cause, the sentence and the year of what the family added
describe('what changed our net worth', () => {
  it('replaces the two-step block: the sentence, the bridge and the history of September', () => {
    open('')
    expect(screen.queryByRole('region', { name: 'What changed in net worth' })).toBeNull()
    expect(card().getByText(/^September 2026 · /)).toBeInTheDocument()
    expect(document.querySelector('.cc-lead')!.textContent).toMatch(/^In September 2026 net worth (rose|fell|barely changed)/)
    expect(card().getByText('Saved from income')).toBeInTheDocument()
    expect(document.querySelector('.ch')).not.toBeNull()
  })

  it('a month picked in the history moves the page and the bridge to it', () => {
    open('')
    fireEvent.click(card().getByRole('button', { name: /^August 2026: / }))
    expect(card().getByText(/^August 2026 · /)).toBeInTheDocument()
    expect(window.location.search).toContain('m=2026-08')
  })

  it('a quarter sums its months from 30.06.2026', () => {
    open('?p=quarter')
    expect(card().getByText('Net worth on 06/30/2026')).toBeInTheDocument()
  })

  it('with tracking off: the period, the notice and the block in the balances form', () => {
    open('', untracked)
    expect(screen.getByText('Income and expenses tracking is off')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quarter' })).toBeInTheDocument()
    expect(card().getByText('Change in accounts')).toBeInTheDocument()
    expect(card().queryByText('Saved from income')).toBeNull()
  })

  it('privacy masks the bridge, the names stay', () => {
    stubPrivacyOn()
    open('')
    expect([...document.querySelectorAll('.cc-row__value')].every(v => v.textContent!.endsWith('•••'))).toBe(true)
    expect(card().getByText('Saved from income')).toBeInTheDocument()
  })
})
