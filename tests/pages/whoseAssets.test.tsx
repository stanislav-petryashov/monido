import { screen, within } from '@testing-library/react'
import { WhoseAssetsCard } from '../../src/pages/overview/WhoseAssetsCard'
import { DEMO_FAMILIES } from '../../src/demo/family'
import { makeSnapshot } from '../helpers/snapshot'
import { renderWithSnapshot, stubPrivacyOn, stubSnapshotFetch } from '../helpers/render'

const [robin, noa] = DEMO_FAMILIES['en-US'].members
const lanes = () => [...document.querySelectorAll<HTMLElement>('.lane')]

beforeEach(stubSnapshotFetch)

describe('WhoseAssetsCard', () => {
  it('has a lane per member of the split, largest first, with the share as a bar and the amount', () => {
    renderWithSnapshot(<WhoseAssetsCard />, makeSnapshot())
    expect(screen.getByText('Whose assets')).toHaveClass('card-hd')
    expect(screen.getByText('$184,508')).toHaveClass('overview-card-meta')
    expect(screen.getByText('$184,508')).not.toHaveClass('chip')
    const rows = lanes()
    expect(rows).toHaveLength(4)
    expect(rows.map(l => within(l).getByRole('progressbar').getAttribute('aria-label'))).toEqual(['No member', 'Shared', robin, noa])
    expect(rows.map(l => within(l).getByRole('progressbar').getAttribute('aria-valuenow'))).toEqual(['73', '17', '9', '2'])
    expect(rows[0]).toHaveTextContent('$134,000')
    expect(rows[2]).toHaveTextContent('$15,748')
  })

  it('tints the bar and the initial by the member\'s place in the family; no member and a stranger are ink', () => {
    renderWithSnapshot(<WhoseAssetsCard />, makeSnapshot())
    const rows = lanes()
    expect(rows[2].querySelector('.segbar')).toHaveClass('segbar--member-1')
    expect(rows[3].querySelector('.segbar')).toHaveClass('segbar--member-2')
    expect(rows[0].querySelector('.segbar')).toHaveClass('segbar--ink')
    expect(rows[1].querySelector('.segbar')).toHaveClass('segbar--ink')
    expect(rows[2].querySelector('.lane__avatar')).toHaveTextContent(robin[0])
    expect(rows[2].querySelector('.lane__avatar')).toHaveAttribute('aria-hidden', 'true')
  })

  it('names the largest holdings of each member in a meta line', () => {
    renderWithSnapshot(<WhoseAssetsCard />, makeSnapshot())
    expect(screen.getByText(`No member: City apartment · ${robin}: Lumiora Bank · ${noa}: Brisaluna Bank`)).toBeInTheDocument()
  })

  it('masks the amounts in privacy mode and keeps the shares', () => {
    stubPrivacyOn()
    const { container } = renderWithSnapshot(<WhoseAssetsCard />, makeSnapshot())
    expect(container.textContent?.replace(/[^0-9]/g, '')).not.toContain('184508')
    expect(container.textContent?.replace(/[^0-9]/g, '')).not.toContain('134000')
    expect(screen.getAllByText('•••')).toHaveLength(5)
    expect(lanes()[0].querySelector('.segbar')).not.toBeNull()
  })

  it('draws nothing without balances', () => {
    const { container } = renderWithSnapshot(<WhoseAssetsCard />, makeSnapshot({ capital: null }))
    expect(container).toBeEmptyDOMElement()
  })
})
