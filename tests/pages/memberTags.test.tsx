import { screen } from '@testing-library/react'
import { CashFlow } from '../../src/pages/CashFlow'
import { Assets } from '../../src/pages/Assets'
import { makeSnapshot } from '../helpers/snapshot'
import { renderWithSnapshot as renderPage, stubSnapshotFetch } from '../helpers/render'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

beforeEach(() => { stubSnapshotFetch() })

const tint = (el: HTMLElement) => el.style.getPropertyValue('--tag')
/** The owners' avatars of the Assets holdings, tinted by the same order */
const avatars = () => Array.from(document.querySelectorAll<HTMLElement>('.holdings__row .lane__avatar--tinted'))
/** The avatars beside the names of the Income and expenses members table */
const whoAvatars = () => Array.from(document.querySelectorAll<HTMLElement>('.cf-who .lane__avatar--tinted'))

describe('member tags', () => {
  it('give a person the same tint on Assets and on Cash flow, by snapshot.members order', () => {
    const base = makeSnapshot({ members: ['Zed', 'Robin'] })
    const rows = [
      { month: '2031-06', bank: 'Lumiora Bank', member: 'Robin', currency: 'USD', active: 6320, passive: 410, expense: 10480, activeBase: 6320, passiveBase: 410, expenseBase: 10480 },
    ]
    const accounts = [{ name: 'Lumiora Bank', member: 'Robin', class: 'bank' as const, currency: 'USD', value: 100, valueBase: 100 }]
    const snapshot = makeSnapshot({
      members: ['Zed', 'Robin'],
      capital: { ...base.capital!, accounts },
      cashflow: { ...base.cashflow, rows },
    })
    const first = renderPage(<Assets />, snapshot)
    const onAssets = avatars().map(tint)
    first.unmount()
    renderPage(<CashFlow />, snapshot)
    const onCashFlow = whoAvatars().map(tint)
    expect(onAssets).toHaveLength(1)
    expect(onAssets[0]).toBe('var(--member-2)')
    expect(onCashFlow[0]).toBe('var(--member-2)')
    expect(screen.queryByText('Zed')).toBeNull()
  })
})
