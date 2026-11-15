import { fireEvent, screen } from '@testing-library/react'
import { Assets } from '../../src/pages/Assets'
import type { CapitalSnapshot, FinanceSnapshot } from '../../src/domain/types'
import { DEMO_FAMILIES } from '../../src/demo/family'
import { makeSnapshot } from '../helpers/snapshot'
import { renderWithSnapshot as renderPage, stubPrivacyOn, stubSnapshotFetch } from '../helpers/render'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

beforeEach(() => { stubSnapshotFetch() })

const [robin, noa] = DEMO_FAMILIES['en-US'].members
const account = (name: string, member: string, cls: 'bank' | 'broker', usd: number) => ({ name, member, class: cls, currency: 'USD', value: usd, valueBase: usd })
const property = (name: string, member: string, usd: number) => ({ name, member, currency: 'USD', value: usd, valueBase: usd })

/** The demo family's eight holdings, 1 144 127 in all; a month earlier each was 100 smaller */
function eight(over: Partial<CapitalSnapshot> = {}): FinanceSnapshot {
  const end = {
    ...makeSnapshot().capital!,
    accounts: [
      account('Granite Peak 401(k)', robin, 'broker', 80580), account('Silverleaf 401(k)', noa, 'broker', 55830), account('Kestrel Brokerage', robin, 'broker', 35900),
      account('Harborline Checking', robin, 'bank', 32000), account('Bluefinch Savings', noa, 'bank', 16000), account('Rheinau Bank', noa, 'bank', 10723),
    ],
    realEstate: [property('House on Maple Street', robin, 568000), property('Apartment in Leipzig', noa, 345094)],
    ...over,
  }
  const less = <T extends { value: number; valueBase: number | null }>(h: T) => ({ ...h, value: h.value - 100, valueBase: h.valueBase! - 100 })
  const prev = { ...end, date: '2031-05-31', accounts: end.accounts.map(less), realEstate: end.realEstate.map(less) }
  return makeSnapshot({ capital: end, previousCapital: prev, capitalCoverage: ['2031-05', '2031-06'].map(month => ({ month, assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] })) })
}

const tiles = () => [...document.querySelectorAll<HTMLElement>('.asset-tile')]
const tile = (name: string) => tiles().find(el => el.title.startsWith(name))!

describe('Asset map', () => {
  it('explains positive-only map versus signed full list', () => {
    renderPage(<Assets />, eight({ accounts: [account('Positive', robin, 'bank', 150), account('Negative', robin, 'bank', -20), account('Zero', robin, 'bank', 0)], realEstate: [] }))
    const map = screen.getByRole('group', { name: 'Asset map: the area of each tile is its value' })
    const description = screen.getByText('The map shows positive-valued holdings. Zero and negative holdings remain in the full list and signed composition.')
    expect(description).toBeVisible()
    expect(map).toHaveAccessibleDescription(description.textContent!)
    expect(tiles()).toHaveLength(1)
    expect(tile('Positive').style.flex).toMatch(/^150 1 0/)
    expect(document.querySelector('.asset-map__key')).toHaveTextContent('Bank accounts $150')
    expect(document.querySelector('.holdings__head')).toHaveTextContent('$130')
    expect(screen.getByRole('link', { name: 'Negative' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Zero' })).toBeVisible()
  })

  it('explains when there are no positive holdings', () => {
    renderPage(<Assets />, eight({ accounts: [account('Negative', robin, 'bank', -20), account('Zero', robin, 'bank', 0)], realEstate: [] }))
    const map = screen.getByRole('group', { name: 'Asset map: the area of each tile is its value' })
    expect(map).toHaveAccessibleDescription(/positive-valued holdings/)
    expect(tiles()).toHaveLength(0)
    expect(screen.getByRole('link', { name: 'Negative' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Zero' })).toBeVisible()
  })

  it('moves focus to the full holdings list', () => {
    renderPage(<Assets />, eight())
    fireEvent.click(screen.getByRole('button', { name: 'Full asset list' }))
    expect(screen.getByRole('heading', { name: 'Accounts and property' })).toHaveFocus()
  })

  it('hides an overflowing tile label without changing its link or weight', () => {
    let resize: ResizeObserverCallback = () => {}
    vi.stubGlobal('ResizeObserver', class { callback: ResizeObserverCallback; constructor(callback: ResizeObserverCallback) { this.callback = callback } observe(target: Element) { if (target.classList.contains('asset-tile')) resize = this.callback } disconnect() {} })
    renderPage(<Assets />, eight())
    const house = tile('House on Maple Street')
    const content = house.querySelector<HTMLElement>('.asset-tile__content')!
    Object.defineProperties(content, { clientWidth: { value: 100 }, scrollWidth: { value: 200 }, clientHeight: { value: 100 }, scrollHeight: { value: 100 } })
    resize([], {} as ResizeObserver)
    expect(house).toHaveAttribute('data-clipped', 'true')
    expect(house).toHaveAccessibleName(/House on Maple Street/)
    expect(house.style.flex).toMatch(/^568000 1 0/)
    vi.unstubAllGlobals()
  })

  it('draws a tile per holding, its area its value, the largest of a type in the base tone', () => {
    renderPage(<Assets />, eight())
    expect(screen.getByRole('group', { name: 'Asset map: the area of each tile is its value' })).toBeInTheDocument()
    expect(tiles()).toHaveLength(8)
    expect(tile('House on Maple Street')).toHaveClass('asset-tone--re')
    expect(tile('Apartment in Leipzig')).toHaveClass('asset-tone--re-2')
    expect(tile('Kestrel Brokerage')).toHaveClass('asset-tone--br-3')
    expect(tile('House on Maple Street').style.flex).toMatch(/^568000 1 0/)
    expect(tile('House on Maple Street')).toHaveTextContent(`House on Maple Street49.6% · $568,000${robin} · +$100 over the month`)
    expect(tile('House on Maple Street').title).toBe(`House on Maple Street · ${robin}: $568,000, +$100 over the month`)
    expect(screen.getByRole('link', { name: `House on Maple Street · ${robin}: $568,000, +$100 over the month` })).toBe(tile('House on Maple Street'))
    expect([...document.querySelectorAll('.asset-map__key > span')].map(s => s.textContent))
      .toEqual(['Real estate $913,094', 'Brokerage accounts $172,310', 'Bank accounts $58,723'])
  })

  it('shows only the share on a tile under 4%', () => {
    renderPage(<Assets />, eight())
    const rheinau = tile('Rheinau Bank')
    expect(rheinau).toHaveClass('asset-tile--tiny')
    expect(rheinau.textContent).toBe('0.9%')
    expect(tile('Granite Peak 401(k)')).not.toHaveClass('asset-tile--tiny')
  })

  it('links each tile to its record', () => {
    renderPage(<Assets />, eight())
    expect(tile('Harborline Checking').closest('a')).toHaveAttribute('href', `/accounts#${encodeURIComponent(JSON.stringify(['Harborline Checking', robin]))}`)
    expect(tile('Apartment in Leipzig').closest('a')).toHaveAttribute('href', '/real-estate#Apartment%20in%20Leipzig')
  })

  it('masks the values in privacy mode, the shares stay', () => {
    stubPrivacyOn()
    renderPage(<Assets />, eight())
    const house = tile('House on Maple Street')
    expect(house).toHaveTextContent('49.6% · •••')
    expect(house.title).not.toMatch(/568/)
    expect(document.querySelector('.asset-map__key')!.textContent).not.toMatch(/\d{3},\d{3}/)
  })

  it('puts the other holdings in a neutral tone under the bank accounts', () => {
    const base = eight()
    const coin = { ...account('Coin wallet', robin, 'bank', 20000), class: 'crypto' as const }
    renderPage(<Assets />, eight({ accounts: [...base.capital!.accounts, coin] }))
    const wallet = tile('Coin wallet')
    expect(wallet).toHaveClass('asset-tone--ot')
    expect(wallet.parentElement!.previousElementSibling).toContainElement(tile('Harborline Checking'))
    expect(document.querySelector('.asset-map__key')).toHaveTextContent('Other $20,000')
  })

  it('gives the accounts the whole map when there is no real estate', () => {
    renderPage(<Assets />, eight({ realEstate: [] }))
    expect(document.querySelectorAll('.asset-map > .asset-map__col')).toHaveLength(1)
    expect(tiles()).toHaveLength(6)
  })
})
